import { interpretSafeChatText } from "./deterministic-intent";
import { intentPromptVersion, OpenAITransportError, type NaturalLanguageIntentClient } from "./openai-responses-intent-client";
import type {
  BotTurn,
  ConversationalIntent,
  NormalizedInboundTurn,
} from "./conversation-turn.types";

const mutatingIntents = new Set<ConversationalIntent>([
  "ACCEPT_OFFER",
  "REQUEST_INSTRUMENT",
  "MAKE_PAYMENT_PROMISE",
  "REPORT_PAYMENT",
  "DISPUTE_DEBT",
  "CLOSE",
  "OPT_OUT",
]);

const forbiddenFreeText = /(?:\d|R\$|reais?|centavos?|desconto|juros|multa|melhor proposta|quita(?:ção|do)|processo judicial|penhora)/iu;
const sensitiveInput = /(?:\b\d{3}[.-]?\d{3}[.-]?\d{3}-?\d{2}\b|\b\d{10,19}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu;
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
      if (!text || forbiddenFreeText.test(text)) {
        throw new Error("Unsafe free-form explanation.");
      }
      return text;
    }).join(" ").replace(/\s+/g, " ").trim();
  }

  private allowedIntents(turn: NormalizedInboundTurn): ReadonlySet<ConversationalIntent> {
    const common: ConversationalIntent[] = ["HELP", "CLOSE", "OPT_OUT", "UNKNOWN"];
    if (turn.identityStatus === "NOT_STARTED") return new Set([...common, "IDENTIFY_SELF"]);
    if (turn.identityStatus === "PENDING") return new Set([...common, "VERIFY_IDENTITY"]);
    if (turn.identityStatus !== "VERIFIED") return new Set(common);
    const verified: ConversationalIntent[] = [...common, "LIST_DEBTS", "SELECT_DEBT"];
    if (turn.uiContext !== "DEBT_LIST") verified.push("LIST_OFFERS", "SELECT_OFFER");
    if (turn.uiContext === "OFFER_REVIEW" || turn.uiContext === "ACCEPTED") {
      verified.push("ACCEPT_OFFER");
    }
    if (turn.uiContext === "ACCEPTED") verified.push("REQUEST_INSTRUMENT");
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
    const localIntent = interpretSafeChatText(turn.message);
    const message = localIntent === "HELP"
      ? "Use os botões para avançar com segurança. Texto livre nunca confirma uma operação."
      : localIntent === "LIST_DEBTS" && turn.identityStatus === "VERIFIED"
        ? "As dívidas demonstrativas disponíveis estão nos botões abaixo."
        : localIntent === "LIST_OFFERS" && turn.uiContext !== "DEBT_LIST"
          ? "As propostas previamente autorizadas estão nos botões abaixo."
          : "Não entendi com segurança. Escolha uma das opções exibidas; nenhuma ação foi executada.";
    return this.fallbackResult(localIntent, message, reason, technical);
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
      requiresConfirmation: false,
      fallbackUsed: true,
      fallbackReason: reason,
      ...technical,
    };
  }
}
