import type { NotifyThresholds, SpawnThresholds } from "./types.js";

/** Plan O6 / research §11.2 starting thresholds (tunable from logged decisions). */
export const DEFAULT_SPAWN_THRESHOLDS: SpawnThresholds = {
  userRequestedMin: 0.8,
  routeConfidenceMin: 0.7,
  existingCanDoMax: 0.3,
  oneOffMax: 0.4,
  duplicatesExistingMax: 0.3,
  recurringOwnershipMin: 0.7,
  distinctBoundaryMin: 0.7,
};

/** Plan O6 / research §11.3 starting thresholds. */
export const DEFAULT_NOTIFY_THRESHOLDS: NotifyThresholds = {
  deliverMin: 0.7,
  noiseMax: 0.3,
  timeSensitiveMin: 0.7,
};
