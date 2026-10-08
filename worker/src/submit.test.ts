import { describe, expect, it } from 'vitest';
import { isBlocked } from '../../src/lib/blocklist';
import { validateBody } from './submit';

const ok = {
  playerId: '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b',
  date: '2026-10-08',
  rounds: [{ promptId: 'fruit', answers: ['Banana'] }],
};

describe('validateBody', () => {
  it('accepts a valid body', () => {
    expect(validateBody(ok, '2026-10-08').rounds[0].answers).toEqual(['Banana']);
  });
  it('accepts a late queued submission within a week', () => {
    expect(() => validateBody({ ...ok, date: '2026-10-02' }, '2026-10-08')).not.toThrow();
  });
  it.each([
    ['bad uuid', { ...ok, playerId: 'nope' }],
    ['future date', { ...ok, date: '2026-10-09' }],
    ['stale date', { ...ok, date: '2026-09-01' }],
    ['unknown prompt', { ...ok, rounds: [{ promptId: 'nope', answers: [] }] }],
    ['duplicate prompt', { ...ok, rounds: [ok.rounds[0], ok.rounds[0]] }],
    ['more than one answer', { ...ok, rounds: [{ promptId: 'fruit', answers: ['apple', 'pear'] }] }],
    ['non-string answer', { ...ok, rounds: [{ promptId: 'fruit', answers: [42] }] }],
    ['no rounds', { ...ok, rounds: [] }],
  ])('rejects %s', (_name, body) => {
    expect(() => validateBody(body, '2026-10-08')).toThrow();
  });
});

describe('blocklist', () => {
  it('blocks obvious profanity and obfuscation', () => {
    expect(isBlocked('shit')).toBe(true);
    expect(isBlocked('F U C K')).toBe(true);
    expect(isBlocked('sh1t')).toBe(true);
  });
  it('allows ordinary answers', () => {
    expect(isBlocked('cockatoo')).toBe(false);
    expect(isBlocked('scunthorpe')).toBe(false);
    expect(isBlocked('passionfruit')).toBe(false);
  });
});
