import { describe, expect, it } from "vitest";

import { assertConversationTransition } from "@/modules/conversations/conversation-state";

describe("assertConversationTransition", () => {
  it("allows the deterministic identity flow", () => {
    expect(() =>
      assertConversationTransition("IDENTIFIED", "IDENTITY_VERIFIED"),
    ).not.toThrow();
  });

  it("does not reveal debts before identity verification", () => {
    expect(() =>
      assertConversationTransition("STARTED", "DEBT_SELECTED"),
    ).toThrowError(/Transição inválida/);
  });

  it("does not resume negotiation after opt-out", () => {
    expect(() =>
      assertConversationTransition("OPTED_OUT", "DEBT_SELECTED"),
    ).toThrowError(/Transição inválida/);
  });

  it("keeps both terminal states from transitioning", () => {
    expect(() => assertConversationTransition("OPTED_OUT", "CLOSED")).toThrow();
    expect(() => assertConversationTransition("CLOSED", "STARTED")).toThrow();
  });
});
