import { describe, expect, it, vi } from "vitest";

const permanentRedirect = vi.fn(() => {
  throw new Error("redirected");
});

vi.mock("next/navigation", () => ({ permanentRedirect }));

describe("legacy public access URL", () => {
  it("permanently redirects to the public demo without accepting a code", async () => {
    const { default: DemoAccessPage } = await import("@/app/demo-access/page");
    expect(() => DemoAccessPage()).toThrow("redirected");
    expect(permanentRedirect).toHaveBeenCalledWith("/demo/jf-demo");
  });
});
