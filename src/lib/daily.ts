// Day boundaries and the deterministic daily prompt schedule.
import { ROUNDS_PER_DAY, SCHEDULE_EPOCH, TIMEZONE } from '../config';

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD for `when` in `timeZone` (default: the game's TIMEZONE). DST-safe. */
export function dateString(when: Date | number = Date.now(), timeZone = TIMEZONE): string {
  let fmt = dateFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(when);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Epoch ms of the next day rollover after `now` (binary search, so DST days of 23/25h work). */
export function nextResetAt(now: number = Date.now(), timeZone = TIMEZONE): number {
  const today = dateString(now, timeZone);
  let lo = now;
  let hi = now + 26 * 3600_000; // always past the next rollover
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dateString(mid, timeZone) === today) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function msUntilReset(now: number = Date.now(), timeZone = TIMEZONE): number {
  return nextResetAt(now, timeZone) - now;
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function isDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

// --- seeded shuffle --------------------------------------------------------

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const rand = mulberry32(hashString(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The day's prompt ids. The full library (sorted by id) is shuffled with a seed per
 * "cycle"; each day takes the next ROUNDS_PER_DAY prompts from the shuffled deck, and
 * once the deck is used up a new cycle reshuffles with a new seed.
 */
export function promptIdsForDate(date: string, allIds: readonly string[], perDay = ROUNDS_PER_DAY): string[] {
  const ids = [...new Set(allIds)].sort();
  if (ids.length < perDay) throw new Error(`Need at least ${perDay} prompts, have ${ids.length}`);
  const daysPerCycle = Math.floor(ids.length / perDay);
  const dayIndex = daysBetween(SCHEDULE_EPOCH, date);
  const cycle = Math.floor(dayIndex / daysPerCycle);
  const slot = dayIndex - cycle * daysPerCycle; // works for negative dayIndex too
  const deck = seededShuffle(ids, `rarely-cycle-${cycle}`);
  return deck.slice(slot * perDay, slot * perDay + perDay);
}
