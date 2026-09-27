import { PROTOCOL } from "./config.js";
import type { DeepLinkTarget } from "./types.js";

const THREAD_RE = /^openbot:\/\/thread\/([a-zA-Z0-9_]+)$/;
const SETUP_RE = /^openbot:\/\/setup$/;
const HOME_RE = /^openbot:\/\/(?:home)?$/;

/** Parses `openbot://` deep links used for notification clicks and external opens. */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  const normalized = url.trim();
  if (THREAD_RE.test(normalized)) {
    const match = THREAD_RE.exec(normalized);
    const threadId = match?.[1];
    if (!threadId) return null;
    return { kind: "thread", threadId };
  }
  if (SETUP_RE.test(normalized)) return { kind: "setup" };
  if (HOME_RE.test(normalized) || normalized === `${PROTOCOL}:`) return { kind: "home" };
  return null;
}

export function threadDeepLink(threadId: string): string {
  return `openbot://thread/${threadId}`;
}
