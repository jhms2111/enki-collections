export function normalizeConversationalText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function requestsExplanation(value: string): boolean {
  const text = normalizeConversationalText(value);
  return /\b(explicacao|explicacaco|explique|explicar|explica|como funciona|nao entendi)\b/.test(text);
}
