import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AcpProfile } from "./profile.js";
import { openCodeProfile } from "./profiles/opencode.js";
import {
  cursorProfile,
  customProfile,
  geminiProfile,
  grokProfile,
  type CustomAcpEngine,
} from "./profiles/others.js";

/** The ACP engines OpenBot ships, in the order Setup shows them. */
export function builtinAcpProfiles(): AcpProfile[] {
  return [openCodeProfile(), cursorProfile(), geminiProfile(), grokProfile()];
}

/** Owner's engine settings, read before engines are wired (so not in the database). */
export interface EnginePrefs {
  /** ACP agents the owner added by command line. */
  custom: CustomAcpEngine[];
}

export const CUSTOM_SLUG_RE = /^[a-z][a-z0-9-]{0,30}$/;
const FILE = "engines.json";

export function readEnginePrefs(openbotHome: string): EnginePrefs {
  try {
    const parsed = JSON.parse(
      readFileSync(join(openbotHome, FILE), "utf8"),
    ) as Partial<EnginePrefs>;
    const custom = (Array.isArray(parsed.custom) ? parsed.custom : []).filter(
      (e): e is CustomAcpEngine =>
        typeof e?.slug === "string" &&
        CUSTOM_SLUG_RE.test(e.slug) &&
        typeof e.label === "string" &&
        typeof e.command === "string" &&
        e.command.trim().length > 0 &&
        Array.isArray(e.args) &&
        e.args.every((a) => typeof a === "string"),
    );
    return { custom };
  } catch {
    return { custom: [] };
  }
}

/** Written to a temp file and renamed, so a crash never leaves a half-written file. */
export async function writeEnginePrefs(openbotHome: string, prefs: EnginePrefs): Promise<void> {
  await mkdir(openbotHome, { recursive: true });
  const target = join(openbotHome, FILE);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(prefs, null, 2)}\n`);
  await rename(temp, target);
}

export function customProfiles(prefs: EnginePrefs): AcpProfile[] {
  return prefs.custom.map(customProfile);
}
