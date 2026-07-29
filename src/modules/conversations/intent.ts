export const deterministicIntents = [
  "IDENTIFY_SELF",
  "VERIFY_IDENTITY",
  "LIST_DEBTS",
  "SELECT_CREDITOR",
  "SELECT_DEBT",
  "LIST_OFFERS",
  "SELECT_OFFER",
  "ACCEPT_OFFER",
  "REQUEST_INSTRUMENT",
  "MAKE_PAYMENT_PROMISE",
  "REPORT_PAYMENT",
  "DISPUTE_DEBT",
  "REQUEST_HUMAN",
  "OPT_OUT",
  "HELP",
  "UNKNOWN",
] as const;

export type DeterministicIntent = (typeof deterministicIntents)[number];

