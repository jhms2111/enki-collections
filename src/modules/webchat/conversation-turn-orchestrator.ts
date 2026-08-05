import { interpretSafeChatText } from "./deterministic-intent";
import { intentPromptVersion, type NaturalLanguageIntentClient } from "./openai-responses-intent-client";
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

export interface AiUsageBudgetGate {
  allowRequest(): Promise<boolean>;
  recordUsage(usage: Readonly<{ inputTokens: number; outputTokens: number }>): Promise<void>;
}

export class ClosedAiUsageBudgetGate implements AiUsageBudgetGate {
  async allowRequest(): Promise<boolean> { return false; }
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
    if (!this.config.enabled) return this.fallback(turn, "FEATURE_DISABLED");
    if (!(await this.budget.allowRequest())) return this.fallback(turn, "BUDGET_EXHAUSTED");

    try {
      const result = await this.client.interpret(turn);
      if (result.output.confidence === "LOW") return this.fallback(turn, "LOW_CONFIDENCE");
      const allowed = this.allowedIntents(turn);
      if (!allowed.has(result.output.intent)) return this.fallback(turn, "INTENT_NOT_ALLOWED");
      const message = this.renderExplanation(turn, result.output.explanationSegments);
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
    } catch {
      return this.fallback(turn, "MODEL_UNAVAILABLE");
    }
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

  private fallback(turn: NormalizedInboundTurn, reason: string): BotTurn {
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
    return this.fallbackResult(localIntent, message, reason);
  }

  private fallbackResult(
    intent: ConversationalIntent,
    message: string,
    reason: string,
  ): BotTurn {
    return {
      intent,
      message,
      suggestedActions: [],
      requiresConfirmation: false,
      fallbackUsed: true,
      fallbackReason: reason,
    };
  }
}
