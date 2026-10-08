// Server-side view of the answer bank: prompts.json plus moderation overrides.
import promptsJson from '../../src/data/prompts.json';
import { startingTiers, type PromptDef } from '../../src/lib/bank';
import { normalize } from '../../src/lib/match';

export interface Env {
  DB: D1Database;
  TIERS: KVNamespace;
  ADMIN_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
  IP_SALT?: string;
}

export const PROMPTS = promptsJson as unknown as PromptDef[];
export const PROMPTS_BY_ID = new Map(PROMPTS.map((p) => [p.id, p]));

export type OverrideStatus = 'approved' | 'rejected' | 'banned';

export interface Override {
  prompt_id: string;
  answer: string;
  status: OverrideStatus;
  starting_tier: number;
  source: string;
  updated_at: string;
}

export async function loadOverrides(db: D1Database): Promise<Override[]> {
  const { results } = await db.prepare('SELECT * FROM answer_overrides').all<Override>();
  return results ?? [];
}

export function overridesByPrompt(overrides: Override[]): Map<string, Map<string, Override>> {
  const out = new Map<string, Map<string, Override>>();
  for (const o of overrides) {
    let m = out.get(o.prompt_id);
    if (!m) out.set(o.prompt_id, (m = new Map()));
    m.set(o.answer, o);
  }
  return out;
}

/**
 * Live answers for a prompt: canonical answer -> starting tier.
 * Bank answers, plus approved overrides, minus banned ones.
 */
export function liveStartingTiers(def: PromptDef, overrides?: Map<string, Override>): Record<string, number> {
  const tiers = startingTiers(def);
  if (!overrides) return tiers;
  const byNorm = new Map(Object.keys(tiers).map((a) => [normalize(a), a]));
  for (const o of overrides.values()) {
    const existing = byNorm.get(o.answer);
    if (o.status === 'approved' && !existing) tiers[o.answer] = o.starting_tier;
    if (o.status === 'banned' && existing) delete tiers[existing];
  }
  return tiers;
}
