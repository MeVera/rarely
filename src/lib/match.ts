// Answer matching, shared by the browser and the Worker.
//
// Bank keys may list aliases separated by "|": "eggplant|aubergine". The first
// alias is the canonical answer; every alias matches it.

/** British spellings mapped to one canonical (American) form, word by word. */
export const SPELLING_MAP: Record<string, string> = {
  colour: 'color', flavour: 'flavor', favourite: 'favorite', honour: 'honor',
  neighbour: 'neighbor', harbour: 'harbor', armour: 'armor', humour: 'humor',
  grey: 'gray', jewellery: 'jewelry', tyre: 'tire', theatre: 'theater',
  centre: 'center', metre: 'meter', litre: 'liter', fibre: 'fiber',
  aluminium: 'aluminum', sulphur: 'sulfur', caesium: 'cesium',
  doughnut: 'donut', yoghurt: 'yogurt', aeroplane: 'airplane',
  pyjamas: 'pajamas', pyjama: 'pajama', moustache: 'mustache', plough: 'plow',
  mould: 'mold', cheque: 'check', catalogue: 'catalog', dialogue: 'dialog',
  programme: 'program', ploughman: 'plowman', storey: 'story', kerb: 'curb',
  chilli: 'chili', chillies: 'chilies', mum: 'mom', mummy: 'mommy',
  sceptic: 'skeptic', manoeuvre: 'maneuver', paediatrician: 'pediatrician',
  anaesthetist: 'anesthetist', orthopaedic: 'orthopedic', aesthetic: 'esthetic',
  oesophagus: 'esophagus', haemoglobin: 'hemoglobin', organise: 'organize',
  apologise: 'apologize', realise: 'realize', recognise: 'recognize',
  pretence: 'pretense', defence: 'defense', licence: 'license', offence: 'offense',
  travelling: 'traveling', traveller: 'traveler', jewelled: 'jeweled',
  woollen: 'woolen', practise: 'practice', axe: 'ax', whisky: 'whiskey',
  omelette: 'omelet', ladybird: 'ladybug', draught: 'draft', gaol: 'jail',
  tonne: 'ton', cosy: 'cozy', mollusc: 'mollusk', sombre: 'somber', lustre: 'luster',
};

const IRREGULAR_PLURALS: Record<string, string> = {
  mice: 'mouse', geese: 'goose', teeth: 'tooth', feet: 'foot', children: 'child',
  people: 'person', men: 'man', women: 'woman', oxen: 'ox', cacti: 'cactus',
  fungi: 'fungus', dice: 'die', lice: 'louse', octopi: 'octopus', loaves: 'loaf',
};

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalized text with spellings unified and spaces removed ("Ice-cream" -> "icecream"). */
export function toKey(text: string): string {
  return normalize(text)
    .split(' ')
    .map((w) => SPELLING_MAP[w] ?? w)
    .join('');
}

/** Possible singular/plural forms of a key (affects the end of the key only). */
export function variants(key: string): string[] {
  const out = new Set<string>([key]);
  for (const [plural, single] of Object.entries(IRREGULAR_PLURALS)) {
    if (key.endsWith(plural)) out.add(key.slice(0, -plural.length) + single);
    if (key.endsWith(single)) out.add(key.slice(0, -single.length) + plural);
  }
  if (key.length > 3 && key.endsWith('s') && !key.endsWith('ss')) {
    out.add(key.slice(0, -1));
    if (key.endsWith('es')) out.add(key.slice(0, -2));
    if (key.endsWith('ies')) out.add(key.slice(0, -3) + 'y');
    if (key.endsWith('ves')) {
      out.add(key.slice(0, -3) + 'f');
      out.add(key.slice(0, -3) + 'fe');
    }
  }
  return [...out];
}

export function splitAliases(bankKey: string): string[] {
  return bankKey.split('|').map((s) => s.trim()).filter(Boolean);
}

export function canonicalOf(bankKey: string): string {
  return splitAliases(bankKey)[0] ?? bankKey;
}

export interface AnswerIndex {
  /** form -> canonical answers reachable through it */
  forms: Map<string, Set<string>>;
  /** exact key -> canonical answer (exact matches win over variants) */
  exact: Map<string, string>;
  answers: string[];
}

/** Build an index from bank keys ("a|b" aliases allowed). */
export function buildIndex(bankKeys: Iterable<string>): AnswerIndex {
  const forms = new Map<string, Set<string>>();
  const exact = new Map<string, string>();
  const answers: string[] = [];
  for (const bankKey of bankKeys) {
    const canonical = canonicalOf(bankKey);
    answers.push(canonical);
    for (const alias of splitAliases(bankKey)) {
      const key = toKey(alias);
      if (!key) continue;
      if (!exact.has(key)) exact.set(key, canonical);
      for (const form of variants(key)) {
        let set = forms.get(form);
        if (!set) forms.set(form, (set = new Set()));
        set.add(canonical);
      }
    }
  }
  return { forms, exact, answers };
}

export function levenshtein(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export const FUZZY_MIN_LENGTH = 6;

export interface MatchResult {
  answer: string;
  how: 'exact' | 'variant' | 'fuzzy';
}

/** Match player input to one canonical answer, or null if it isn't in the list. */
export function matchAnswer(input: string, index: AnswerIndex): MatchResult | null {
  const key = toKey(input);
  if (!key) return null;

  const exact = index.exact.get(key);
  if (exact) return { answer: exact, how: 'exact' };

  const viaVariants = new Set<string>();
  for (const form of variants(key)) {
    index.forms.get(form)?.forEach((a) => viaVariants.add(a));
  }
  if (viaVariants.size === 1) return { answer: [...viaVariants][0], how: 'variant' };
  if (viaVariants.size > 1) return null; // ambiguous

  // Fuzzy: one typo allowed on 6+ letter words, only if it resolves uniquely.
  if (key.length < FUZZY_MIN_LENGTH) return null;
  const fuzzy = new Set<string>();
  for (const [form, owners] of index.forms) {
    if (form.length < FUZZY_MIN_LENGTH) continue;
    if (levenshtein(key, form, 1) <= 1) owners.forEach((a) => fuzzy.add(a));
    if (fuzzy.size > 1) return null;
  }
  return fuzzy.size === 1 ? { answer: [...fuzzy][0], how: 'fuzzy' } : null;
}
