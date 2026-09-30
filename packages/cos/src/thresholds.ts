import type { NotifyThresholds, SpawnThresholds } from "./types.js";

/** Plan O6 / research §11.2 starting thresholds (tunable from logged decisions). */
export const DEFAULT_SPAWN_THRESHOLDS: SpawnThresholds = {
  userRequestedMin: 0.8,
  routeConfidenceMin: 0.7,
  existingCanDoMax: 0.3,
  oneOffMax: 0.4,
  substantialWorkMin: 0.6,
  duplicatesExistingMax: 0.3,
  recurringOwnershipMin: 0.7,
  distinctBoundaryMin: 0.7,
  // Found via a live near-miss: route=new_bot at 0.97 confidence, recurring_ownership
  // 0.98, denied anyway because existing_can_do landed at 0.32 -- 0.02 over the 0.30
  // ceiling. The all-thresholds-must-pass rule let one borderline secondary signal
  // veto an otherwise overwhelming call. When Jev is this sure, tolerate more
  // uncertainty in existing_can_do instead of treating it as an absolute veto.
  routeConfidenceOverrideMin: 0.9,
  existingCanDoOverrideMax: 0.5,
};

/** Plan O6 / research §11.3 starting thresholds. */
export const DEFAULT_NOTIFY_THRESHOLDS: NotifyThresholds = {
  deliverMin: 0.7,
  noiseMax: 0.3,
  timeSensitiveMin: 0.7,
};
