// Validates src/data/prompts.json. Run with `npm run validate`.
// Errors: bad shape, duplicate ids, duplicate answers (raw or after normalization,
// including plural/singular and spelling variants), tiers outside 1-5, fewer than
// MIN_ANSWERS (100) answers. Warnings: more than MAX_ANSWERS answers.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUNDS_PER_DAY } from '../src/config';
import { splitAliases, toKey, variants } from '../src/lib/match';

const MIN_ANSWERS = 100;
const MAX_ANSWERS = 250;

const file = fileURLToPath(new URL('../src/data/prompts.json', import.meta.url));
const raw = readFileSync(file, 'utf8');
const errors: string[] = [];
const warnings: string[] = [];

let data: any;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`prompts.json is not valid JSON: ${(e as Error).message}`);
  process.exit(1);
}

if (!Array.isArray(data)) {
  console.error('prompts.json must be an array');
  process.exit(1);
}

// JSON.parse silently keeps the last of duplicate keys, so scan the raw text too.
const answerBlocks = [...raw.matchAll(/"id"\s*:\s*"([^"]+)"[\s\S]*?"answers"\s*:\s*\{([^{}]*)\}/g)];
for (const [, id, body] of answerBlocks) {
  const seen = new Set<string>();
  for (const [, key] of body.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) {
    if (seen.has(key)) errors.push(`${id}: answer "${key}" appears twice`);
    seen.add(key);
  }
}

const ids = new Set<string>();
data.forEach((p: any, i: number) => {
  const where = `prompt[${i}]${p?.id ? ` (${p.id})` : ''}`;
  if (typeof p?.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) errors.push(`${where}: id must be a lowercase slug`);
  else if (ids.has(p.id)) errors.push(`${where}: duplicate id`);
  else ids.add(p.id);
  if (typeof p?.prompt !== 'string' || !p.prompt.trim()) errors.push(`${where}: missing prompt text`);
  if (!p?.answers || typeof p.answers !== 'object' || Array.isArray(p.answers)) {
    errors.push(`${where}: answers must be an object`);
    return;
  }

  const entries = Object.entries(p.answers as Record<string, unknown>);
  if (entries.length < MIN_ANSWERS) errors.push(`${where}: only ${entries.length} answers (min ${MIN_ANSWERS})`);
  if (entries.length > MAX_ANSWERS) warnings.push(`${where}: ${entries.length} answers (guideline max ${MAX_ANSWERS})`);

  const exactOwner = new Map<string, string>();
  const formOwner = new Map<string, string>();
  for (const [key, tier] of entries) {
    if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > 5) {
      errors.push(`${where}: "${key}" has tier ${JSON.stringify(tier)} (must be 1-5)`);
    }
    const aliases = splitAliases(key);
    if (!aliases.length) errors.push(`${where}: empty answer`);
    for (const alias of aliases) {
      const k = toKey(alias);
      if (!k) {
        errors.push(`${where}: "${alias}" normalizes to nothing`);
        continue;
      }
      const prevExact = exactOwner.get(k);
      if (prevExact && prevExact !== key) errors.push(`${where}: "${alias}" duplicates "${prevExact}" after normalization`);
      exactOwner.set(k, key);
      for (const form of variants(k)) {
        const prev = formOwner.get(form);
        if (prev && prev !== key && !prevExact) {
          errors.push(`${where}: "${alias}" collides with "${prev}" (plural/singular form "${form}")`);
        }
        formOwner.set(form, key);
      }
    }
  }
});

if (data.length < ROUNDS_PER_DAY) errors.push(`need at least ${ROUNDS_PER_DAY} prompts, found ${data.length}`);

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
const total = data.reduce((n: number, p: any) => n + Object.keys(p?.answers ?? {}).length, 0);
console.log(`${data.length} prompts, ${total} answers, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
