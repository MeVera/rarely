import { describe, expect, it } from 'vitest';
import { buildExtrasIndex, matchExtra, RULES, stems } from './extras';

describe('rules', () => {
  it('check letters', () => {
    expect(RULES['qu-words']('queen')).toBe(true);
    expect(RULES['ight-words']('knight')).toBe(true);
    expect(RULES.palindromes('racecar')).toBe(true);
    expect(RULES.palindromes('racecars')).toBe(false);
    expect(RULES['rhymes-cat']('combat')).toBe(true);
    expect(RULES['rhymes-cat']('boat')).toBe(false);
    expect(RULES['rhymes-cat']('what')).toBe(false);
  });
});

describe('stems', () => {
  it('finds dictionary stems of inflected words', () => {
    expect(stems('shouted')).toContain('shout');
    expect(stems('sharing')).toContain('share');
    expect(stems('shopping')).toContain('shop');
    expect(stems('shinier')).toContain('shiny');
  });
});

describe('matchExtra', () => {
  const rule = buildExtrasIndex({ kind: 'rule', rule: 'sh-words', words: ['shout', 'shimmy'] });
  const cat = buildExtrasIndex({ kind: 'category', words: ['jaffa orange', 'loquat'] });
  it('rule prompts: word must obey the rule and have a real stem', () => {
    expect(matchExtra('Shouting', rule)).toBe('shouting');
    expect(matchExtra('shimmies', rule)).toBe('shimmies');
    expect(matchExtra('outshout', rule)).toBeNull();
    expect(matchExtra('shqqq', rule)).toBeNull();
  });
  it('category prompts: exact or plural only, no typos', () => {
    expect(matchExtra('Jaffa Oranges', cat)).toBe('jaffa orange');
    expect(matchExtra('jaffa ornge', cat)).toBeNull();
  });
  it('blocks profanity even if listed', () => {
    const bad = buildExtrasIndex({ kind: 'rule', rule: 'sh-words', words: ['shit'] });
    expect(matchExtra('shit', bad)).toBeNull();
  });
});
