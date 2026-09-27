import type { Bot, BotJustification } from "@openbot/contracts";
import type { BotWhyPanel } from "./types.js";

/**
 * Build the "Why does this bot exist?" panel data (research §11.5).
 * Spawn probabilities come from the logged Jev decision answers.
 */
export function buildBotWhyPanel(
  bot: Bot,
  spawnProbabilities: Record<string, number>,
): BotWhyPanel | null {
  if (!bot.justification) return null;
  return {
    bot,
    justification: bot.justification,
    spawnProbabilities,
  };
}

/** Create a `BotJustification` from a successful spawn gate decision. */
export function justificationFromSpawn(
  input: {
    responsibility: string;
    whyNotExisting: string;
    lifetime: BotJustification["lifetime"];
    boundary: string[];
    userRequested: boolean;
  },
  spawnDecisionId: string,
): BotJustification {
  return {
    responsibility: input.responsibility,
    whyNotExisting: input.whyNotExisting,
    lifetime: input.lifetime,
    boundary: input.boundary,
    userRequested: input.userRequested,
    spawnDecisionId,
  };
}

/** Extract spawn probabilities from Jev answers for the profile panel. */
export function spawnProbabilitiesFromAnswers(
  answers: Record<string, { type: string; noul?: number; confidence?: number }>,
): Record<string, number> {
  const probs: Record<string, number> = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (answer.type === "noul" && answer.noul !== undefined) {
      probs[id] = answer.noul;
    } else if (answer.type === "choice" && answer.confidence !== undefined) {
      probs[`${id}_confidence`] = answer.confidence;
    }
  }
  return probs;
}
