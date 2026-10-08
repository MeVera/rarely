import { describe, expect, it } from 'vitest';
import { buildIndex, levenshtein, matchAnswer, normalize, toKey } from './match';

const index = buildIndex([
  'apple', 'banana', 'blueberry', 'peach', 'cherry', 'ice cream', 'jalapeno',
  'knife', 'leaf', 'mouse', 'color wheel', 'yogurt', 'eggplant|aubergine',
  'tomato', 'potato', 'pineapple',
]);
const m = (s: string) => matchAnswer(s, index)?.answer ?? null;

describe('normalize', () => {
  it('lowercases, trims, collapses whitespace, strips accents and punctuation', () => {
    expect(normalize('  Jalapeño!!  ')).toBe('jalapeno');
    expect(normalize("Rock 'n' Roll")).toBe('rock n roll');
    expect(normalize('T-Shirt')).toBe('t shirt');
    expect(normalize('Fish   &  Chips')).toBe('fish and chips');
  });
  it('ignores spacing differences in keys', () => {
    expect(toKey('Ice-Cream')).toBe(toKey('icecream'));
  });
});

describe('matchAnswer', () => {
  it('matches exact and case/accents/punctuation variants', () => {
    expect(m('Apple')).toBe('apple');
    expect(m('JALAPEÑO')).toBe('jalapeno');
    expect(m('ice-cream')).toBe('ice cream');
  });
  it('handles plural and singular', () => {
    expect(m('apples')).toBe('apple');
    expect(m('cherries')).toBe('cherry');
    expect(m('peaches')).toBe('peach');
    expect(m('knives')).toBe('knife');
    expect(m('leaves')).toBe('leaf');
    expect(m('mice')).toBe('mouse');
    expect(m('tomatoes')).toBe('tomato');
  });
  it('maps British spellings', () => {
    expect(m('colour wheel')).toBe('color wheel');
    expect(m('yoghurt')).toBe('yogurt');
  });
  it('supports aliases', () => {
    expect(m('aubergine')).toBe('eggplant');
    expect(m('aubergines')).toBe('eggplant');
  });
  it('allows one typo on words of 6+ letters', () => {
    expect(m('bananna')).toBe('banana');
    expect(m('bluebery')).toBe('blueberry');
    expect(m('pineaple')).toBe('pineapple');
  });
  it('does not fuzzy-match short words', () => {
    expect(m('appel')).toBeNull();
    expect(m('peech')).toBeNull();
  });
  it('rejects fuzzy matches that are ambiguous', () => {
    const idx = buildIndex(['parrot', 'carrot']);
    expect(matchAnswer('marrot', idx)).toBeNull();
    expect(matchAnswer('parrott', idx)?.answer).toBe('parrot');
  });
  it('rejects unlisted text', () => {
    expect(m('car')).toBeNull();
    expect(m('')).toBeNull();
    expect(m('!!!')).toBeNull();
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('abc', 'abd', 1)).toBe(1);
    expect(levenshtein('abcdef', 'zzzzzz', 1)).toBe(2);
  });
});
