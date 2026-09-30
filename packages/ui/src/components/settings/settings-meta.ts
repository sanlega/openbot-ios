/**
 * Human labels for the settings the harness stores under internal keys.
 * Caps follow plan §2.2 (S1–S10); the harness uses long keys
 * (`s1_cosBotsCap`), older fixtures the short ones (`S1`), so both map here.
 */
export interface NumberSettingMeta {
  label: string;
  help: string;
  unit: string;
  group: "spawn" | "messages";
  order: number;
  min?: number;
}

const COS_BOTS: NumberSettingMeta = {
  label: "Bots the Chief of Staff can create",
  help: "Most bots it can keep in your roster at once. Bots you create yourself don't count.",
  unit: "bots",
  group: "spawn",
  order: 1,
};
const NEW_PER_DAY: NumberSettingMeta = {
  label: "New bots per day",
  help: "How many bots it may create in any rolling 24 hours.",
  unit: "per day",
  group: "spawn",
  order: 2,
};
const COOLDOWN: NumberSettingMeta = {
  label: "Cooldown between new bots",
  help: "Minimum wait after creating a bot before it can create another.",
  unit: "min",
  group: "spawn",
  order: 3,
};
const PER_BOT_HOUR: NumberSettingMeta = {
  label: "Messages per bot, per hour",
  help: "Unprompted messages any single bot may send you in an hour.",
  unit: "per hour",
  group: "messages",
  order: 4,
};
const PER_BOT_DAY: NumberSettingMeta = {
  label: "Messages per bot, per day",
  help: "Unprompted messages any single bot may send you in a day.",
  unit: "per day",
  group: "messages",
  order: 5,
};
const ALL_BOTS_HOUR: NumberSettingMeta = {
  label: "Messages from all bots, per hour",
  help: "Combined limit across every bot, so a busy team can't flood you.",
  unit: "per hour",
  group: "messages",
  order: 6,
};
const DEDUPE: NumberSettingMeta = {
  label: "Ignore repeats for",
  help: "A message that repeats one already sent in this window is dropped.",
  unit: "hours",
  group: "messages",
  order: 7,
};
const MERGE: NumberSettingMeta = {
  label: "Merge messages within",
  help: "Messages from the same bot this close together arrive as one.",
  unit: "min",
  group: "messages",
  order: 8,
};

export const CAP_META: Record<string, NumberSettingMeta> = {
  s1_cosBotsCap: COS_BOTS,
  S1: COS_BOTS,
  s2_newBotsPer24h: NEW_PER_DAY,
  S2: NEW_PER_DAY,
  s3_spawnCooldownMin: COOLDOWN,
  S3: COOLDOWN,
  s4_proactivePerBotPerHour: PER_BOT_HOUR,
  S4: PER_BOT_HOUR,
  s4_proactivePerBotPerDay: PER_BOT_DAY,
  s5_proactiveAllBotsPerHour: ALL_BOTS_HOUR,
  S5: ALL_BOTS_HOUR,
  s6_dedupeWindowHours: DEDUPE,
  S6: DEDUPE,
  s10_mergeWindowMin: MERGE,
  S10: MERGE,
};

export const BUDGET_META: Record<string, NumberSettingMeta> = {
  gates: {
    label: "Safety checks",
    help: "Yes/no checks before a bot is created, messages you, or takes a risky step.",
    unit: "req/min",
    group: "spawn",
    order: 1,
  },
  interactive: {
    label: "Chat routing",
    help: "Choosing the engine and model for the messages you send.",
    unit: "req/min",
    group: "spawn",
    order: 2,
  },
  computer: {
    label: "Computer use",
    help: "Step-by-step decisions while a bot operates a computer.",
    unit: "req/min",
    group: "spawn",
    order: 3,
  },
  background: {
    label: "Background work",
    help: "Routines, the daily digest, and other scheduled tasks.",
    unit: "req/min",
    group: "spawn",
    order: 4,
  },
};

/** Fallback for keys the UI doesn't know yet: `s7_fooBarBaz` → "Foo bar baz". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/^s\d+_/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function metaFor(table: Record<string, NumberSettingMeta>, key: string): NumberSettingMeta {
  return (
    table[key] ?? { label: humanizeKey(key), help: "", unit: "", group: "messages", order: 99 }
  );
}

const ENGINE_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  grok: "Grok Build",
  fake: "Test engine",
};

/** A friendly engine name; owner-added ACP agents are `acp-<slug>`. */
export function engineName(id: string): string {
  return ENGINE_NAMES[id] ?? humanizeKey(id.replace(/^acp-/, ""));
}

/** "vcodex-cli 0.157.1", "2.1.283 (Claude Code)" → "0.157.1", "2.1.283". */
export function cleanVersion(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = /\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(raw);
  return match ? match[0] : raw.replace(/^v/i, "");
}

export const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

/** "22:00" → "10 PM" style label, locale-aware. */
export function hourLabel(value: string): string {
  const [h = "0", m = "0"] = value.split(":");
  const date = new Date(2000, 0, 1, Number(h), Number(m));
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
