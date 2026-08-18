import { describe, expect, it } from "vitest";

import { interpretSafeChatText } from "@/modules/webchat/deterministic-intent";

describe("deterministic webchat intent", () => {
  it("recognizes navigational intents", () => {
    expect(interpretSafeChatText("Preciso de ajuda")).toBe("HELP");
    expect(interpretSafeChatText("Quero ver minhas dívidas")).toBe("LIST_DEBTS");
    expect(interpretSafeChatText("Quero parcelar")).toBe("LIST_OFFERS");
  });

  it("maps natural mutation requests to intents that still require UI confirmation", () => {
    expect(interpretSafeChatText("aceito a proposta")).toBe("ACCEPT_OFFER");
    expect(interpretSafeChatText("prometo pagar amanhã")).toBe("MAKE_PAYMENT_PROMISE");
    expect(interpretSafeChatText("já paguei")).toBe("REPORT_PAYMENT");
    expect(interpretSafeChatText("não reconheço essa dívida")).toBe("DISPUTE_DEBT");
    expect(interpretSafeChatText("parar as mensagens")).toBe("OPT_OUT");
    expect(interpretSafeChatText("encerrar este atendimento")).toBe("CLOSE");
    expect(interpretSafeChatText("quero um boleto")).toBe("REQUEST_INSTRUMENT");
    expect(interpretSafeChatText("como faço para pagar?")).toBe("REQUEST_INSTRUMENT");
    expect(interpretSafeChatText("onde está o boleto?")).toBe("REQUEST_INSTRUMENT");
    expect(interpretSafeChatText("posso pagar por aqui?")).toBe("REQUEST_INSTRUMENT");
  });

  it("normalizes accents, punctuation and common explanation spellings", () => {
    for (const text of ["explicação", "explicacao", "explique", "explicar", "me explica", "explicacaco", "não entendi", "NAO ENTENDI!", "como funciona?"]) {
      expect(interpretSafeChatText(text)).toBe("HELP");
    }
    for (const text of ["pagamento", "pagar", "onde pago?", "como pago", "como realizar o pagamento", "link de pagamento", "página de pagamento", "boleto", "Pix"]) {
      expect(interpretSafeChatText(text)).toBe("REQUEST_INSTRUMENT");
    }
    for (const text of ["aceitar", "aceito", "quero aceitar"]) expect(interpretSafeChatText(text)).toBe("ACCEPT_OFFER");
  });
});
