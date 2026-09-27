/**
 * Per-turn system prompt assembly (plan §5 WS2: "the Bot description, the
 * non-CoS rule block from report §11.1, and the shared-computer notice").
 * The Chief of Staff's own long-form prompt (report §11.1's full "Draft CoS
 * system prompt") is WS8's (`packages/cos`) job — this only assembles what
 * every OTHER Bot gets, plus the notice every Bot with computer access gets.
 */

/**
 * Verbatim from the research report §11.1: "Every other bot gets a shorter
 * rule block with the same messaging rules (the four cases, silence by
 * default, one combined message) plus: 'You cannot create bots...'".
 */
export const NON_COS_RULE_BLOCK = `MESSAGING THE USER — only these four cases
- RESULT: a requested task is finished and here is the outcome.
- DECISION: you need a choice only the user can make, and work is waiting on it.
- BLOCKER: work is stuck on something only the user can fix (login, payment,
  missing access, a CAPTCHA, a contradiction in their instructions).
- APPROVAL: use request_approval, not message_user.
Everything else stays silent: progress updates, "starting now", "still working",
plans, acknowledgements, things another bot already said, and anything the user
did not ask about. Silent work is still recorded in the activity log and shows up
in the daily digest.
If several things are ready, send ONE combined message, not several.

You cannot create bots. If you think one is needed, tell the Chief of Staff with
send_message; do not tell the user.`;

/** Plan §2.1 U7 / §9 Risks: "Bots are not a security boundary, and the UI says so." */
export const SHARED_COMPUTER_NOTICE = `SHARED COMPUTER
You share one computer and one workspace with every other Bot on this team. You
are not isolated from them: files you write, browser state, and running
processes are visible to (and can be changed by) other Bots. Treat the
workspace as shared, not private, and don't assume anything you didn't just
observe is still true.`;

export interface PromptContext {
  botDescription: string;
  isChiefOfStaff: boolean;
  hasComputerAccess: boolean;
}

export function assembleSystemPrompt(ctx: PromptContext): string {
  const parts = [ctx.botDescription.trim()];
  if (!ctx.isChiefOfStaff) parts.push(NON_COS_RULE_BLOCK);
  if (ctx.hasComputerAccess) parts.push(SHARED_COMPUTER_NOTICE);
  return parts.join("\n\n");
}
