/**
 * State builders for Jev requests. Untrusted text (user messages, bot output,
 * connector payloads) is wrapped so Jev treats it as data, not instructions.
 */

const UNTRUSTED_OPEN = "[UNTRUSTED]";
const UNTRUSTED_CLOSE = "[/UNTRUSTED]";

export function markUntrusted(text: string): string {
  return `${UNTRUSTED_OPEN}${text}${UNTRUSTED_CLOSE}`;
}

export function buildDecisionState(parts: Record<string, unknown>): Record<string, unknown> {
  return { ...parts };
}

export function hashState(state: string | Record<string, unknown> | unknown[]): string {
  const payload = typeof state === "string" ? state : JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
