import { interpretSafeChatText } from "./deterministic-intent";
import { intentPromptVersion, OpenAITransportError, type NaturalLanguageIntentClient } from "./openai-responses-intent-client";
import type {
  BotTurn,
  ConversationalIntent,
  NormalizedInboundTurn,
} from "./conversation-turn.types";

const mutatingIntents = new Set<ConversationalIntent>([
  "ACCEPT_OFFER",
  "MAKE_PAYMENT_PROMISE",
  "REPORT_PAYMENT",
  "DISPUTE_DEBT",
  "CLOSE",
  "OPT_OUT",
]);

const forbiddenFreeText = /(?:\d|R\$|reais?|centavos?|desconto|juros|multa|melhor proposta|quita(?:ção|do)|processo judicial|penhora)/iu;
const sensitiveInput = /(?:\b\d{3}[.-]?\d{3}[.-]?\d{3}-?\d{2}\b|\b\d{10,19}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu;
const technicalPublicLanguage = /(?:FACT_REF|backend|policy\s+gate|OpenAI|detalhes?\s+can[oô]nic)/iu;
export const restrictedNegotiationTemplate = "Não posso criar, calcular ou recomendar condições diferentes. Posso apresentar as propostas previamente autorizadas disponíveis.";
export const promptInjectionTemplate = "Não posso ignorar as regras da demonstração nem alterar estados por texto livre. Use somente as opções seguras exibidas.";

export type PreModelGuard = "RESTRICTED_NEGOTIATION_REQUEST" | "PROMPT_INJECTION_BLOCKED";

export function classifyPreModelGuard(message: string): PreModelGuard | null {
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const restricted = /(?:melhor\s+(?:proposta|propsta|propost\w*)|recomend\w*.{0,20}(?:proposta|acordo)|descont\w*|descnto|\b\d+(?:[.,]\d+)?\s*(?:%|por\s+cento)|(?:alter\w*|mud\w*|troc\w*|reduz\w*|aument\w*).{0,45}(?:valor|entrada|parcel\w*|prazo|vencim\w*|term\w*|condic\w*))/iu;
  if (restricted.test(normalized)) return "RESTRICTED_NEGOTIATION_REQUEST";
  const injection = /(?:(?:ignor\w*|inor\w*|desconsider\w*|esquec\w*).{0,45}(?:regr\w*|instruc\w*|politic\w*|sistema)|(?:marq\w*|consider\w*).{0,35}(?:divida|pagamento)?.{0,25}(?:paga|pago|quitad\w*))/iu;
  return injection.test(normalized) ? "PROMPT_INJECTION_BLOCKED" : null;
}

export interface AiUsageBudgetGate {
  allowRequest(): Promise<boolean>;
  recordUsage(usage: Readonly<{ inputTokens: number; outputTokens: number }>): Promise<void>;
}

export class ClosedAiUsageBudgetGate implements AiUsageBudgetGate {
  async allowRequest(): Promise<boolean> { return false; }
  async recordUsage(): Promise<void> {}
}

export class ReservedAiUsageBudgetGate implements AiUsageBudgetGate {
  async allowRequest(): Promise<boolean> { return true; }
  async recordUsage(): Promise<void> {}
}

export class ConversationTurnOrchestrator {
  constructor(
    private readonly client: NaturalLanguageIntentClient,
    private readonly budget: AiUsageBudgetGate,
    private readonly config: Readonly<{ enabled: boolean; model: string }>,
  ) {}

  async handle(turn: NormalizedInboundTurn): Promise<BotTurn> {
    if (turn.conversationState === "CLOSED" || turn.conversationState === "OPTED_OUT") {
      return this.fallback(turn, "TERMINAL_CONVERSATION");
    }
    if (sensitiveInput.test(turn.message)) return this.fallback(turn, "SENSITIVE_INPUT");
    const preModelGuard = this.handlePreModelGuard(turn);
    if (preModelGuard) return preModelGuard;
    if (!this.config.enabled) return this.fallback(turn, "FEATURE_DISABLED");
    if (!(await this.budget.allowRequest())) return this.fallback(turn, "BUDGET_EXHAUSTED");

    try {
      const result = await this.client.interpret(turn);
      if (result.output.confidence === "LOW") {
        return this.fallback(turn, "LOW_CONFIDENCE", { model: this.config.model, usage: result.usage });
      }
      const allowed = this.allowedIntents(turn);
      if (!allowed.has(result.output.intent)) {
        return this.fallback(turn, "INTENT_NOT_ALLOWED", { model: this.config.model, usage: result.usage, failureCategory: "POLICY" });
      }
      let message: string;
      try {
        message = this.renderExplanation(turn, result.output.explanationSegments);
      } catch {
        return this.fallback(turn, "UNSAFE_MODEL_OUTPUT", { model: this.config.model, usage: result.usage, failureCategory: "POLICY" });
      }
      const suggestedActions = result.output.suggestedActions.filter((intent) => allowed.has(intent));
      await this.budget.recordUsage(result.usage);
      return {
        intent: result.output.intent,
        message,
        suggestedActions,
        requiresConfirmation: mutatingIntents.has(result.output.intent),
        fallbackUsed: false,
        model: this.config.model,
        promptVersion: intentPromptVersion,
        usage: result.usage,
        storageMessage: this.renderStorageExplanation(result.output.explanationSegments),
      };
    } catch (error) {
      return this.fallback(turn, "MODEL_UNAVAILABLE", {
        model: this.config.model,
        failureCategory: error instanceof OpenAITransportError ? error.category : "RESPONSE_PARSE_ERROR",
      });
    }
  }

  handlePreModelGuard(turn: NormalizedInboundTurn): BotTurn | null {
    const guard = classifyPreModelGuard(turn.message);
    if (guard === "PROMPT_INJECTION_BLOCKED") {
      return this.controlledPolicyFallback("UNKNOWN", promptInjectionTemplate, [], undefined, guard);
    }
    if (guard === "RESTRICTED_NEGOTIATION_REQUEST") {
      const canListOffers = this.allowedIntents(turn).has("LIST_OFFERS");
      return this.controlledPolicyFallback(
        canListOffers ? "LIST_OFFERS" : "UNKNOWN",
        restrictedNegotiationTemplate,
        canListOffers ? ["LIST_OFFERS"] : [],
        undefined,
        guard,
      );
    }
    return null;
  }

  private controlledPolicyFallback(
    intent: ConversationalIntent,
    message: string,
    suggestedActions: readonly ConversationalIntent[],
    usage: Readonly<{ inputTokens: number; outputTokens: number }> | undefined,
    reason: string,
  ): BotTurn {
    return {
      intent,
      message,
      suggestedActions,
      requiresConfirmation: false,
      fallbackUsed: true,
      fallbackReason: reason,
      model: this.config.model,
      promptVersion: intentPromptVersion,
      ...(usage ? { usage } : {}),
      failureCategory: "POLICY",
    };
  }

  handleDeterministic(turn: NormalizedInboundTurn, reason = "FREE_FALLBACK"): BotTurn {
    return this.fallback(turn, reason);
  }

  private renderExplanation(
    turn: NormalizedInboundTurn,
    segments: readonly Readonly<{
      type: "TEXT" | "FACT_REF";
      text: string | null;
      factKey: string | null;
    }>[],
  ): string {
    const facts = new Map(turn.canonicalFacts.map((fact) => [fact.key, fact.displayText]));
    return segments.map((segment) => {
      if (segment.type === "FACT_REF") {
        const fact = segment.factKey ? facts.get(segment.factKey) : undefined;
        if (!fact) throw new Error("Unknown canonical fact reference.");
        return fact;
      }
      const text = segment.text ?? "";
      if (!text || forbiddenFreeText.test(text) || technicalPublicLanguage.test(text)) {
        throw new Error("Unsafe free-form explanation.");
      }
      return text;
    }).join(" ").replace(/\s+/g, " ").trim();
  }

  private renderStorageExplanation(
    segments: readonly Readonly<{
      type: "TEXT" | "FACT_REF";
      text: string | null;
      factKey: string | null;
    }>[],
  ): string {
    return segments.map((segment) => segment.type === "FACT_REF"
      ? `[[FACT:${segment.factKey}]]`
      : segment.text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private allowedIntents(turn: NormalizedInboundTurn): ReadonlySet<ConversationalIntent> {
    const common: ConversationalIntent[] = ["HELP", "CLOSE", "OPT_OUT", "UNKNOWN"];
    if (turn.identityStatus === "NOT_STARTED") return new Set([...common, "IDENTIFY_SELF"]);
    if (turn.identityStatus === "PENDING") return new Set([...common, "VERIFY_IDENTITY"]);
    if (turn.identityStatus !== "VERIFIED") return new Set(common);
    const verified: ConversationalIntent[] = [...common, "LIST_DEBTS", "SELECT_DEBT"];
    if (turn.uiContext !== "DEBT_LIST") verified.push("LIST_OFFERS", "SELECT_OFFER", "REQUEST_INSTRUMENT");
    if (turn.uiContext === "OFFER_REVIEW" || turn.uiContext === "ACCEPTED") {
      verified.push("ACCEPT_OFFER");
    }
    if (["DEBT_DETAIL", "OFFER_REVIEW", "ACCEPTED"].includes(turn.uiContext)) {
      verified.push("MAKE_PAYMENT_PROMISE", "REPORT_PAYMENT", "DISPUTE_DEBT");
    }
    return new Set(verified);
  }

  private fallback(
    turn: NormalizedInboundTurn,
    reason: string,
    technical: Pick<BotTurn, "model" | "usage" | "failureCategory"> = {},
  ): BotTurn {
    if (turn.conversationState === "OPTED_OUT") {
      return this.fallbackResult("UNKNOWN", "As mensagens estão interrompidas nesta conversa.", reason);
    }
    if (turn.conversationState === "CLOSED") {
      return this.fallbackResult("UNKNOWN", "Esta conversa está encerrada e não será reaberta.", reason);
    }
    const contextual = this.contextualFallback(turn, reason, technical);
    if (contextual) return contextual;
    const classifiedIntent = interpretSafeChatText(turn.message);
    const localIntent = this.allowedIntents(turn).has(classifiedIntent) ? classifiedIntent : "UNKNOWN";
    const message = localIntent === "HELP"
      ? "Posso explicar o valor, o vencimento, as propostas ou como realizar o pagamento."
      : localIntent === "LIST_DEBTS" && turn.identityStatus === "VERIFIED"
        ? "Posso apresentar as dívidas demonstrativas disponíveis após a validação da identidade."
        : localIntent === "LIST_OFFERS" && turn.uiContext !== "DEBT_LIST"
          ? "Posso apresentar as propostas previamente autorizadas para esta dívida."
          : "Não consegui entender. Você pode perguntar sobre o valor, vencimento, propostas ou como realizar o pagamento.";
    const confirmationMessages: Partial<Record<ConversationalIntent, string>> = {
      ACCEPT_OFFER: "Preparei a revisão da proposta. Confirme no botão somente depois de conferir os termos.",
      REQUEST_INSTRUMENT: turn.hasCurrentAcceptance
        ? "A proposta já foi aceita. Posso encaminhar você à página demonstrativa de pagamento."
        : "Primeiro escolha uma proposta autorizada e confirme o aceite. Depois disso, a página demonstrativa de pagamento ficará disponível.",
      MAKE_PAYMENT_PROMISE: "Informe a data e confirme no botão. A promessa não representa pagamento.",
      REPORT_PAYMENT: "Informe quando o pagamento teria sido realizado e confirme no botão. Isso não confirma quitação.",
      DISPUTE_DEBT: "Informe o motivo e confirme no botão. A contestação ficará pendente de análise.",
      CLOSE: "Confirme no botão se deseja encerrar esta conversa.",
      OPT_OUT: "Confirme no botão se deseja interromper as mensagens.",
    };
    return this.fallbackResult(localIntent, confirmationMessages[localIntent] ?? message, reason, technical);
  }

  private contextualFallback(turn: NormalizedInboundTurn, reason: string, technical: Pick<BotTurn, "model" | "usage" | "failureCategory">): BotTurn | null {
    if (turn.identityStatus !== "VERIFIED") return null;
    const normalized = turn.message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const facts = new Map(turn.canonicalFacts.map((fact) => [fact.key, fact.displayText]));
    const continuation = /^(?:sim(?:,?\s+me\s+explique)?|me\s+explique|continue|como\s+faco\s+isso)[.!?]*$/.test(normalized);
    const paymentQuestion = /(?:como\s+seria.*pagamento|onde.*(?:pagamento|pago|pagar)|como\s+faco\s+para\s+pagar|quero\s+pagar|manda.*link|boleto|pix)/.test(normalized) || (continuation && turn.lastSubject === "REQUEST_INSTRUMENT");
    if (paymentQuestion) return this.fallbackResult("REQUEST_INSTRUMENT", turn.hasCurrentAcceptance
      ? "Sua proposta demonstrativa foi aceita. Acesse a página de pagamento para revisar as condições e escolher uma opção. Esta demonstração não realiza pagamento real nem representa quitação."
      : "Para continuar, consulte uma proposta autorizada, escolha a condição desejada e confirme o aceite. A página demonstrativa de pagamento ficará disponível somente depois dessa confirmação.", reason, technical);
    if (!facts.has("debt_amount")) return continuation ? this.fallbackResult("HELP", "Selecione uma dívida para que eu possa continuar a explicação.", reason, technical) : null;
    const asksAmount = /\b(valor|quanto)\b/.test(normalized);
    const asksDue = /\b(vencimento|vence|venca)\b/.test(normalized);
    if (asksAmount || asksDue) return this.fallbackResult("HELP", [asksAmount ? facts.get("debt_amount") : null, asksDue ? facts.get("debt_due_date") : null].filter(Boolean).join(" "), reason, technical);
    if (/\b(explicacao|explicacaco|explique|explicar|explica|nao entendi|como funciona)\b/.test(normalized) || (continuation && ["LIST_DEBTS", "SELECT_DEBT", "HELP"].includes(turn.lastSubject ?? ""))) {
      return this.fallbackResult("HELP", ["debt_creditor", "debt_description", "debt_amount", "debt_due_date", "debt_status"].map((key) => facts.get(key)).filter(Boolean).join(" "), reason, technical);
    }
    if (/\b(parcelas?|entrada)\b/.test(normalized) && facts.has("offer_total")) return this.fallbackResult("HELP", ["offer_kind", "offer_total", "offer_down_payment", "offer_installment_count", "offer_installment_amount", "offer_first_due_date"].map((key) => facts.get(key)).filter(Boolean).join(" "), reason, technical);
    return null;
  }

  private fallbackResult(
    intent: ConversationalIntent,
    message: string,
    reason: string,
    technical: Pick<BotTurn, "model" | "usage" | "failureCategory"> = {},
  ): BotTurn {
    return {
      intent,
      message,
      suggestedActions: [],
      requiresConfirmation: mutatingIntents.has(intent),
      fallbackUsed: true,
      fallbackReason: reason,
      ...technical,
    };
  }
}
