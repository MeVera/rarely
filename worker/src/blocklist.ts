// Small profanity blocklist for auto-adding answers. Anything blocked still reaches
// the admin review queue, so this only needs to stop the obvious cases.
// Extend freely; entries are compared against normalized words and whole answers.
import { normalize } from '../../src/lib/match';

const BLOCKED_WORDS = new Set([
  'fuck', 'fucking', 'fucker', 'fucked', 'shit', 'shitty', 'bullshit', 'cunt', 'bitch', 'bastard',
  'dick', 'dickhead', 'cock', 'prick', 'piss', 'pissed', 'wank', 'wanker', 'twat', 'slut', 'whore',
  'arse', 'arsehole', 'ass', 'asshole', 'bollocks', 'bugger', 'tits', 'boobs', 'penis', 'vagina',
  'porn', 'porno', 'sex', 'sexy', 'nazi', 'hitler', 'rape', 'rapist', 'cum', 'jizz', 'dildo',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'spastic', 'tranny', 'kike', 'chink',
  'spic', 'coon', 'gook', 'wog', 'paki', 'dyke', 'poof', 'poofter', 'skank', 'hoe',
]);

// Catch spacing/obfuscation tricks inside a compact (space-less) form.
const BLOCKED_SUBSTRINGS = ['fuck', 'shit', 'nigg', 'fagg', 'wank', 'twat', 'whore'];

export function isBlocked(text: string): boolean {
  const norm = normalize(text)
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/\$/g, 's');
  if (norm.split(' ').some((w) => BLOCKED_WORDS.has(w))) return true;
  const compact = norm.replace(/ /g, '');
  return BLOCKED_WORDS.has(compact) || BLOCKED_SUBSTRINGS.some((s) => compact.includes(s));
}
