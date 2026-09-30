import type { JevQuestion } from "@openbot/contracts";

/** Operations Jev may pick each step. `navigate` stays with the engine (Jev can't author URLs). */
export const COMPUTER_OPS = [
  "click",
  "type",
  "select",
  "scroll",
  "key",
  "wait",
  "done",
  "blocked",
] as const;

/** Keys Jev may press; drivers map these logical names to their own key codes. */
export const COMPUTER_KEYS = ["Enter", "Tab", "Escape"] as const;

const OP_CRITERIA: Record<string, string> = {
  click: "Click the target element (link, button, tab, checkbox, list item)",
  type: "Type text into the target input (the text itself comes from the engine)",
  select: "Choose an option in the target dropdown or list",
  scroll: "Scroll the page to reveal content that is not observed yet",
  key: "Press a key (Enter to submit, Tab to move, Escape to close)",
  wait: "Wait: the page is loading or changing",
  done: "The goal is already satisfied on this page; stop",
  blocked:
    "Only the user can continue: a login with no known credentials, a 2FA or verification code, a CAPTCHA, or a payment",
};

/**
 * WS9 fast-loop action pick (plan §4.5 / research §10). All questions are
 * evaluated in parallel against the same state, so key and scroll direction are
 * asked every step and read only when that op wins.
 */
export function buildComputerQuestions(
  observedIndices: string[],
  ops: readonly string[] = COMPUTER_OPS,
): Record<string, JevQuestion> {
  const targetCriteria: Record<string, string> = {
    none: "No element applies (wait, scroll, done, key, or blocked)",
  };
  for (const index of observedIndices) {
    targetCriteria[index] = `Observed element at index ${index}`;
  }

  const opCriteria: Record<string, string> = {};
  for (const op of ops) {
    opCriteria[op] = OP_CRITERIA[op] ?? `Perform ${op} on the chosen target`;
  }

  return {
    op: {
      type: "choice",
      instructions:
        "Given `goal`, `instructions` from the user, `recent_steps`, and `observed_elements`, which operation should run next?",
      criteria: opCriteria,
    },
    target_index: {
      type: "choice",
      instructions: "Which observed element index should the operation act on?",
      criteria: targetCriteria,
    },
    key_name: {
      type: "choice",
      instructions: "If a key should be pressed, which one?",
      criteria: {
        Enter: "Submit or confirm",
        Tab: "Move to the next field",
        Escape: "Close a dialog or menu",
      },
    },
    scroll_direction: {
      type: "choice",
      instructions: "If the page should scroll, in which direction?",
      criteria: { down: "Reveal content below", up: "Reveal content above" },
    },
    is_destructive: {
      type: "noul",
      instructions:
        "Would the chosen action spend money or permanently delete data or an account? Sending, connecting, posting or submitting what `goal` asks for is expected, not destructive.",
    },
  };
}

/**
 * One question per step: which of these described actions comes next. The
 * options are built by the loop from what's on screen ("Click button “Search”"),
 * so Jev never has to look indices up or pair an operation with a target.
 */
export function buildComputerActionQuestions(
  candidates: ReadonlyArray<{ id: string; description: string }>,
): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.id] = c.description;
  return {
    action: {
      type: "choice",
      instructions:
        "Given `goal`, the user's `instructions`, `recent_steps` and the page (`url`, `title`), which single action moves toward the goal next? Pick `done` only if the page already shows the goal achieved.",
      criteria,
    },
    is_destructive: {
      type: "noul",
      instructions:
        "Does that single action, by itself and right now, spend money or permanently delete data or an account (e.g. the final Delete/Pay button)? Judge only this click or keystroke, not the goal: opening pages, menus or settings on the way is not destructive, and neither is sending, connecting, posting or submitting what `goal` asks for.",
    },
  };
}
