import { describe, expect, it, vi } from "vitest";

import { scrollChatEnd, shouldSubmitComposerKey } from "@/modules/webchat/deterministic-webchat";

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

describe("webchat composer keyboard", () => {
  it("submits with Enter", () => {
    expect(shouldSubmitComposerKey("Enter", false)).toBe(true);
  });

  it("keeps a new line with Shift+Enter", () => {
    expect(shouldSubmitComposerKey("Enter", true)).toBe(false);
  });

  it("does not submit for other keys", () => {
    expect(shouldSubmitComposerKey(" ", false)).toBe(false);
  });
});
