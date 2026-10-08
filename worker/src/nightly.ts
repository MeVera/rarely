// Nightly job: auto-add popular unlisted answers, recompute tiers, publish tiers.json.
import type { TiersFile } from '../../src/lib/bank';
import { dateString } from '../../src/lib/daily';
import { buildIndex, matchAnswer } from '../../src/lib/match';
import {
  AUTO_ADD_MIN_PLAYERS, computeTier, MIN_PLAYERS, NEW_ANSWER_STARTING_TIER,
} from '../../src/lib/scoring';
import { isBlocked } from './blocklist';
import { liveStartingTiers, loadOverrides, overridesByPrompt, PROMPTS, type Env } from './live';

export const TIERS_KEY = 'tiers.json';

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export function setMeta(db: D1Database, key: string, value: string) {
  return db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
}

export async function playerCounts(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db
    .prepare('SELECT prompt_id, COUNT(*) AS n FROM prompt_players GROUP BY prompt_id')
    .all<{ prompt_id: string; n: number }>();
  return new Map((results ?? []).map((r) => [r.prompt_id, r.n]));
}

async function answerCounts(db: D1Database, promptIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!promptIds.length) return out;
  const { results } = await db
    .prepare(
      `SELECT prompt_id, answer, COUNT(*) AS n FROM player_answers
       WHERE prompt_id IN (SELECT value FROM json_each(?)) GROUP BY prompt_id, answer`,
    )
    .bind(JSON.stringify(promptIds))
    .all<{ prompt_id: string; answer: string; n: number }>();
  for (const r of results ?? []) {
    let m = out.get(r.prompt_id);
    if (!m) out.set(r.prompt_id, (m = new Map()));
    m.set(r.answer, r.n);
  }
  return out;
}

export interface NightlyResult {
  ran: boolean;
  date: string;
  autoAdded?: { promptId: string; answer: string; players: number }[];
  promptsUsingPlayerData?: number;
}

/**
 * Runs once per Melbourne date (cron fires hourly). `force` publishes regardless.
 */
export async function runNightly(env: Env, opts: { force?: boolean; now?: Date } = {}): Promise<NightlyResult> {
  const db = env.DB;
  const today = dateString(opts.now ?? new Date());
  if (!opts.force && (await getMeta(db, 'last_run_date')) === today) return { ran: false, date: today };

  const N = await playerCounts(db);
  const eligible = PROMPTS.filter((p) => (N.get(p.id) ?? 0) >= MIN_PLAYERS).map((p) => p.id);
  const counts = await answerCounts(db, eligible);
  const overrides = overridesByPrompt(await loadOverrides(db));
  const nowIso = new Date().toISOString();

  // 1. Auto-add unlisted answers given by enough distinct players (eligible prompts only).
  const autoAdded: NightlyResult['autoAdded'] = [];
  const inserts: D1PreparedStatement[] = [];
  for (const id of eligible) {
    const def = PROMPTS.find((p) => p.id === id)!;
    const live = liveStartingTiers(def, overrides.get(id));
    const index = buildIndex(Object.keys(live));
    for (const [answer, n] of counts.get(id) ?? []) {
      if (n < AUTO_ADD_MIN_PLAYERS || answer in live) continue;
      if (overrides.get(id)?.has(answer)) continue; // already decided by an admin
      if (matchAnswer(answer, index)) continue; // a variant of a live answer
      if (isBlocked(answer)) continue; // stays in the review queue
      inserts.push(
        db.prepare(
          `INSERT OR IGNORE INTO answer_overrides (prompt_id, answer, status, starting_tier, source, updated_at)
           VALUES (?, ?, 'approved', ?, 'auto', ?)`,
        ).bind(id, answer, NEW_ANSWER_STARTING_TIER, nowIso),
      );
      let m = overrides.get(id);
      if (!m) overrides.set(id, (m = new Map()));
      m.set(answer, { prompt_id: id, answer, status: 'approved', starting_tier: NEW_ANSWER_STARTING_TIER, source: 'auto', updated_at: nowIso });
      autoAdded.push({ promptId: id, answer, players: n });
    }
  }
  if (inserts.length) await db.batch(inserts);

  // 2. Tiers for every prompt.
  const file = await buildTiersFile(env, today, N, counts, overrides);
  await env.TIERS.put(TIERS_KEY, JSON.stringify(file));

  // 3. Bookkeeping.
  await db.batch([
    setMeta(db, 'last_run_date', today),
    setMeta(db, 'last_run_at', nowIso),
    setMeta(db, 'tiers_version', String(file.version)),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Date.now() - 86_400_000),
  ]);

  const promptsUsingPlayerData = Object.values(file.prompts).filter((p) => p.usingPlayerData).length;
  return { ran: true, date: today, autoAdded, promptsUsingPlayerData };
}

async function buildTiersFile(
  env: Env,
  today: string,
  N: Map<string, number>,
  counts: Map<string, Map<string, number>>,
  overrides: ReturnType<typeof overridesByPrompt>,
): Promise<TiersFile> {
  const version = Number((await getMeta(env.DB, 'tiers_version')) ?? 0) + 1;
  const prompts: TiersFile['prompts'] = {};
  for (const def of PROMPTS) {
    const players = N.get(def.id) ?? 0;
    const usingPlayerData = players >= MIN_PLAYERS;
    const live = liveStartingTiers(def, overrides.get(def.id));
    const tiers: Record<string, number> = {};
    for (const [answer, start] of Object.entries(live)) {
      tiers[answer] = usingPlayerData ? computeTier(start, counts.get(def.id)?.get(answer) ?? 0, players) : start;
    }
    prompts[def.id] = { usingPlayerData, players, tiers };
  }
  return { version, date: today, generatedAt: new Date().toISOString(), minPlayers: MIN_PLAYERS, prompts };
}
