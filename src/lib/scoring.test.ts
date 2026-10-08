import { describe, expect, it } from 'vitest';
import { computeTier, MIN_PLAYERS, pointsForTier, tierFromShare } from './scoring';

describe('computeTier', () => {
  it('uses the starting tier for every answer when N = 99, whatever n is', () => {
    for (let start = 1; start <= 5; start++) {
      for (const n of [0, 1, 5, 50, 99]) {
        expect(computeTier(start, n, 99)).toBe(start);
      }
    }
  });

  it('switches to the formula at N = 100', () => {
    expect(MIN_PLAYERS).toBe(100);
    // A starting-tier-5 answer that 90% of players give becomes tier 1.
    expect(computeTier(5, 90, 100)).toBe(1);
    // A starting-tier-1 answer nobody gives becomes rare.
    expect(computeTier(1, 0, 100)).toBeGreaterThan(1);
  });

  it('N=1000, n=3, starting tier 4 -> tier 5', () => {
    expect(computeTier(4, 3, 1000)).toBe(5);
  });

  it('N=1000, n=40, starting tier 3 -> tier 3', () => {
    expect(computeTier(3, 40, 1000)).toBe(3);
  });

  it('N=1000, n=620 -> tier 1 for any starting tier', () => {
    for (let start = 1; start <= 5; start++) expect(computeTier(start, 620, 1000)).toBe(1);
  });

  it('a prompt with N=0 returns starting tiers', () => {
    for (let start = 1; start <= 5; start++) expect(computeTier(start, 0, 0)).toBe(start);
  });
});

describe('tier thresholds', () => {
  it('maps shares to the documented bands', () => {
    expect(tierFromShare(0.5)).toBe(1);
    expect(tierFromShare(0.15)).toBe(2);
    expect(tierFromShare(0.05)).toBe(3);
    expect(tierFromShare(0.01)).toBe(4);
    expect(tierFromShare(0.005)).toBe(5);
  });

  it('points per tier', () => {
    expect([1, 2, 3, 4, 5].map(pointsForTier)).toEqual([10, 30, 60, 85, 100]);
  });
});
