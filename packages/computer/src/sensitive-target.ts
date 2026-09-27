/** Plan WS2/WS9: broker "ask" rules for sensitive computer targets. */
export const SENSITIVE_TARGET_PATTERN = /pay|buy|send|delete|transfer|submit order|confirm/i;

export function isSensitiveLabel(label: string): boolean {
  return SENSITIVE_TARGET_PATTERN.test(label);
}
