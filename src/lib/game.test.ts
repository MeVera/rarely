import { describe, expect, it } from 'vitest';
import { newGame, rarestMissed, submitEntry } from './game';

describe('game round scoring', () => {
  const fresh = () => {
    const g = newGame('2026-10-08', null);
    return { g, promptId: g.rounds[0].promptId, tiers: g.tiers[g.rounds[0].promptId].tiers };
  };

  it('uses starting tiers when tiers.json is unavailable', () => {
    const { g } = fresh();
    expect(g.tiersSource).toBe('starting');
    expect(g.rounds).toHaveLength(20);
  });

  it('allows exactly one answer per round', () => {
    const { g, tiers } = fresh();
    const [answer] = Object.keys(tiers);
    expect(submitEntry(g, '   ').kind).toBe('empty');
    expect(submitEntry(g, answer).kind).toBe('accepted');
    expect(submitEntry(g, Object.keys(tiers)[1]).kind).toBe('full');
    expect(g.rounds[0].entries).toHaveLength(1);
    expect(g.rounds[0].score).toBeGreaterThan(0);
  });

  it('an unlisted answer uses up the round and scores zero', () => {
    const { g, tiers } = fresh();
    expect(submitEntry(g, 'zzqx not a thing').kind).toBe('rejected');
    expect(submitEntry(g, Object.keys(tiers)[0]).kind).toBe('full');
    expect(g.rounds[0].score).toBe(0);
  });

  it('uses frozen live tiers when provided', () => {
    const base = newGame('2026-10-08', null);
    const pid = base.rounds[0].promptId;
    const g = newGame('2026-10-08', {
      version: 1, date: '2026-10-08', generatedAt: '', minPlayers: 100,
      prompts: { [pid]: { usingPlayerData: true, players: 500, tiers: { 'brand new answer': 5 } } },
    });
    expect(submitEntry(g, 'brand new answer').kind).toBe('accepted');
    expect(g.rounds[0].score).toBe(100);
  });

  it('lists rarest missed answers, rarest first', () => {
    const { g } = fresh();
    const missed = rarestMissed(g, g.rounds[0]);
    expect(missed.length).toBeGreaterThan(0);
    expect(missed[0].tier).toBe(5);
  });
});
