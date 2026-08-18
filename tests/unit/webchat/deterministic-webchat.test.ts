import { describe, expect, it, vi } from "vitest";

import {
  extractDemoIdentifier,
  isExactPendingConfirmation,
  scrollChatEnd,
} from "@/modules/webchat/deterministic-webchat";

describe("deterministic webchat scrolling", () => {
  it("does not call a missing optional scrollIntoView implementation", () => {
    expect(() => scrollChatEnd({} as HTMLDivElement)).not.toThrow();
    expect(() => scrollChatEnd(null)).not.toThrow();
  });

  it("scrolls to the newest message when the browser provides the method", () => {
    const scrollIntoView = vi.fn();
    scrollChatEnd({ scrollIntoView } as unknown as HTMLDivElement);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
    });
  });
});

describe("conversational demonstration identifier", () => {
  it("extracts only a canonical DEMO identifier from natural text", () => {
    expect(extractDemoIdentifier("meu localizador é demo-aurora-001")).toBe("DEMO-AURORA-001");
    expect(extractDemoIdentifier("meu CPF é 123.456.789-00")).toBeNull();
  });
});

describe("typed operation confirmation", () => {
  const pending = {
    conversationId: "conversation-a",
    kind: "ACCEPT" as const,
    fingerprint: "opaque-fingerprint",
    expiresAt: 2_000,
  };

  it("accepts only the exact phrase for the matching conversation before expiry", () => {
    expect(isExactPendingConfirmation(pending, "CONFIRMO O ACEITE", "conversation-a", 1_000)).toBe(true);
    expect(isExactPendingConfirmation(pending, "confirmo o aceite", "conversation-a", 1_000)).toBe(false);
    expect(isExactPendingConfirmation(pending, "CONFIRMO O ACEITE", "conversation-b", 1_000)).toBe(false);
    expect(isExactPendingConfirmation(pending, "CONFIRMO O ACEITE", "conversation-a", 2_000)).toBe(false);
  });
});
