export type SafeChatIntent = "HELP" | "LIST_DEBTS" | "LIST_OFFERS" | "UNKNOWN";

export function interpretSafeChatText(value: string): SafeChatIntent {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(ajuda|menu|opcoes)\b/.test(normalized)) return "HELP";
  if (/\b(divida|dividas|credor|credores)\b/.test(normalized)) return "LIST_DEBTS";
  if (/\b(proposta|propostas|acordo|acordos)\b/.test(normalized)) return "LIST_OFFERS";
  return "UNKNOWN";
}
