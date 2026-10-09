// Game state for one day, plus helpers to create, score and persist it.
import prompts from '../data/prompts.json';
import { MAX_ANSWER_LENGTH, MAX_ANSWERS_PER_ROUND, MAX_ATTEMPTS_PER_ROUND, ROUND_SECONDS } from '../config';
import { liveIndex, startingTiers, type PromptDef, type PromptTiers, type TiersFile } from './bank';
import { addDays, hashString, promptIdsForDate } from './daily';
import { buildExtrasIndex, matchExtra, type ExtrasFile, type ExtrasIndex } from './extras';
import { matchAnswer, toKey, type AnswerIndex } from './match';
import { EXTRA_TIER, pointsForTier } from './scoring';
import * as store from './storage';

export const PROMPTS = prompts as unknown as PromptDef[];
export const PROMPTS_BY_ID = new Map(PROMPTS.map((p) => [p.id, p]));

export interface Entry {
  text: string;
  /** Canonical answer, or null when not in the list. */
  answer: string | null;
  tier: number | null;
  points: number;
  flagged?: boolean;
  /** Accepted via the WordNet extras rather than the hand-built bank. */
  verified?: boolean;
}

export interface RoundState {
  promptId: string;
  entries: Entry[];
  score: number;
  timeLeftMs: number;
  finished: boolean;
}

export type Phase = 'ready' | 'playing' | 'review' | 'done';

export interface GameState {
  date: string;
  phase: Phase;
  roundIndex: number;
  rounds: RoundState[];
  /** Tiers frozen at the start of the day, so scores never change mid-game. */
  tiers: Record<string, PromptTiers>;
  tiersSource: 'live' | 'starting';
  tiersVersion: string | null;
  submitted: boolean;
}

export type EntryResult =
  | { kind: 'accepted'; entry: Entry }
  | { kind: 'rejected'; entry: Entry }
  | { kind: 'duplicate'; answer: string | null }
  | { kind: 'empty' }
  | { kind: 'full' };

const gameKey = (date: string) => `game:${date}`;

export function loadGame(date: string): GameState | null {
  const g = store.load<GameState | null>(gameKey(date), null);
  return g && g.date === date && Array.isArray(g.rounds) ? g : null;
}

export function saveGame(g: GameState): void {
  store.save(gameKey(g.date), g);
}

/** Drop saved games older than a week. */
export function pruneOldGames(today: string): void {
  const cutoff = addDays(today, -7);
  for (const k of store.keys()) {
    const m = /^game:(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (m && m[1] < cutoff) store.remove(k);
  }
}

function startingPromptTiers(def: PromptDef): PromptTiers {
  return { usingPlayerData: false, players: 0, tiers: startingTiers(def) };
}

/** Create today's game, freezing tiers from tiers.json (or starting tiers if unavailable). */
export function newGame(date: string, file: TiersFile | null): GameState {
  const ids = promptIdsForDate(date, PROMPTS.map((p) => p.id));
  const tiers: Record<string, PromptTiers> = {};
  for (const id of ids) {
    const def = PROMPTS_BY_ID.get(id)!;
    const live = file?.prompts?.[id];
    tiers[id] = live && live.tiers && Object.keys(live.tiers).length ? live : startingPromptTiers(def);
  }
  return {
    date,
    phase: 'ready',
    roundIndex: 0,
    rounds: ids.map((promptId) => ({ promptId, entries: [], score: 0, timeLeftMs: ROUND_SECONDS * 1000, finished: false })),
    tiers,
    tiersSource: file ? 'live' : 'starting',
    tiersVersion: file ? `${file.date}#${file.version}` : null,
    submitted: false,
  };
}

// Extra valid answers per prompt (static JSON, split into lazy chunks by Vite).
const extrasModules = import.meta.glob<ExtrasFile>('../data/extras/*.json', { import: 'default' });
const extrasCache = new Map<string, ExtrasIndex>();

/** Load the WordNet extras for these prompts. Never throws: without them the bank still works. */
export async function loadExtras(promptIds: string[]): Promise<void> {
  await Promise.all(
    promptIds.map(async (id) => {
      const load = extrasModules[`../data/extras/${id}.json`];
      if (!load || extrasCache.has(id)) return;
      try {
        extrasCache.set(id, buildExtrasIndex(await load()));
      } catch {
        /* offline or chunk missing */
      }
    }),
  );
}

const indexCache = new Map<string, AnswerIndex>();

export function indexFor(g: GameState, promptId: string): AnswerIndex {
  const cacheKey = `${g.date}:${g.tiersVersion}:${promptId}`;
  let idx = indexCache.get(cacheKey);
  if (!idx) {
    idx = liveIndex(PROMPTS_BY_ID.get(promptId)!, g.tiers[promptId]?.tiers);
    indexCache.set(cacheKey, idx);
  }
  return idx;
}

export function tierOf(g: GameState, promptId: string, answer: string): number {
  return g.tiers[promptId]?.tiers[answer] ?? 5;
}

/** Score one typed answer into the current round. */
export function submitEntry(g: GameState, raw: string): EntryResult {
  const round = g.rounds[g.roundIndex];
  const text = raw.trim().slice(0, MAX_ANSWER_LENGTH);
  if (!toKey(text)) return { kind: 'empty' };
  // Wrong guesses are kept (they're shown in the review) but only correct answers use up the round.
  if (round.entries.filter((e) => e.answer).length >= MAX_ANSWERS_PER_ROUND) return { kind: 'full' };
  if (round.entries.length >= MAX_ATTEMPTS_PER_ROUND) return { kind: 'full' };

  const match = matchAnswer(text, indexFor(g, round.promptId));
  if (match) {
    if (round.entries.some((e) => e.answer === match.answer)) return { kind: 'duplicate', answer: match.answer };
    const tier = tierOf(g, round.promptId, match.answer);
    const entry: Entry = { text, answer: match.answer, tier, points: pointsForTier(tier) };
    round.entries.push(entry);
    round.score += entry.points;
    return { kind: 'accepted', entry };
  }
  const key = toKey(text);
  if (round.entries.some((e) => !e.answer && toKey(e.text) === key)) return { kind: 'duplicate', answer: null };
  const extra = matchExtra(text, extrasCache.get(round.promptId));
  if (extra) {
    if (round.entries.some((e) => e.answer === extra)) return { kind: 'duplicate', answer: extra };
    const accepted: Entry = { text, answer: extra, tier: EXTRA_TIER, points: pointsForTier(EXTRA_TIER), verified: true };
    round.entries.push(accepted);
    round.score += accepted.points;
    return { kind: 'accepted', entry: accepted };
  }
  const entry: Entry = { text, answer: null, tier: null, points: 0 };
  round.entries.push(entry);
  return { kind: 'rejected', entry };
}

/** Rarest accepted answers the player didn't find this round. */
export function rarestMissed(g: GameState, round: RoundState, limit = 6): { answer: string; tier: number }[] {
  const found = new Set(round.entries.map((e) => e.answer));
  return Object.entries(g.tiers[round.promptId]?.tiers ?? {})
    .filter(([a]) => !found.has(a))
    .map(([answer, tier]) => ({ answer, tier }))
    // Ties broken by a per-day hash so the list isn't always alphabetical.
    .sort((a, b) => b.tier - a.tier || hashString(g.date + a.answer) - hashString(g.date + b.answer))
    .slice(0, limit);
}

export function totalScore(g: GameState): number {
  return g.rounds.reduce((n, r) => n + r.score, 0);
}
