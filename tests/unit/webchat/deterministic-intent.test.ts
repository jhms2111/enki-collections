import { describe, expect, it } from "vitest";

import { interpretSafeChatText } from "@/modules/webchat/deterministic-intent";

describe("deterministic webchat intent", () => {
  it("recognizes only safe navigational intents", () => {
    expect(interpretSafeChatText("Preciso de ajuda")).toBe("HELP");
    expect(interpretSafeChatText("Quero ver minhas dívidas")).toBe("LIST_DEBTS");
    expect(interpretSafeChatText("Mostrar propostas")).toBe("LIST_OFFERS");
  });

  it("never maps free text to a mutating operation", () => {
    for (const text of [
      "aceito a proposta",
      "prometo pagar amanhã",
      "já paguei",
      "quero contestar",
      "pare as mensagens",
      "encerre agora",
    ]) {
      expect(["HELP", "LIST_DEBTS", "LIST_OFFERS", "UNKNOWN"]).toContain(
        interpretSafeChatText(text),
      );
    }
  });
});
