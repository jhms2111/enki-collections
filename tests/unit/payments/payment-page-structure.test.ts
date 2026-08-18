import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve("src/modules/payments/payment-page.tsx"), "utf8");
const route = readFileSync(resolve("src/app/api/v1/public/organizations/[slug]/payment-instruments/route.ts"), "utf8");

describe("demonstrative payment page", () => {
  it("requires textual confirmation and renders provider output only as text", () => {
    expect(page).toContain("CONFIRMO O INSTRUMENTO");
    expect(page).toContain("DEMONSTRAÇÃO — SEM VALOR FINANCEIRO");
    expect(page).toContain("{result.displayValue}");
    expect(page).not.toMatch(/dangerouslySetInnerHTML|<img\b|<iframe\b/);
  });

  it("uses a generic session-authenticated endpoint with a strict request", () => {
    expect(route).toContain("conversationCookieName");
    expect(route).not.toMatch(/conversationId|acceptanceId|debtRef|offerRef/);
    expect(page).not.toMatch(/\?(conversationId|acceptanceId|debtRef|offerRef|token)=/);
  });
});
