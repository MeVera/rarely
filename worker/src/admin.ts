// /admin — review queue and prompt progress. Protected by the ADMIN_TOKEN secret,
// sent as "Authorization: Bearer <token>" by the admin page's own JS.
import { buildIndex, matchAnswer, normalize } from '../../src/lib/match';
import { MIN_PLAYERS } from '../../src/lib/scoring';
import { isBlocked } from '../../src/lib/blocklist';
import { liveStartingTiers, loadOverrides, overridesByPrompt, PROMPTS, PROMPTS_BY_ID, type Env } from './live';
import { getMeta, playerCounts, runNightly } from './nightly';
import { HttpError } from './submit';

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function requireAdmin(req: Request, env: Env) {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, 'Admin is disabled: set the ADMIN_TOKEN secret');
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) throw new HttpError(401, 'Unauthorized');
}

export async function adminState(env: Env) {
  // Sequential on purpose: parallel reads have tripped D1 session errors.
  const N = await playerCounts(env.DB);
  const overrideList = await loadOverrides(env.DB);
  const lastRun = await getMeta(env.DB, 'last_run_date');
  const lastRunAt = await getMeta(env.DB, 'last_run_at');
  const overrides = overridesByPrompt(overrideList);

  const prompts = PROMPTS.map((p) => ({
    id: p.id,
    prompt: p.prompt,
    players: N.get(p.id) ?? 0,
    usingPlayerData: (N.get(p.id) ?? 0) >= MIN_PLAYERS,
    answers: Object.keys(liveStartingTiers(p, overrides.get(p.id))).length,
  }));

  const { results } = await env.DB.prepare(
    `SELECT prompt_id, answer, COUNT(*) AS n FROM player_answers WHERE listed = 0
     GROUP BY prompt_id, answer ORDER BY n DESC LIMIT 1000`,
  ).all<{ prompt_id: string; answer: string; n: number }>();

  const indexes = new Map<string, ReturnType<typeof buildIndex>>();
  const queue = [];
  for (const r of results ?? []) {
    const def = PROMPTS_BY_ID.get(r.prompt_id);
    if (!def) continue;
    const o = overrides.get(r.prompt_id)?.get(r.answer);
    if (o) continue; // decided
    let idx = indexes.get(r.prompt_id);
    if (!idx) indexes.set(r.prompt_id, (idx = buildIndex(Object.keys(liveStartingTiers(def, overrides.get(r.prompt_id))))));
    if (matchAnswer(r.answer, idx)) continue; // now accepted
    queue.push({ promptId: r.prompt_id, prompt: def.prompt, answer: r.answer, players: r.n, blocked: isBlocked(r.answer) });
    if (queue.length >= 300) break;
  }

  return {
    minPlayers: MIN_PLAYERS,
    lastRun,
    lastRunAt,
    prompts,
    queue,
    decisions: overrideList.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 200),
  };
}

export async function adminAction(req: Request, env: Env) {
  const body = (await req.json().catch(() => null)) as
    | { promptId?: string; answer?: string; action?: string; tier?: number }
    | null;
  if (!body || !body.promptId || !PROMPTS_BY_ID.has(body.promptId)) throw new HttpError(400, 'Unknown promptId');
  const answer = normalize(body.answer ?? '');
  if (!answer || answer.length > 60) throw new HttpError(400, 'Invalid answer');
  const now = new Date().toISOString();
  if (body.action === 'reset') {
    await env.DB.prepare('DELETE FROM answer_overrides WHERE prompt_id = ? AND answer = ?').bind(body.promptId, answer).run();
    return { ok: true };
  }
  const status = { approve: 'approved', reject: 'rejected', ban: 'banned' }[body.action ?? ''];
  if (!status) throw new HttpError(400, 'action must be approve, reject, ban or reset');
  const tier = Math.min(5, Math.max(1, Math.round(Number(body.tier) || 5)));
  await env.DB.prepare(
    `INSERT INTO answer_overrides (prompt_id, answer, status, starting_tier, source, updated_at)
     VALUES (?, ?, ?, ?, 'admin', ?)
     ON CONFLICT(prompt_id, answer) DO UPDATE SET status = excluded.status,
       starting_tier = excluded.starting_tier, source = 'admin', updated_at = excluded.updated_at`,
  ).bind(body.promptId, answer, status, tier, now).run();
  return { ok: true };
}

export async function adminPublish(env: Env) {
  return runNightly(env, { force: true });
}

export const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Rarely admin</title>
<style>
:root{--bg:#fafaf8;--fg:#1b1b1f;--muted:#5d5d66;--line:#dcdad3;--accent:#4f3fd1;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#131316;--fg:#ececf0;--muted:#a6a6b0;--line:#393941;--accent:#a99cff}}
body{font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:16px;max-width:1000px;margin:auto}
table{border-collapse:collapse;width:100%;margin:8px 0 24px}th,td{text-align:left;padding:6px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted)}td.n{text-align:right;font-variant-numeric:tabular-nums}
button{font:inherit;padding:4px 10px;border-radius:6px;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
input,select{font:inherit;padding:6px 8px;border-radius:6px;border:1px solid var(--line);background:transparent;color:inherit}
.bar{height:6px;background:var(--line);border-radius:3px;min-width:80px}.bar>div{height:100%;background:var(--accent);border-radius:3px}
.muted{color:var(--muted)}.flag{color:#b3261e;font-size:12px}:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
</style></head><body>
<h1>Rarely admin</h1>
<form id="login"><label>Admin token <input id="token" type="password" autocomplete="off" required></label> <button class="primary">Open</button></form>
<div id="app" hidden>
<p class="muted" id="status"></p>
<p><button id="publish">Run nightly job now</button> <button id="refresh">Refresh</button> <button id="logout">Sign out</button></p>
<h2>Review queue</h2><p class="muted">Unlisted answers, most-given first. Approve adds the answer with a starting tier (default 5).</p>
<table><thead><tr><th>Prompt</th><th>Answer</th><th class="n">Players</th><th>Action</th></tr></thead><tbody id="queue"></tbody></table>
<h2>Manual decision</h2>
<form id="manual"><select id="m-prompt"></select> <input id="m-answer" placeholder="answer" required>
<select id="m-action"><option value="approve">approve</option><option value="ban">ban (removes even bank answers)</option><option value="reject">reject</option><option value="reset">reset</option></select>
<select id="m-tier"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select> <button class="primary">Apply</button></form>
<h2>Prompts</h2>
<table><thead><tr><th>Prompt</th><th class="n">Players (N)</th><th>Progress</th><th>Tiers from</th><th class="n">Answers</th></tr></thead><tbody id="prompts"></tbody></table>
<h2>Recent decisions</h2>
<table><thead><tr><th>Prompt</th><th>Answer</th><th>Status</th><th>Tier</th><th>By</th><th></th></tr></thead><tbody id="decisions"></tbody></table>
</div>
<script>
const base = location.pathname.replace(/\\/admin\\/?$/, '');
let token = sessionStorage.getItem('rarely-admin') || '';
const $ = (id) => document.getElementById(id);
function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
async function api(path, body) {
  const res = await fetch(base + '/admin/api/' + path, { method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { sessionStorage.removeItem('rarely-admin'); token = ''; show(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}
function show() { $('login').hidden = !!token; $('app').hidden = !token; if (token) load(); }
async function act(promptId, answer, action, tier) { await api('action', { promptId, answer, action, tier }); load(); }
async function load() {
  const s = await api('state');
  $('status').textContent = 'Last nightly run: ' + (s.lastRun || 'never') + (s.lastRunAt ? ' (' + s.lastRunAt + ')' : '') + ' · threshold ' + s.minPlayers + ' players';
  const q = $('queue'); q.replaceChildren();
  if (!s.queue.length) { const tr = el('tr'); tr.append(el('td', 'Nothing waiting.', 'muted')); q.append(tr); }
  for (const r of s.queue) {
    const tr = el('tr'); tr.append(el('td', r.prompt));
    const a = el('td', r.answer); if (r.blocked) a.append(' ', el('span', 'blocklist', 'flag')); tr.append(a);
    tr.append(el('td', r.players, 'n'));
    const td = el('td'); const sel = el('select'); [5,4,3,2,1].forEach(t => { const o = el('option', 'tier ' + t); o.value = t; sel.append(o); });
    const ap = el('button', 'Approve'); ap.onclick = () => act(r.promptId, r.answer, 'approve', Number(sel.value));
    const rj = el('button', 'Reject'); rj.onclick = () => act(r.promptId, r.answer, 'reject');
    const bn = el('button', 'Ban'); bn.onclick = () => act(r.promptId, r.answer, 'ban');
    td.append(sel, ' ', ap, ' ', rj, ' ', bn); tr.append(td); q.append(tr);
  }
  const p = $('prompts'); p.replaceChildren(); const mp = $('m-prompt'); mp.replaceChildren();
  for (const r of s.prompts.sort((a, b) => b.players - a.players)) {
    const tr = el('tr'); tr.append(el('td', r.prompt), el('td', r.players, 'n'));
    const td = el('td'); const bar = el('div', null, 'bar'); const fill = el('div'); fill.style.width = Math.min(100, r.players / s.minPlayers * 100) + '%'; bar.append(fill); td.append(bar); tr.append(td);
    tr.append(el('td', r.usingPlayerData ? 'player data' : 'starting tiers'), el('td', r.answers, 'n')); p.append(tr);
    const o = el('option', r.prompt); o.value = r.id; mp.append(o);
  }
  const d = $('decisions'); d.replaceChildren();
  for (const r of s.decisions) {
    const tr = el('tr'); tr.append(el('td', r.prompt_id), el('td', r.answer), el('td', r.status), el('td', r.starting_tier), el('td', r.source));
    const td = el('td'); const b = el('button', 'Undo'); b.onclick = () => act(r.prompt_id, r.answer, 'reset'); td.append(b); tr.append(td); d.append(tr);
  }
}
$('login').onsubmit = (e) => { e.preventDefault(); token = $('token').value; sessionStorage.setItem('rarely-admin', token); show(); };
$('logout').onclick = () => { sessionStorage.removeItem('rarely-admin'); token = ''; show(); };
$('refresh').onclick = load;
$('publish').onclick = async () => { const r = await api('publish', {}); alert('Published tiers for ' + r.date + (r.autoAdded && r.autoAdded.length ? '. Auto-added ' + r.autoAdded.length + ' answers.' : '.')); load(); };
$('manual').onsubmit = (e) => { e.preventDefault(); act($('m-prompt').value, $('m-answer').value, $('m-action').value, Number($('m-tier').value)); };
show();
</script></body></html>`;
