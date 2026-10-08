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

describe('answers outside the bank (WordNet extras)', () => {
  it('accepts a verified category word as Rare and still rejects nonsense', async () => {
    const { loadExtras, newGame: make, submitEntry: submit } = await import('./game');
    const g = make('2026-10-08', null);
    // Force a known category prompt into round 1.
    g.rounds[0].promptId = 'fruit';
    g.tiers.fruit = { usingPlayerData: false, players: 0, tiers: {} };
    await loadExtras(['fruit']);
    const r = submit(g, 'Chinese gooseberry');
    expect(r.kind).toBe('accepted');
    expect(r.kind === 'accepted' && r.entry.verified && r.entry.points).toBe(85);
  });

  it('rule prompts accept real words that obey the rule, including inflections', async () => {
    const { loadExtras, newGame: make, submitEntry: submit } = await import('./game');
    for (const [promptId, word, ok] of [
      ['sh-words', 'shoeblack', true],
      ['sh-words', 'shuttering', true],
      ['sh-words', 'shzzqx', false],
      ['qu-words', 'blah', false],
      ['tion-words', 'urbanization', true],
    ] as const) {
      const g = make('2026-10-08', null);
      g.rounds[0].promptId = promptId;
      g.tiers[promptId] = { usingPlayerData: false, players: 0, tiers: {} };
      await loadExtras([promptId]);
      expect(submit(g, word).kind, `${promptId}: ${word}`).toBe(ok ? 'accepted' : 'rejected');
    }
  });
});
