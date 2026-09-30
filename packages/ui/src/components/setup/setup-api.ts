import type { SetupState } from "@openbot/contracts";
import type { SetupValidateRequest } from "../../api/types.js";
import type { Transport } from "../../transport/index.js";

export type EngineId = "claude" | "codex";

/** One row of `GET /api/engines` (EngineStatus plus id/availability). */
export interface EngineInfo {
  id: string;
  installed?: boolean;
  version?: string;
  login?: { ok: boolean; account?: string };
  apiKey?: { ok: boolean };
  available?: boolean;
  descriptor?: { label: string; kind: "native" | "acp"; loginCommand?: string };
}

export interface ValidateResult {
  ok: boolean;
  reason?: string;
}

export async function validateSetup(
  transport: Transport,
  kind: SetupValidateRequest["kind"],
  value?: string,
): Promise<ValidateResult> {
  try {
    const res = await transport.post<{ result: ValidateResult }>("/api/setup/validate", {
      kind,
      value: value?.trim() ? value.trim() : undefined,
    } satisfies SetupValidateRequest);
    return res.result;
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function fetchEngines(transport: Transport): Promise<EngineInfo[]> {
  try {
    const res = await transport.get<{ engines?: EngineInfo[] }>("/api/engines");
    return res.engines ?? [];
  } catch {
    return [];
  }
}

export async function fetchSetup(transport: Transport): Promise<SetupState | null> {
  try {
    const res = await transport.get<{ setup: SetupState }>("/api/setup");
    return res.setup;
  } catch {
    return null;
  }
}

const NETWORK = "Couldn't reach OpenBot. Make sure the app is still running, then try again.";

/** Turns validator reasons into something a person can act on. */
export function friendlyError(kind: SetupValidateRequest["kind"], reason?: string): string {
  if (reason === "network") return NETWORK;
  switch (kind) {
    case "typesafe":
      return "That key didn't work. Check that you copied the whole key from your TypeSafe account and try again.";
    case "anthropic":
      return "Anthropic didn't accept that key. Check that it starts with sk-ant- and is still active.";
    case "openai":
      return "OpenAI didn't accept that key. Check that it's copied in full and is still active.";
    case "tailscale":
      return "Tailscale isn't installed or running on this computer. Install it from tailscale.com, sign in, then check again.";
    default:
      return reason && reason !== "Validation failed"
        ? reason
        : "Something went wrong. Please try again.";
  }
}
