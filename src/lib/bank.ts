// Helpers for the hand-built answer bank (src/data/prompts.json).
import { buildIndex, canonicalOf, type AnswerIndex } from './match';

export interface PromptDef {
  id: string;
  prompt: string;
  /** "<answer>" or "<answer>|<alias>|..." -> starting tier 1-5 */
  answers: Record<string, number>;
}

/** Canonical answer -> starting tier. */
export function startingTiers(def: PromptDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, tier] of Object.entries(def.answers)) out[canonicalOf(key)] = tier;
  return out;
}

/**
 * Bank keys to match against, given the live tier map for the day.
 * Answers missing from `live` (e.g. banned) are dropped; answers only in `live`
 * (added from player data) are included as plain keys.
 */
export function liveBankKeys(def: PromptDef, live?: Record<string, number>): string[] {
  if (!live) return Object.keys(def.answers);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(def.answers)) {
    const canonical = canonicalOf(key);
    if (canonical in live) {
      keys.push(key);
      seen.add(canonical);
    }
  }
  for (const answer of Object.keys(live)) if (!seen.has(answer)) keys.push(answer);
  return keys;
}

export function liveIndex(def: PromptDef, live?: Record<string, number>): AnswerIndex {
  return buildIndex(liveBankKeys(def, live));
}

/** Shape of the published tiers.json (written by the Worker's nightly job). */
export interface TiersFile {
  version: number;
  /** Melbourne date the file was generated for. */
  date: string;
  generatedAt: string;
  minPlayers: number;
  prompts: Record<string, PromptTiers>;
}

export interface PromptTiers {
  usingPlayerData: boolean;
  /** Distinct players who have played this prompt (N). */
  players: number;
  /** Canonical answer -> live tier. */
  tiers: Record<string, number>;
}
