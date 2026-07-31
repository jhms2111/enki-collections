type StoredIntent = Readonly<{ key: string; fingerprint: string }>;

export function getIntentKey(
  scope: string,
  fingerprint: string,
): string {
  const storageKey = `enki-demo:intent:${scope}`;
  const raw = sessionStorage.getItem(storageKey);
  if (raw) {
    try {
      const stored = JSON.parse(raw) as StoredIntent;
      if (stored.fingerprint === fingerprint) return stored.key;
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }
  const key = `web:${crypto.randomUUID()}`;
  sessionStorage.setItem(
    storageKey,
    JSON.stringify({ key, fingerprint } satisfies StoredIntent),
  );
  return key;
}

export function clearIntentKey(scope: string): void {
  sessionStorage.removeItem(`enki-demo:intent:${scope}`);
}
