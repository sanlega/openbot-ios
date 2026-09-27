import { monotonicFactory } from "ulid";

/**
 * OpenBot IDs are prefixed ULIDs (plan §4.1): `bot_ thr_ msg_ turn_ evt_ apr_
 * chn_ rule_ dec_ dev_ con_ ctask_ rtn_ rrun_ tev_`. ULIDs are lexicographically
 * sortable by creation time, which the event bus (WS1) and every `seq`-ordered
 * list in the Client API rely on.
 */
export const ID_PREFIXES = {
  bot: "bot_",
  thread: "thr_",
  message: "msg_",
  turn: "turn_",
  event: "evt_",
  approval: "apr_",
  chain: "chn_",
  rule: "rule_",
  decision: "dec_",
  device: "dev_",
  connection: "con_",
  computerTask: "ctask_",
  routine: "rtn_",
  routineRun: "rrun_",
  triggerEvent: "tev_",
  capCounter: "capctr_",
  inputRequest: "inp_",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ulid = monotonicFactory();

/** Generates a new prefixed ULID for the given entity kind, e.g. `newId("bot")` -> `bot_01ARZ...`. */
export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}${ulid()}`;
}

/** Returns true if `value` has the expected prefix for `kind` and a well-formed ULID suffix. */
export function isId(kind: IdKind, value: string): boolean {
  const prefix = ID_PREFIXES[kind];
  if (!value.startsWith(prefix)) return false;
  const suffix = value.slice(prefix.length);
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(suffix);
}
