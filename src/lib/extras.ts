// Accepting answers that aren't in the hand-built bank, without a server.
//
// At build time (scripts/build-extras.ts) WordNet supplies, per prompt, a static list
// of extra valid answers:
//   - "category" prompts: every word WordNet files under that category
//     (e.g. all hyponyms of "edible fruit");
//   - "rule" prompts: every dictionary word that obeys the prompt's letter rule.
// The lists ship as static JSON next to the game and are loaded per day.
import { buildIndex, matchAnswer, toKey, type AnswerIndex } from './match';
import { isBlocked } from './blocklist';

export interface ExtrasFile {
  kind: 'category' | 'rule';
  /** For rule prompts: which rule the typed word itself must obey. */
  rule?: RuleId;
  words: string[];
}

/** Letter rules, keyed by prompt id. Applied to the compact key (lowercase, no spaces). */
export const RULES = {
  'qu-words': (k: string) => k.startsWith('qu'),
  'ight-words': (k: string) => k.endsWith('ight'),
  'double-o': (k: string) => k.includes('oo'),
  'tion-words': (k: string) => k.endsWith('tion'),
  'sh-words': (k: string) => k.startsWith('sh'),
  'ology-words': (k: string) => k.endsWith('ology'),
  'ism-words': (k: string) => k.endsWith('ism'),
  'ph-words': (k: string) => k.startsWith('ph'),
  'x-words': (k: string) => k.endsWith('x'),
  palindromes: (k: string) => k.length > 2 && k === [...k].reverse().join(''),
  'rhymes-cat': (k: string) => /(^|[^aeiou])att?$/.test(k) && !/(what|somewhat)$/.test(k),
} satisfies Record<string, (k: string) => boolean>;

export type RuleId = keyof typeof RULES;

export function isRulePrompt(id: string): id is RuleId {
  return id in RULES;
}

/** Plausible dictionary stems for an inflected word ("shouted" -> "shout"). */
export function stems(key: string): string[] {
  const out = new Set<string>([key]);
  const add = (s: string) => s.length >= 2 && out.add(s);
  for (const suf of ['ing', 'ed', 'er', 'est', 'ly', 's', 'es', 'd']) {
    if (!key.endsWith(suf) || key.length - suf.length < 2) continue;
    const base = key.slice(0, -suf.length);
    add(base);
    add(base + 'e'); // sharing -> share
    if (base.length > 2 && base.at(-1) === base.at(-2)) add(base.slice(0, -1)); // shopping -> shop
    if (base.endsWith('i')) add(base.slice(0, -1) + 'y'); // happily -> happy
  }
  return [...out];
}

export interface ExtrasIndex {
  file: ExtrasFile;
  index: AnswerIndex;
  keys: Set<string>;
}

export function buildExtrasIndex(file: ExtrasFile): ExtrasIndex {
  return { file, index: buildIndex(file.words), keys: new Set(file.words.map(toKey)) };
}

/**
 * Check an answer that didn't match the hand-built bank. Returns the accepted
 * answer text, or null. No fuzzy matching here: typos only count on bank answers.
 */
export function matchExtra(input: string, extras: ExtrasIndex | undefined): string | null {
  if (!extras || isBlocked(input)) return null;
  const key = toKey(input);
  if (key.length < 3) return null;

  if (extras.file.kind === 'rule' && extras.file.rule) {
    if (!RULES[extras.file.rule](key)) return null;
    // The typed word must obey the rule; its stem only has to be a real word.
    if (stems(key).some((s) => extras.keys.has(s))) return input.trim().toLowerCase();
  }

  const m = matchAnswer(input, extras.index);
  return m && m.how !== 'fuzzy' ? m.answer : null;
}
