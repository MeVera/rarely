// Rarity tiers and points, shared by the browser, the Worker and the tests.
// Every tunable number is a named export.

/** Points for tiers 1..5 (index 0 = tier 1). */
export const TIER_POINTS = [10, 30, 60, 85, 100] as const;
export const TIER_LABELS = ['Common', 'Solid', 'Uncommon', 'Rare', 'Rarest'] as const;
export const MIN_TIER = 1;
export const MAX_TIER = 5;

/** A prompt needs this many distinct players before player data is used. */
export const MIN_PLAYERS = 100;

/** Prior share of players expected to give an answer, by starting tier 1..5. */
export const TIER_PRIORS = [0.4, 0.15, 0.05, 0.015, 0.003] as const;
/** Weight of the prior, in "virtual players". */
export const PRIOR_WEIGHT_K = 20;

/** r = log10(1/share); tier = 1 + clamp(ceil((r - RARITY_OFFSET) / RARITY_STEP), 0, 4) */
export const RARITY_OFFSET = 0.6;
export const RARITY_STEP = 0.5;

/** Starting tier used for answers added from player data (auto or admin approved). */
export const NEW_ANSWER_STARTING_TIER = 5;
/** Distinct players needed before an unlisted answer is auto-added. */
export const AUTO_ADD_MIN_PLAYERS = 10;

export function clampTier(tier: number): number {
  if (!Number.isFinite(tier)) return MAX_TIER;
  return Math.min(MAX_TIER, Math.max(MIN_TIER, Math.round(tier)));
}

/** Smoothed share of players who give this answer. */
export function smoothedShare(startingTier: number, n: number, N: number): number {
  const prior = TIER_PRIORS[clampTier(startingTier) - 1];
  return (n + PRIOR_WEIGHT_K * prior) / (N + PRIOR_WEIGHT_K);
}

export function tierFromShare(share: number): number {
  const r = Math.log10(1 / share);
  const steps = Math.ceil((r - RARITY_OFFSET) / RARITY_STEP);
  return MIN_TIER + Math.min(MAX_TIER - MIN_TIER, Math.max(0, steps));
}

/**
 * Live tier for one answer.
 * @param startingTier hand-assigned tier from prompts.json (1-5)
 * @param n distinct players who gave this answer
 * @param N distinct players who have played this prompt
 */
export function computeTier(startingTier: number, n: number, N: number): number {
  if (N < MIN_PLAYERS) return clampTier(startingTier);
  return tierFromShare(smoothedShare(startingTier, n, N));
}

export function pointsForTier(tier: number): number {
  return TIER_POINTS[clampTier(tier) - 1];
}

export function labelForTier(tier: number): string {
  return TIER_LABELS[clampTier(tier) - 1];
}
