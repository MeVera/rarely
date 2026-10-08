import { describe, expect, it } from 'vitest';
import { computeStats } from './stats';

const rec = (date: string, score = 100) => ({ date, score, rounds: [] });

describe('computeStats', () => {
  it('is empty with no history', () => {
    expect(computeStats([], '2026-10-08')).toEqual({ daysPlayed: 0, best: 0, streak: 0 });
  });
  it('counts a streak ending today', () => {
    const h = [rec('2026-10-06'), rec('2026-10-07', 500), rec('2026-10-08')];
    expect(computeStats(h, '2026-10-08')).toEqual({ daysPlayed: 3, best: 500, streak: 3 });
  });
  it('keeps yesterday\'s streak alive before today is played', () => {
    expect(computeStats([rec('2026-10-06'), rec('2026-10-07')], '2026-10-08').streak).toBe(2);
  });
  it('breaks on a gap', () => {
    expect(computeStats([rec('2026-10-05'), rec('2026-10-07')], '2026-10-08').streak).toBe(1);
    expect(computeStats([rec('2026-10-05')], '2026-10-08').streak).toBe(0);
  });
  it('crosses month boundaries', () => {
    expect(computeStats([rec('2026-09-30'), rec('2026-10-01')], '2026-10-01').streak).toBe(2);
  });
});
