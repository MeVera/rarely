// Simulates players submitting through the real /submit API (local dev only).
// Usage: tsx scripts/simulate-players.ts <count> [startIndex] [apiBase]
// Player i gives a different answer for every prompt: mostly listed answers
// (cycling through the bank, with case/plural variations), every 7th one unlisted.
import prompts from '../src/data/prompts.json';
import { canonicalOf } from '../src/lib/match';
import type { PromptDef } from '../src/lib/bank';
import { dateString, promptIdsForDate } from '../src/lib/daily';

const count = Number(process.argv[2] ?? 99);
const start = Number(process.argv[3] ?? 0);
const api = process.argv[4] ?? 'http://127.0.0.1:8787';
const defs = prompts as unknown as PromptDef[];
const date = dateString();
const ids = promptIdsForDate(date, defs.map((p) => p.id));

const statuses: Record<number, number> = {};
for (let i = start; i < start + count; i++) {
  const rounds = ids.map((promptId) => {
    const answers = Object.keys(defs.find((d) => d.id === promptId)!.answers).map(canonicalOf);
    const answer = i % 7 === 6 ? `made up ${promptId} ${i}` : answers[i % answers.length];
    return { promptId, answers: [i % 3 === 1 ? answer.toUpperCase() : answer] };
  });
  const playerId = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const res = await fetch(`${api}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.${Math.floor(i / 250)}.${i % 250}` },
    body: JSON.stringify({ playerId, date, rounds }),
  });
  statuses[res.status] = (statuses[res.status] ?? 0) + 1;
  if (!res.ok) console.log(i, res.status, await res.text());
}
console.log(`date ${date}: submitted players ${start}..${start + count - 1}`, statuses);
