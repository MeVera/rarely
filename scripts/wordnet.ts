// Minimal reader for the WordNet 3.1 database files in the `wordnet-db` package.
// Build-time only; nothing here ships to the browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error: package has no types
import wndb from 'wordnet-db';

export type Pos = 'noun' | 'verb' | 'adj' | 'adv';

export interface Synset {
  offset: string;
  pos: Pos;
  lemmas: string[];
  hyponyms: string[];
  instances: string[];
  /** Part meronyms ("a car has a bumper"). */
  parts: string[];
  gloss: string;
}

const dir: string = wndb.path;
const cache = new Map<Pos, Map<string, Synset>>();

export function synsets(pos: Pos): Map<string, Synset> {
  let map = cache.get(pos);
  if (map) return map;
  map = new Map();
  for (const line of readFileSync(join(dir, `data.${pos}`), 'utf8').split('\n')) {
    if (!line || line.startsWith('  ')) continue; // license header
    const [head, gloss = ''] = line.split(' | ');
    const t = head.split(' ');
    const offset = t[0];
    const wCnt = parseInt(t[3], 16);
    const lemmas: string[] = [];
    for (let i = 0; i < wCnt; i++) lemmas.push(t[4 + i * 2].replace(/\(.*\)$/, '').replace(/_/g, ' '));
    let i = 4 + wCnt * 2;
    const pCnt = parseInt(t[i], 10);
    i++;
    const hyponyms: string[] = [];
    const instances: string[] = [];
    const parts: string[] = [];
    for (let p = 0; p < pCnt; p++, i += 4) {
      if (t[i] === '~') hyponyms.push(t[i + 1]);
      else if (t[i] === '~i') instances.push(t[i + 1]);
      else if (t[i] === '%p') parts.push(t[i + 1]);
    }
    map.set(offset, { offset, pos, lemmas, hyponyms, instances, parts, gloss: gloss.trim() });
  }
  cache.set(pos, map);
  return map;
}

/** Offsets for a lemma in sense order (1-based sense numbers). */
export function senses(lemma: string, pos: Pos = 'noun'): string[] {
  const key = lemma.toLowerCase().replace(/ /g, '_');
  for (const line of readFileSync(join(dir, `index.${pos}`), 'utf8').split('\n')) {
    if (!line.startsWith(`${key} `)) continue;
    const t = line.trim().split(' ');
    const synsetCnt = parseInt(t[2], 10);
    return t.slice(t.length - synsetCnt);
  }
  return [];
}

/** "edible_fruit#1" -> the synset. */
export function synset(ref: string, pos: Pos = 'noun'): Synset {
  const [lemma, n = '1'] = ref.split('#');
  const offset = senses(lemma, pos)[Number(n) - 1];
  const s = offset && synsets(pos).get(offset);
  if (!s) throw new Error(`No ${pos} synset for ${ref}`);
  return s;
}

/**
 * All lemmas below a synset, excluding the root itself.
 * `instances`: include named instances (France, Zeus, the Nile).
 * `parts`: walk part meronyms only (car -> engine -> piston), not kinds of parts.
 */
export function descendants(root: Synset, opts: { instances?: boolean; parts?: boolean } = {}): Set<string> {
  const all = synsets(root.pos);
  const out = new Set<string>();
  const seen = new Set<string>([root.offset]);
  const next = (s: Synset) =>
    opts.parts ? s.parts : [...s.hyponyms, ...(opts.instances ? s.instances : [])];
  const stack = next(root);
  while (stack.length) {
    const off = stack.pop()!;
    if (seen.has(off)) continue;
    seen.add(off);
    const s = all.get(off);
    if (!s) continue;
    s.lemmas.forEach((l) => out.add(l));
    stack.push(...next(s));
  }
  return out;
}

/** Every lemma in WordNet (all parts of speech). */
export function allLemmas(): Set<string> {
  const out = new Set<string>();
  for (const pos of ['noun', 'verb', 'adj', 'adv'] as Pos[]) for (const s of synsets(pos).values()) s.lemmas.forEach((l) => out.add(l));
  return out;
}

if (process.argv[1]?.endsWith('wordnet.ts') && process.argv[2] === 'inspect') {
  for (const lemma of process.argv.slice(3)) {
    senses(lemma).forEach((off, i) => {
      const s = synsets('noun').get(off)!;
      console.log(`${lemma}#${i + 1}  [${s.lemmas.join(', ')}]  (${descendants(s, { instances: true }).size} / parts ${descendants(s, { parts: true }).size})  ${s.gloss.slice(0, 90)}`);
    });
  }
}
