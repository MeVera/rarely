import { describe, expect, it } from 'vitest';
import prompts from '../data/prompts.json';
import { addDays, dateString, msUntilReset, nextResetAt, promptIdsForDate, seededShuffle } from './daily';

const ids = (prompts as { id: string }[]).map((p) => p.id);
const H = 3600_000;

describe('promptIdsForDate', () => {
  it('gives the same 20 prompts for the same date', () => {
    const a = promptIdsForDate('2026-10-08', ids);
    const b = promptIdsForDate('2026-10-08', [...ids].reverse());
    expect(a).toEqual(b);
    expect(a).toHaveLength(20);
    expect(new Set(a).size).toBe(20);
    a.forEach((id) => expect(ids).toContain(id));
  });

  it('does not repeat prompts within a cycle of the deck', () => {
    const perCycle = Math.floor(ids.length / 20);
    // Find a cycle start: SCHEDULE_EPOCH is day 0, so 2026-01-01 starts cycle 0.
    const seen = new Set<string>();
    for (let d = 0; d < perCycle; d++) {
      for (const id of promptIdsForDate(addDays('2026-01-01', d), ids)) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(perCycle * 20);
  });

  it('reshuffles for the next cycle', () => {
    const perCycle = Math.floor(ids.length / 20);
    const first = promptIdsForDate('2026-01-01', ids);
    const nextCycle = promptIdsForDate(addDays('2026-01-01', perCycle), ids);
    expect(nextCycle).not.toEqual(first);
  });

  it('handles dates before the schedule epoch', () => {
    expect(promptIdsForDate('2025-12-31', ids)).toHaveLength(20);
  });

  it('seeded shuffle is deterministic and a permutation', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const s1 = seededShuffle(items, 'x');
    expect(seededShuffle(items, 'x')).toEqual(s1);
    expect(seededShuffle(items, 'y')).not.toEqual(s1);
    expect([...s1].sort((a, b) => a - b)).toEqual(items);
  });
});

describe('Melbourne dates', () => {
  it('flips at Melbourne midnight in standard time (UTC+10)', () => {
    // 2026-07-15 00:00 AEST = 2026-07-14T14:00Z
    expect(dateString(Date.parse('2026-07-14T13:59:59.999Z'))).toBe('2026-07-14');
    expect(dateString(Date.parse('2026-07-14T14:00:00.000Z'))).toBe('2026-07-15');
  });

  it('flips at Melbourne midnight in daylight time (UTC+11)', () => {
    // 2026-12-25 00:00 AEDT = 2026-12-24T13:00Z
    expect(dateString(Date.parse('2026-12-24T12:59:59.999Z'))).toBe('2026-12-24');
    expect(dateString(Date.parse('2026-12-24T13:00:00.000Z'))).toBe('2026-12-25');
  });

  it('handles the October daylight saving start (23-hour day)', () => {
    // DST starts 2026-10-04 02:00 AEST -> 03:00 AEDT.
    const oct4Midnight = Date.parse('2026-10-03T14:00:00Z'); // 00:00 AEST
    const oct5Midnight = Date.parse('2026-10-04T13:00:00Z'); // 00:00 AEDT
    expect(dateString(oct4Midnight - 1)).toBe('2026-10-03');
    expect(dateString(oct4Midnight)).toBe('2026-10-04');
    expect(dateString(oct5Midnight - 1)).toBe('2026-10-04');
    expect(dateString(oct5Midnight)).toBe('2026-10-05');
    expect(nextResetAt(oct4Midnight)).toBe(oct5Midnight);
    expect(msUntilReset(oct4Midnight)).toBe(23 * H);
  });

  it('handles the April daylight saving end (25-hour day)', () => {
    // DST ends 2026-04-05 03:00 AEDT -> 02:00 AEST.
    const apr5Midnight = Date.parse('2026-04-04T13:00:00Z'); // 00:00 AEDT
    const apr6Midnight = Date.parse('2026-04-05T14:00:00Z'); // 00:00 AEST
    expect(dateString(apr5Midnight)).toBe('2026-04-05');
    expect(dateString(apr6Midnight - 1)).toBe('2026-04-05');
    expect(dateString(apr6Midnight)).toBe('2026-04-06');
    expect(msUntilReset(apr5Midnight)).toBe(25 * H);
  });

  it('countdown from mid-afternoon', () => {
    const t = Date.parse('2026-10-08T04:30:00Z'); // 15:30 AEDT
    expect(msUntilReset(t)).toBe(8.5 * H);
  });
});
