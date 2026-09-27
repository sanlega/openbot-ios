const REDACTED = "[REDACTED]";

/** Patterns that commonly appear in connector/API secrets. */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}\b/g,
  /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^\s"',}{]+/gi,
  /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
];

/** Returns true if `text` looks like it contains a secret that must not be logged. */
export function containsLikelySecret(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

/** Redacts known secret patterns from a string (for logs/NDJSON safety checks). */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** Deep-walks JSON-ish values and redacts string leaves. */
export function redactValue(value: unknown, knownSecrets: string[] = []): unknown {
  if (typeof value === "string") {
    let out = redactSecrets(value);
    for (const secret of knownSecrets) {
      if (secret.length >= 8) out = out.split(secret).join(REDACTED);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, knownSecrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = redactValue(nested, knownSecrets);
    }
    return out;
  }
  return value;
}

/** Asserts no known secret literals appear in serialized output. */
export function assertNoSecrets(text: string, secrets: string[]): void {
  for (const secret of secrets) {
    if (secret.length >= 8 && text.includes(secret)) {
      throw new Error(`Secret leaked into output (${secret.slice(0, 4)}…)`);
    }
  }
  if (containsLikelySecret(text)) {
    throw new Error("Output contains a likely secret pattern");
  }
}
