import { randomInt } from "node:crypto";

export const demoIdentifierPattern = /^DEMO-[A-Z0-9]{2,16}-[A-Z0-9]{3,8}$/;
const suffixAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genericWords = new Set(["CENARIO", "DEMO", "DEMONSTRATIVO", "DEMONSTRATIVA", "FICTICIO", "FICTICIA"]);

export function isDemoIdentifier(value: string): boolean {
  return value.length <= 48 && demoIdentifierPattern.test(value);
}

export function demoIdentifierShortName(name: string): string {
  const words = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return (words.find((word) => !genericWords.has(word)) ?? "LUMEN").slice(0, 16).padEnd(2, "X");
}

export function generateDemoIdentifier(name: string, suffixLength = 4): string {
  const suffix = Array.from({ length: suffixLength }, () => suffixAlphabet[randomInt(suffixAlphabet.length)]).join("");
  return `DEMO-${demoIdentifierShortName(name)}-${suffix}`;
}
