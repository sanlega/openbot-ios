import type { Action, Observation, ObservedElement } from "@openbot/contracts";

/**
 * One thing the loop could do next, described in words so Jev picks an action
 * ("click button “Search”") instead of an operation and an index separately.
 * Research: element text in the option roughly doubles step accuracy over bare
 * indices (SeeAct), and one question can't come back with a mismatched pair.
 */
export interface Candidate {
  /** Choice key sent to Jev: `click_12`, `type_4`, `enter`, `done`, … */
  id: string;
  description: string;
  action: Action;
  element?: ObservedElement;
  /** Undoable and harmless enough to run when Jev clearly leans to it. */
  reversible: boolean;
}

const TEXT_ROLES = /^(input|textarea|textbox|searchbox|combobox|password)$/i;
const SELECT_ROLES = /^(select|listbox)$/i;
const CLICK_ROLES =
  /^(a|link|button|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|option|treeitem|summary|input)$/i;

/** Enough choices to cover a page's controls, few enough for a classifier. */
export const MAX_ELEMENT_CANDIDATES = 24;

const STOPWORDS = new Set(
  "the and for then that this with from into open click search page first result results on in of to a an its it is".split(
    " ",
  ),
);

/** Words of the goal worth matching against labels ("sanlega", "invoice", …). */
function goalWords(goal: string | undefined): string[] {
  if (!goal) return [];
  return [
    ...new Set(
      goal
        .toLowerCase()
        .split(/[^\p{L}\p{N}@._-]+/u)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
    ),
  ];
}

export function buildCandidates(
  observation: Observation,
  options: { typedRecently?: boolean; goal?: string; allowBlocked?: boolean } = {},
): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  let elementCount = 0;

  // Elements that mention the goal come first (in page order), so a page with
  // a long header and filter bar can't push the relevant result past the cap.
  const words = goalWords(options.goal);
  const mentions = (el: ObservedElement) => {
    const label = el.label.toLowerCase();
    return words.some((w) => label.includes(w));
  };
  const ordered = words.length
    ? [
        ...observation.elements.filter(mentions),
        ...observation.elements.filter((el) => !mentions(el)),
      ]
    : observation.elements;

  for (const el of ordered) {
    if (elementCount >= MAX_ELEMENT_CANDIDATES) break;
    const label = el.label.replace(/\s+/g, " ").trim();
    if (!label || label.length < 2) continue;
    const name = label.length > 70 ? `${label.slice(0, 67)}…` : label;
    const role = el.role.toLowerCase();

    let candidate: Candidate | undefined;
    if (TEXT_ROLES.test(role)) {
      const value = el.value ? ` (now holds “${el.value.slice(0, 40)}”)` : "";
      candidate = {
        id: `type_${el.index}`,
        description: `Type into ${role} “${name}”${value}`,
        action: { op: "type", target: el.index },
        element: el,
        reversible: false,
      };
    } else if (SELECT_ROLES.test(role)) {
      candidate = {
        id: `select_${el.index}`,
        description: `Choose an option in ${role} “${name}”`,
        action: { op: "select", target: el.index },
        element: el,
        reversible: true,
      };
    } else if (CLICK_ROLES.test(role)) {
      candidate = {
        id: `click_${el.index}`,
        description: `Click ${role === "a" ? "link" : role} “${name}”`,
        action: { op: "click", target: el.index },
        element: el,
        reversible: true,
      };
    }
    if (!candidate) continue;
    // Repeated tiles and duplicated labels only dilute the choice.
    const key = `${candidate.action.op}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    elementCount += 1;
  }

  const enter: Candidate = {
    id: "enter",
    description: "Press Enter to submit what was just typed",
    action: { op: "key", text: "Enter" },
    reversible: false,
  };
  candidates.push(
    ...(options.typedRecently ? [enter] : []),
    // Offered only when something looks like a popup: otherwise it's a distractor.
    ...(hasPopup(observation)
      ? [
          {
            id: "escape",
            description: "Press Escape to close a popup, menu or dialog",
            action: { op: "key", text: "Escape" } as Action,
            reversible: true,
          },
        ]
      : []),
    {
      id: "scroll_down",
      description: "Scroll down to see more of the page",
      action: { op: "scroll", text: "down" },
      reversible: true,
    },
    {
      id: "scroll_up",
      description: "Scroll back up",
      action: { op: "scroll", text: "up" },
      reversible: true,
    },
    {
      id: "wait",
      description: "Wait: the page is still loading or changing",
      action: { op: "wait" },
      reversible: true,
    },
    {
      id: "done",
      description: "Stop: the goal is already achieved on this page",
      action: { op: "done" },
      reversible: false,
    },
    ...(options.allowBlocked === false
      ? []
      : [
          {
            id: "blocked",
            description:
              "Stop: only the user can continue (a login with no saved credentials, a 2FA or verification code, a CAPTCHA, a payment). Never for a confirmation dialog or a cookie notice: click those.",
            action: { op: "blocked" } as Action,
            reversible: false,
          },
        ]),
  );
  return candidates;
}

export function hasPopup(observation: Observation): boolean {
  return observation.elements.some(
    (el) =>
      /^(dialog|alertdialog|menu|listbox)$/i.test(el.role) ||
      /^(close|dismiss|×|✕|x)$/i.test(el.label.trim()),
  );
}

/** The candidate id for an operation on an observed index (tests and evals script steps this way). */
export function candidateId(op: string, target?: string | number): string {
  if (target !== undefined && target !== "none" && ["click", "type", "select"].includes(op)) {
    return `${op}_${target}`;
  }
  if (op === "key") return "enter";
  if (op === "scroll") return "scroll_down";
  return op;
}
