// POST /submit — records answers. Never awards points: scores are computed client-side.
import { MAX_ANSWER_LENGTH, MAX_ANSWERS_PER_ROUND, ROUNDS_PER_DAY } from '../../src/config';
import { liveIndex } from '../../src/lib/bank';
import { addDays, dateString, isDateString } from '../../src/lib/daily';
import { matchAnswer, normalize } from '../../src/lib/match';
import { liveStartingTiers, loadOverrides, overridesByPrompt, PROMPTS_BY_ID, type Env } from './live';

const MAX_BODY_BYTES = 256 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Queued offline submissions may arrive late. */
const MAX_DAYS_LATE = 7;

export const RATE_LIMIT = { windowMs: 10 * 60_000, max: 20 };

interface Body {
  playerId: string;
  date: string;
  rounds: { promptId: string; answers: string[] }[];
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function validateBody(input: unknown, today: string): Body {
  const b = input as Partial<Body> | null;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Body must be a JSON object');
  if (typeof b.playerId !== 'string' || !UUID_RE.test(b.playerId)) throw new HttpError(400, 'Invalid playerId');
  if (!isDateString(b.date)) throw new HttpError(400, 'Invalid date');
  if (b.date > today || b.date < addDays(today, -MAX_DAYS_LATE)) throw new HttpError(400, 'Date out of range');
  if (!Array.isArray(b.rounds) || b.rounds.length < 1 || b.rounds.length > ROUNDS_PER_DAY) {
    throw new HttpError(400, `rounds must have 1-${ROUNDS_PER_DAY} entries`);
  }
  const seen = new Set<string>();
  const rounds = b.rounds.map((r) => {
    if (!r || typeof r.promptId !== 'string' || !PROMPTS_BY_ID.has(r.promptId)) throw new HttpError(400, 'Unknown promptId');
    if (seen.has(r.promptId)) throw new HttpError(400, 'Duplicate promptId');
    seen.add(r.promptId);
    if (!Array.isArray(r.answers) || r.answers.length > MAX_ANSWERS_PER_ROUND) throw new HttpError(400, 'Too many answers');
    if (!r.answers.every((a) => typeof a === 'string' && a.length <= MAX_ANSWER_LENGTH * 2)) throw new HttpError(400, 'Invalid answer');
    return { promptId: r.promptId, answers: r.answers.map((a) => a.slice(0, MAX_ANSWER_LENGTH)) };
  });
  return { playerId: b.playerId.toLowerCase(), date: b.date, rounds };
}

async function hashIp(ip: string, salt = ''): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(buf).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rateLimited(env: Env, ip: string): Promise<boolean> {
  const window = Math.floor(Date.now() / RATE_LIMIT.windowMs) * RATE_LIMIT.windowMs;
  const key = `${await hashIp(ip, env.IP_SALT)}:${window}`;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`,
  ).bind(key, window).first<{ count: number }>();
  return (row?.count ?? 0) > RATE_LIMIT.max;
}

export async function handleSubmit(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  if (await rateLimited(env, ip)) throw new HttpError(429, 'Too many submissions, try again later');

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  const today = dateString();
  const body = validateBody(json, today);

  // One submission per player per date.
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO submissions (player_id, date, created_at) VALUES (?, ?, ?)')
    .bind(body.playerId, body.date, new Date().toISOString())
    .run();
  if (!claim.meta.changes) throw new HttpError(409, 'Already submitted for this date');

  try {
    const overrides = overridesByPrompt(await loadOverrides(env.DB));
    const answerRows: { p: string; a: string; l: number }[] = [];
    for (const round of body.rounds) {
      const def = PROMPTS_BY_ID.get(round.promptId)!;
      const promptOverrides = overrides.get(round.promptId);
      const index = liveIndex(def, liveStartingTiers(def, promptOverrides));
      const distinct = new Map<string, number>();
      for (const raw of round.answers) {
        const match = matchAnswer(raw, index);
        const answer = match ? match.answer : normalize(raw);
        if (!answer) continue;
        if (!match && promptOverrides?.get(answer)?.status === 'banned') continue;
        distinct.set(answer, match ? 1 : 0);
      }
      for (const [a, l] of distinct) answerRows.push({ p: round.promptId, a, l });
    }

    // A fixed number of statements regardless of size (D1 limits queries and bound parameters).
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO prompt_players (prompt_id, player_id, first_date)
         SELECT value, ?1, ?2 FROM json_each(?3)`,
      ).bind(body.playerId, body.date, JSON.stringify(body.rounds.map((r) => r.promptId))),
      env.DB.prepare(
        `INSERT OR IGNORE INTO player_answers (prompt_id, answer, player_id, listed, first_date)
         SELECT json_extract(value, '$.p'), json_extract(value, '$.a'), ?1, json_extract(value, '$.l'), ?2
         FROM json_each(?3)`,
      ).bind(body.playerId, body.date, JSON.stringify(answerRows)),
    ]);
    return Response.json({ ok: true, recorded: answerRows.length });
  } catch (err) {
    // Let the client retry if recording failed.
    await env.DB.prepare('DELETE FROM submissions WHERE player_id = ? AND date = ?').bind(body.playerId, body.date).run();
    throw err;
  }
}
