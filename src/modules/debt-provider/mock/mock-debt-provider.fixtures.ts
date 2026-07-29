import type {
  AuthorizedOffer,
  DebtDetails,
} from "../debt-provider.types";

export type MockIdentityChallengeFixture = Readonly<{
  challengeRef: string;
  prompt: string;
  options: readonly Readonly<{
    optionRef: string;
    label: string;
  }>[];
  correctOptionRef: string;
  maxAttempts: number;
}>;

export type MockDebtorFixture = Readonly<{
  debtorRef: string;
  demoIdentifier: string;
  maskedDisplayName: string;
  challenge: MockIdentityChallengeFixture;
  debts: readonly Readonly<{
    details: DebtDetails;
    offers: readonly AuthorizedOffer[];
  }>[];
}>;

export type MockCreditorFixture = Readonly<{
  creditorRef: string;
  displayName: string;
  debtors: readonly MockDebtorFixture[];
}>;

export type MockOrganizationFixture = Readonly<{
  organizationId: string;
  displayName: string;
  creditors: readonly MockCreditorFixture[];
}>;

const brl = (amountInCents: number) =>
  ({ amountInCents, currency: "BRL" }) as const;

export const mockOrganizations: readonly MockOrganizationFixture[] = [
  {
    organizationId: "org-jf-demo",
    displayName: "JF Solutions — Ambiente Fictício",
    creditors: [
      {
        creditorRef: "creditor-horizonte",
        displayName: "Credora Horizonte Demonstrativa",
        debtors: [
          {
            debtorRef: "debtor-001",
            demoIdentifier: "DEMO-AURORA-001",
            maskedDisplayName: "Pessoa Demonstração A.",
            challenge: {
              challengeRef: "challenge-aurora-horizonte",
              prompt: "Qual é a cor fictícia vinculada a esta demonstração?",
              options: [
                { optionRef: "option-blue", label: "Azul demo" },
                { optionRef: "option-green", label: "Verde demo" },
                { optionRef: "option-gold", label: "Dourado demo" },
              ],
              correctOptionRef: "option-green",
              maxAttempts: 3,
            },
            debts: [
              {
                details: {
                  debtRef: "debt-001",
                  debtorRef: "debtor-001",
                  creditor: {
                    creditorRef: "creditor-horizonte",
                    displayName: "Credora Horizonte Demonstrativa",
                  },
                  description: "Contrato fictício Horizonte 2026",
                  amount: brl(48_750),
                  dueDate: "2026-06-10",
                  status: "OPEN",
                  providerVersion: "debt-v1",
                },
                offers: [
                  {
                    offerRef: "offer-cash-001",
                    debtRef: "debt-001",
                    debtorRef: "debtor-001",
                    creditorRef: "creditor-horizonte",
                    providerVersion: "offer-v3",
                    terms: {
                      kind: "CASH",
                      total: brl(39_000),
                      downPayment: brl(39_000),
                      installmentCount: 1,
                      installmentAmount: brl(39_000),
                      firstDueDate: "2099-08-15",
                    },
                    expiresAt: "2099-08-15T23:59:59.000Z",
                    status: "AVAILABLE",
                  },
                  {
                    offerRef: "offer-installment-001",
                    debtRef: "debt-001",
                    debtorRef: "debtor-001",
                    creditorRef: "creditor-horizonte",
                    providerVersion: "offer-v2",
                    terms: {
                      kind: "INSTALLMENT",
                      total: brl(45_000),
                      downPayment: brl(7_500),
                      installmentCount: 6,
                      installmentAmount: brl(7_500),
                      firstDueDate: "2099-08-15",
                    },
                    expiresAt: "2099-08-15T23:59:59.000Z",
                    status: "AVAILABLE",
                  },
                  {
                    offerRef: "offer-expired-001",
                    debtRef: "debt-001",
                    debtorRef: "debtor-001",
                    creditorRef: "creditor-horizonte",
                    providerVersion: "offer-v1",
                    terms: {
                      kind: "CASH",
                      total: brl(30_000),
                      downPayment: brl(30_000),
                      installmentCount: 1,
                      installmentAmount: brl(30_000),
                      firstDueDate: "2025-01-10",
                    },
                    expiresAt: "2025-01-10T23:59:59.000Z",
                    status: "EXPIRED",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        creditorRef: "creditor-boreal",
        displayName: "Serviços Boreal Demonstrativos",
        debtors: [
          {
            debtorRef: "debtor-002",
            demoIdentifier: "DEMO-AURORA-001",
            maskedDisplayName: "Pessoa Demonstração A.",
            challenge: {
              challengeRef: "challenge-aurora-boreal",
              prompt: "Qual é a cor fictícia vinculada a esta demonstração?",
              options: [
                { optionRef: "option-blue", label: "Azul demo" },
                { optionRef: "option-green", label: "Verde demo" },
                { optionRef: "option-gold", label: "Dourado demo" },
              ],
              correctOptionRef: "option-green",
              maxAttempts: 3,
            },
            debts: [
              {
                details: {
                  debtRef: "debt-002",
                  debtorRef: "debtor-002",
                  creditor: {
                    creditorRef: "creditor-boreal",
                    displayName: "Serviços Boreal Demonstrativos",
                  },
                  description: "Serviço fictício Boreal",
                  amount: brl(12_990),
                  dueDate: "2026-07-01",
                  status: "OPEN",
                  providerVersion: "debt-v1",
                },
                offers: [],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    organizationId: "org-atlas-demo",
    displayName: "Cobrança Atlas — Ambiente Fictício",
    creditors: [
      {
        creditorRef: "creditor-horizonte",
        displayName: "Credora Horizonte Alternativa",
        debtors: [
          {
            debtorRef: "debtor-001",
            demoIdentifier: "DEMO-BENTO-002",
            maskedDisplayName: "Pessoa Demonstração B.",
            challenge: {
              challengeRef: "challenge-bento-atlas",
              prompt: "Qual é o símbolo fictício desta demonstração?",
              options: [
                { optionRef: "option-moon", label: "Lua demo" },
                { optionRef: "option-star", label: "Estrela demo" },
              ],
              correctOptionRef: "option-star",
              maxAttempts: 3,
            },
            debts: [
              {
                details: {
                  debtRef: "debt-001",
                  debtorRef: "debtor-001",
                  creditor: {
                    creditorRef: "creditor-horizonte",
                    displayName: "Credora Horizonte Alternativa",
                  },
                  description: "Contrato fictício exclusivo da Atlas",
                  amount: brl(91_200),
                  dueDate: "2026-05-20",
                  status: "OPEN",
                  providerVersion: "atlas-debt-v1",
                },
                offers: [
                  {
                    offerRef: "offer-cash-001",
                    debtRef: "debt-001",
                    debtorRef: "debtor-001",
                    creditorRef: "creditor-horizonte",
                    providerVersion: "atlas-offer-v1",
                    terms: {
                      kind: "CASH",
                      total: brl(82_080),
                      downPayment: brl(82_080),
                      installmentCount: 1,
                      installmentAmount: brl(82_080),
                      firstDueDate: "2099-08-20",
                    },
                    expiresAt: "2099-08-20T23:59:59.000Z",
                    status: "AVAILABLE",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

