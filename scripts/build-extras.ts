// Generates src/data/extras/<promptId>.json from WordNet: extra valid answers for
// answers not in the hand-built bank. Run with `npm run build:extras` after editing
// prompts.json or the CATEGORIES map below; the output is committed.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prompts from '../src/data/prompts.json';
import type { PromptDef } from '../src/lib/bank';
import { isBlocked } from '../src/lib/blocklist';
import { RULES, isRulePrompt, type ExtrasFile } from '../src/lib/extras';
import { buildIndex, normalize, toKey, variants } from '../src/lib/match';
import { allLemmas, descendants, synset } from './wordnet';

/**
 * WordNet noun senses whose descendants count as valid answers, per prompt.
 * "word#n" = the nth noun sense of word (see `npx tsx scripts/wordnet.ts inspect word`).
 * Prefix with "-" to subtract a subtree; suffix with ">" to take its parts instead
 * ("car#1>" = bumper, engine, ...).
 */
const CATEGORIES: Record<string, string[]> = {
  fruit: ['edible_fruit#1', 'berry#1'],
  vegetable: ['vegetable#1'],
  desserts: ['dessert#1', 'frozen_dessert#1', 'cake#3', 'pie#1', 'pudding#1', 'cookie#1'],
  cheeses: ['cheese#1'],
  'herbs-spices': ['herb#2', 'spice#2'],
  drinks: ['beverage#1', '-alcohol#1'],
  pasta: ['pasta#1', 'pasta#2'],
  bread: ['bread#1'],
  kitchen: ['kitchen_utensil#1', 'kitchen_appliance#1', 'cooking_utensil#1', 'tableware#1'],
  bathroom: ['toiletry#1'],
  tools: ['tool#1'],
  furniture: ['furniture#1'],
  clothing: ['clothing#1'],
  sports: ['sport#1'],
  'unplugged-games': ['board_game#1', 'card_game#1', "child's_game#1", 'parlor_game#1'],
  instruments: ['musical_instrument#1'],
  jobs: ['worker#1', 'professional#1'],
  mammals: ['mammal#1'],
  birds: ['bird#1'],
  'sea-creatures': ['fish#1', 'crustacean#1', 'mollusk#1', 'cetacean#1', 'pinniped_mammal#1', 'coelenterate#1', 'echinoderm#1', 'sea_turtle#1'],
  insects: ['insect#1', 'arachnid#1', 'myriapod#1'],
  'dog-breeds': ['dog#1'],
  'reptiles-amphibians': ['reptile#1', 'amphibian#3'],
  trees: ['tree#1'],
  flowers: ['flower#1', 'flower#2'],
  countries: ['European_country#1', 'African_country#1', 'Asian_country#1', 'South_American_country#1', 'North_American_country#1'],
  'africa-asia': ['African_country#1', 'Asian_country#1'],
  capitals: ['national_capital#1'],
  'us-places': ['American_state#1'],
  rivers: ['river#1'],
  islands: ['island#1'],
  languages: ['natural_language#1'],
  'body-parts': ['human_body#1>', 'organ#1', 'bone#1', 'muscle#1', 'gland#1', 'blood_vessel#1', 'nerve#1', 'external_body_part#1'],
  'car-parts': ['car#1>', 'motor_vehicle#1>', 'automobile_engine#1>', 'auto_accessory#1'],
  weather: ['weather#1', 'atmospheric_phenomenon#1'],
  colours: ['chromatic_color#1', 'achromatic_color#1'],
  emotions: ['emotion#1', 'feeling#1'],
  space: ['celestial_body#1', 'star#1', 'constellation#2'],
  elements: ['chemical_element#1'],
  gemstones: ['gem#2', 'mineral#1', 'rock#2'],
  'school-subjects': ['discipline#1'],
  'things-that-fly': ['aircraft#1', 'bat#1'],
  wheels: ['wheeled_vehicle#1'],
  fish: ['fish#1'],
  dinosaurs: ['archosaur#1', 'ichthyosaur#1', 'plesiosaur#1', 'mammoth#1', 'mastodon#1'],
  myths: ['mythical_being#1', 'imaginary_being#1', 'deity#1'],
  landforms: ['geological_formation#1', 'body_of_water#1'],
  diseases: ['disease#1', 'illness#1'],
  fabrics: ['fabric#1'],
  dances: ['dance#3'],
  units: ['unit_of_measurement#1'],
  shapes: ['plane_figure#1', 'solid#3'],
  currencies: ['monetary_unit#1'],
  boats: ['vessel#2', 'boat#1'],
  sauces: ['condiment#1', 'sauce#1'],
};

/** Prompts where capitalised names (places, gods, languages) are the point. */
const PROPER_OK = new Set(['countries', 'africa-asia', 'capitals', 'us-places', 'rivers', 'islands', 'languages', 'space', 'myths', 'dinosaurs']);

const LATIN_BINOMIAL = /^[A-Z][a-z]+ [a-z]+(us|um|a|is|ii|ae|i|es|ensis|oides|ata|ica|ina|ella|x)$/;
/** Anatomical Latin ("musculus temporalis", "venae meningeae"). */
const LATIN_ANATOMY = /^(musculus|vena|venae|arteria|arteriae|nervus|nervi|ligamentum|glandula|ductus|lobus|os|ramus|plexus|vas|fossa|sulcus|gyrus|corpus|cornu|ostium|arcus|truncus|regio|area) /;
/** Extra palindrome filter: no roman numerals, repeated letters or crude words. */
const BAD_PALINDROME = (w: string) => /^[ivxlcdm]+$/.test(w) || new Set(w).size === 1 || ['boob', 'tit', 'poop', 'pap'].includes(w);

function categoryWords(id: string, refs: string[]): Set<string> {
  const add = new Set<string>();
  const sub = new Set<string>();
  for (const ref of refs) {
    const minus = ref.startsWith('-');
    const parts = ref.endsWith('>');
    const name = ref.replace(/^-|>$/g, '');
    try {
      const words = descendants(synset(name), { instances: PROPER_OK.has(id), parts });
      words.forEach((w) => (minus ? sub : add).add(w));
    } catch (e) {
      console.warn(`  ${id}: skipped ${ref} (${(e as Error).message})`);
    }
  }
  const out = new Set<string>();
  for (const w of add) {
    if (sub.has(w) || /[0-9()]/.test(w) || LATIN_BINOMIAL.test(w) || LATIN_ANATOMY.test(w.toLowerCase())) continue;
    if (!PROPER_OK.has(id) && /^[A-Z]/.test(w) && !/ /.test(w)) continue; // lone proper nouns / genera
    out.add(w);
  }
  return out;
}

const dictionary = [...allLemmas()].filter((w) => /^[a-z]+$/.test(w)); // single lowercase words

const outDir = fileURLToPath(new URL('../src/data/extras/', import.meta.url));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let total = 0;
for (const def of prompts as unknown as PromptDef[]) {
  let file: ExtrasFile | null = null;
  if (isRulePrompt(def.id)) {
    const rule = RULES[def.id];
    file = { kind: 'rule', rule: def.id, words: dictionary.filter((w) => rule(toKey(w)) && !(def.id === 'palindromes' && BAD_PALINDROME(w))) };
  } else if (CATEGORIES[def.id]) {
    file = { kind: 'category', words: [...categoryWords(def.id, CATEGORIES[def.id])] };
  }
  if (!file) continue;

  // Drop anything the bank already accepts, blocked words, and very short entries.
  const bank = buildIndex(Object.keys(def.answers));
  const seen = new Set<string>();
  file.words = file.words
    .map((w) => normalize(w))
    .filter((w) => {
      const k = toKey(w);
      if (k.length < 3 || seen.has(k) || isBlocked(w)) return false;
      seen.add(k);
      // Rule prompts keep bank words too: they're the stems for inflections ("shuttering").
      return file!.kind === 'rule' || !variants(k).some((f) => bank.forms.has(f));
    })
    .sort();
  writeFileSync(`${outDir}${def.id}.json`, JSON.stringify(file));
  total += file.words.length;
  console.log(`${def.id.padEnd(22)} ${file.kind.padEnd(8)} ${file.words.length}`);
}
console.log(`${readdirSync(outDir).length} files, ${total} extra answers`);
