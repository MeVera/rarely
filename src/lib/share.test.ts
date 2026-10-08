import { describe, expect, it } from 'vitest';
import { newGame, submitEntry } from './game';
import { shareText } from './share';

describe('shareText', () => {
  it('summarises without revealing answers', () => {
    const g = newGame('2026-10-08', null);
    const round = g.rounds[0];
    const [first] = Object.keys(g.tiers[round.promptId].tiers);
    submitEntry(g, first);
    const text = shareText(g, 'https://example.com');
    const lines = text.split('\n');
    expect(lines[0]).toContain('8 Oct 2026');
    expect(lines).toHaveLength(2 + 4 + 1);
    expect(text).not.toContain(first);
    expect([...lines[2]].length).toBe(5);
  });
});
