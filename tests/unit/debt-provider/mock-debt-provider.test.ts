import { beforeEach, describe, expect, it } from "vitest";

import { MockDebtProvider } from "@/modules/debt-provider/mock/mock-debt-provider";
import type {
  AuthorizedOffer,
  VerifiedDebtorContext,
} from "@/modules/debt-provider/debt-provider.types";
import type { OrganizationContext } from "@/modules/organizations/organization-context";

const jfOrganization: OrganizationContext = {
  organizationId: "org-jf-demo",
  requestId: "request-jf-001",
};

const atlasOrganization: OrganizationContext = {
  organizationId: "org-atlas-demo",
  requestId: "request-atlas-001",
};

async function verifyJfDebtor(
  provider: MockDebtProvider,
): Promise<VerifiedDebtorContext> {
  const identification = await provider.identifyDebtor(jfOrganization, {
    type: "DEMO_ID",
    value: "DEMO-AURORA-001",
  });
  if (!identification) {
    throw new Error("Fixture de identificação ausente.");
  }
  const challenge = await provider.getIdentityChallenge(
    jfOrganization,
    identification.identificationRef,
  );
  const verification = await provider.verifyIdentity(
    jfOrganization,
    identification.identificationRef,
    challenge.challengeRef,
    "option-green",
  );
  if (!verification.verified) {
    throw new Error("Fixture de verificação inválida.");
  }
  return verification.debtorContext;
}

async function getOffer(
  provider: MockDebtProvider,
  debtor: VerifiedDebtorContext,
  offerRef = "offer-cash-001",
): Promise<AuthorizedOffer> {
  return provider.getAuthorizedOffer(jfOrganization, debtor, offerRef);
}

describe("MockDebtProvider", () => {
  let provider: MockDebtProvider;

  beforeEach(() => {
    provider = new MockDebtProvider(undefined, () => new Date("2026-07-29"));
  });

  it("does not expose debts before server-side identity verification", async () => {
    await expect(
      provider.listDebts(jfOrganization, {
        verificationRef: "forged",
        authorizedAccounts: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_DEBTOR_CONTEXT", status: 403 });
  });

  it("keeps the expected challenge answer on the server", async () => {
    const identification = await provider.identifyDebtor(jfOrganization, {
      type: "DEMO_ID",
      value: "DEMO-AURORA-001",
    });
    expect(identification).not.toBeNull();
    const challenge = await provider.getIdentityChallenge(
      jfOrganization,
      identification!.identificationRef,
    );

    expect(challenge).not.toHaveProperty("correctOptionRef");
  });

  it("restores a server-only challenge after a provider process restart", async () => {
    const identification = await provider.identifyDebtor(jfOrganization, {
      type: "DEMO_ID",
      value: "DEMO-AURORA-001",
    });
    const restartedProvider = new MockDebtProvider(
      undefined,
      () => new Date("2026-07-29"),
    );

    const challenge = await restartedProvider.getIdentityChallenge(
      jfOrganization,
      identification!.identificationRef,
    );

    expect(challenge.challengeRef).toBe("challenge-aurora-horizonte");
    expect(challenge).not.toHaveProperty("correctOptionRef");
  });

  it("blocks identity verification after consecutive failures", async () => {
    const identification = await provider.identifyDebtor(jfOrganization, {
      type: "DEMO_ID",
      value: "DEMO-AURORA-001",
    });
    const challenge = await provider.getIdentityChallenge(
      jfOrganization,
      identification!.identificationRef,
    );

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await provider.verifyIdentity(
        jfOrganization,
        identification!.identificationRef,
        challenge.challengeRef,
        "option-blue",
      );
      expect(result).toMatchObject({ verified: false, blocked: false });
    }

    const blocked = await provider.verifyIdentity(
      jfOrganization,
      identification!.identificationRef,
      challenge.challengeRef,
      "option-blue",
    );
    expect(blocked).toEqual({
      verified: false,
      attemptsRemaining: 0,
      blocked: true,
    });

    const correctAfterBlock = await provider.verifyIdentity(
      jfOrganization,
      identification!.identificationRef,
      challenge.challengeRef,
      "option-green",
    );
    expect(correctAfterBlock).toMatchObject({
      verified: false,
      blocked: true,
    });
  });

  it("groups authorized accounts under two creditors in the same organization", async () => {
    const debtor = await verifyJfDebtor(provider);
    const debts = await provider.listDebts(jfOrganization, debtor);

    expect(debts).toHaveLength(2);
    expect(new Set(debts.map((debt) => debt.creditor.creditorRef))).toEqual(
      new Set(["creditor-horizonte", "creditor-boreal"]),
    );
  });

  it("isolates overlapping references between two organizations", async () => {
    const jfDebtor = await verifyJfDebtor(provider);
    const atlasIdentification = await provider.identifyDebtor(
      atlasOrganization,
      {
        type: "DEMO_ID",
        value: "DEMO-BENTO-002",
      },
    );
    const atlasChallenge = await provider.getIdentityChallenge(
      atlasOrganization,
      atlasIdentification!.identificationRef,
    );
    const atlasVerification = await provider.verifyIdentity(
      atlasOrganization,
      atlasIdentification!.identificationRef,
      atlasChallenge.challengeRef,
      "option-star",
    );
    if (!atlasVerification.verified) {
      throw new Error("Fixture Atlas inválida.");
    }

    const jfDebt = await provider.getDebt(
      jfOrganization,
      jfDebtor,
      "debt-001",
    );
    const atlasDebt = await provider.getDebt(
      atlasOrganization,
      atlasVerification.debtorContext,
      "debt-001",
    );

    expect(jfDebt.amount.amountInCents).toBe(48_750);
    expect(atlasDebt.amount.amountInCents).toBe(91_200);
    await expect(
      provider.getDebt(atlasOrganization, jfDebtor, "debt-001"),
    ).rejects.toMatchObject({ code: "INVALID_DEBTOR_CONTEXT" });
  });

  it("rejects an expired authorized offer", async () => {
    const debtor = await verifyJfDebtor(provider);
    const offer = await getOffer(provider, debtor, "offer-expired-001");

    await expect(
      provider.acceptOffer(jfOrganization, debtor, {
        idempotencyKey: "accept:expired:request-001",
        offerRef: offer.offerRef,
        expectedProviderVersion: offer.providerVersion,
        expectedTerms: offer.terms,
        acceptedAt: "2026-07-29T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "OFFER_EXPIRED", status: 409 });
  });

  it("rejects an altered offer snapshot", async () => {
    const debtor = await verifyJfDebtor(provider);
    const offer = await getOffer(provider, debtor);

    await expect(
      provider.acceptOffer(jfOrganization, debtor, {
        idempotencyKey: "accept:altered:request-001",
        offerRef: offer.offerRef,
        expectedProviderVersion: offer.providerVersion,
        expectedTerms: {
          ...offer.terms,
          total: { amountInCents: 1, currency: "BRL" },
        },
        acceptedAt: "2026-07-29T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "OFFER_CHANGED", status: 409 });
  });

  it("returns the same acceptance for a repeated idempotency key", async () => {
    const debtor = await verifyJfDebtor(provider);
    const offer = await getOffer(provider, debtor);
    const input = {
      idempotencyKey: "accept:repeat:request-001",
      offerRef: offer.offerRef,
      expectedProviderVersion: offer.providerVersion,
      expectedTerms: offer.terms,
      acceptedAt: "2026-07-29T12:00:00.000Z",
    };

    const first = await provider.acceptOffer(jfOrganization, debtor, input);
    const repeated = await provider.acceptOffer(
      jfOrganization,
      debtor,
      input,
    );

    expect(repeated).toBe(first);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const debtor = await verifyJfDebtor(provider);
    const offer = await getOffer(provider, debtor);
    const input = {
      idempotencyKey: "accept:conflict:request-001",
      offerRef: offer.offerRef,
      expectedProviderVersion: offer.providerVersion,
      expectedTerms: offer.terms,
      acceptedAt: "2026-07-29T12:00:00.000Z",
    };
    await provider.acceptOffer(jfOrganization, debtor, input);

    await expect(
      provider.acceptOffer(jfOrganization, debtor, {
        ...input,
        expectedProviderVersion: "different-version",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("creates only technically non-payable demonstration instruments", async () => {
    const debtor = await verifyJfDebtor(provider);
    const offer = await getOffer(provider, debtor);
    const acceptance = await provider.acceptOffer(jfOrganization, debtor, {
      idempotencyKey: "accept:instrument:request-001",
      offerRef: offer.offerRef,
      expectedProviderVersion: offer.providerVersion,
      expectedTerms: offer.terms,
      acceptedAt: "2026-07-29T12:00:00.000Z",
    });

    for (const type of [
      "DEMO_LINK",
      "DEMO_BOLETO",
      "DEMO_PIX",
    ] as const) {
      const instrument = await provider.createPaymentInstrument(
        jfOrganization,
        debtor,
        {
          idempotencyKey: `instrument:${type}:request-001`,
          acceptanceRef: acceptance.acceptanceRef,
          type,
        },
      );
      expect(instrument.isDemo).toBe(true);
      expect(instrument.warning).toBe(
        "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO",
      );
      expect(instrument.displayValue).not.toMatch(/^https?:\/\//);
      expect(instrument.displayValue).not.toMatch(/^\d{44,48}$/);
      expect(instrument.displayValue).not.toMatch(/^000201/);
    }
  });
});
