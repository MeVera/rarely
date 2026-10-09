import './style.css';
import { GAME_NAME, ROUND_SECONDS, ROUNDS_PER_DAY } from './config';
import { API_BASE, enqueueSubmission, fetchTiers, flushQueue, pendingSubmissions } from './lib/api';

/** False on a static-only deploy: hide copy that promises a server. */
const ONLINE = Boolean(API_BASE);
import { dateString, msUntilReset } from './lib/daily';
import {
  PROMPTS_BY_ID, loadExtras, loadGame, newGame, pruneOldGames, rarestMissed, saveGame, submitEntry, totalScore,
  type Entry, type GameState,
} from './lib/game';
import { labelForTier, pointsForTier, TIER_LABELS } from './lib/scoring';
import { formatDate, SHARE_SQUARES, shareText } from './lib/share';
import { computeStats, type DayRecord } from './lib/stats';
import * as store from './lib/storage';

// --- tiny DOM helper -------------------------------------------------------

type Child = Node | string | number | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'list' && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const $main = document.getElementById('main')!;
const $banner = document.getElementById('banner')!;
const $dialog = document.getElementById('dialog') as HTMLDialogElement;

function mount(...nodes: Node[]) {
  stopTimers();
  $main.replaceChildren(...nodes);
}

const fmtNum = (n: number) => n.toLocaleString('en-AU');
const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtCountdown = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

// --- state -----------------------------------------------------------------

let today = dateString();
let game: GameState | null = loadGame(today);
let tickTimer: number | undefined;
let countdownTimer: number | undefined;

function stopTimers() {
  clearInterval(tickTimer);
  clearInterval(countdownTimer);
  tickTimer = countdownTimer = undefined;
}

function history(): DayRecord[] {
  return store.load<DayRecord[]>('history', []);
}

function persist() {
  if (game) saveGame(game);
}

// --- screens ---------------------------------------------------------------

function renderHome() {
  const stats = computeStats(history(), today);
  const g = game;
  let primary: HTMLElement;
  let note: Child = null;

  if (!g || (g.phase === 'ready' && g.roundIndex === 0)) {
    primary = h('button', { class: 'btn block', type: 'button', onclick: startDay }, "Play today's game");
  } else if (g.phase === 'done') {
    primary = h('button', { class: 'btn block', type: 'button', onclick: renderEnd }, "See today's results");
    note = h('p', { class: 'muted small center' }, `You scored ${fmtNum(totalScore(g))} today.`);
  } else {
    const label = g.phase === 'review' ? `Continue — round ${g.roundIndex + 1} review` : `Resume — round ${g.roundIndex + 1} of ${ROUNDS_PER_DAY}`;
    primary = h('button', { class: 'btn block', type: 'button', onclick: resume }, label);
    note = h('p', { class: 'muted small center' }, `Score so far: ${fmtNum(totalScore(g))}`);
  }

  mount(
    h('section', { class: 'stack', 'aria-labelledby': 'home-title' },
      h('p', { class: 'muted small' }, formatDate(today)),
      h('h1', { id: 'home-title' }, 'Think of the answer nobody else will.'),
      h('p', { class: 'muted' },
        `${ROUNDS_PER_DAY} prompts, ${ROUND_SECONDS} seconds each. Your first correct answer counts. ` +
        'Common answers score a little; rare ones score a lot.'),
      primary,
      note,
      statRow(stats),
      h('div', { class: 'card small' },
        h('strong', {}, 'Points by rarity'),
        h('div', { class: 'legend', style: 'margin-top:8px' },
          ...TIER_LABELS.map((label, i) => h('span', { class: `chip t${i + 1}` }, label, h('b', {}, pointsForTier(i + 1))))),
      ),
    ),
  );
}

function statRow(stats: { daysPlayed: number; best: number; streak: number }) {
  return h('div', { class: 'statrow' },
    h('div', {}, h('strong', {}, stats.daysPlayed), h('span', {}, 'Days played')),
    h('div', {}, h('strong', {}, fmtNum(stats.best)), h('span', {}, 'Best score')),
    h('div', {}, h('strong', {}, stats.streak), h('span', {}, 'Current streak')),
  );
}

async function startDay() {
  mount(h('p', { class: 'muted', role: 'status' }, "Loading today's prompts…"));
  // tiers.json is loaded once per day and frozen into the saved game.
  const file = await fetchTiers();
  if (dateString() !== today) return rollover();
  game = newGame(today, file);
  await loadExtras(game.rounds.map((r) => r.promptId));
  game.phase = 'playing';
  persist();
  renderRound();
}

async function resume() {
  if (!game) return renderHome();
  await loadExtras(game.rounds.map((r) => r.promptId));
  if (game.phase === 'review') return renderReview();
  if (game.phase === 'done') return renderEnd();
  game.phase = 'playing';
  persist();
  renderRound();
}

function renderRound() {
  const g = game!;
  const round = g.rounds[g.roundIndex];
  const def = PROMPTS_BY_ID.get(round.promptId)!;

  const timerEl = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' }, fmtClock(round.timeLeftMs));
  const bar = h('div', {});
  const feedback = h('p', { class: 'feedback', 'aria-live': 'polite' }, 'Keep guessing until you get one right.');
  const input = h('input', {
    id: 'answer', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: false,
    enterkeyhint: 'send', maxlength: 60, placeholder: 'Type your answer',
  });
  const form = h('form', { class: 'entry', onsubmit: (ev: Event) => { ev.preventDefault(); onEnter(); } },
    h('label', { for: 'answer', class: 'visually-hidden' }, `Answer for: ${def.prompt}`),
    input,
    h('button', { class: 'btn', type: 'submit' }, 'Enter'),
  );

  // A correct answer ends the round; a wrong one says so and lets them try again.
  function onEnter() {
    const res = submitEntry(g, input.value);
    input.focus();
    feedback.className = 'feedback';
    void feedback.offsetWidth; // restart the animation
    if (res.kind === 'accepted') return endRound();
    if (res.kind === 'empty') {
      feedback.classList.add('meh');
      feedback.textContent = 'Type an answer first, or skip.';
      return;
    }
    if (res.kind === 'full') {
      feedback.classList.add('meh');
      feedback.textContent = 'That’s a lot of tries — skip to the next prompt.';
      return;
    }
    input.value = '';
    feedback.classList.add('bad');
    feedback.textContent = res.kind === 'duplicate'
      ? 'You already tried that — try something else.'
      : `Incorrect — “${res.entry.text}” isn’t on our list. Try again.`;
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
    persist();
  }

  mount(
    h('section', { 'aria-labelledby': 'prompt' },
      h('div', { class: 'roundbar' },
        h('span', {}, `Round ${g.roundIndex + 1} of ${ROUNDS_PER_DAY}`),
        h('span', {}, `${fmtNum(totalScore(g))} pts`),
        timerEl,
      ),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, bar),
      h('h1', { id: 'prompt', class: 'prompt' }, def.prompt),
      form,
      feedback,
      h('div', { class: 'actions' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => endRound() }, 'Skip'),
      ),
    ),
  );
  input.focus();

  // Timer: counts down from the saved time left; saved every tick so a closed tab resumes.
  const total = ROUND_SECONDS * 1000;
  const deadline = Date.now() + round.timeLeftMs;
  let lastSaved = round.timeLeftMs;
  const tick = () => {
    round.timeLeftMs = Math.max(0, deadline - Date.now());
    timerEl.textContent = fmtClock(round.timeLeftMs);
    timerEl.classList.toggle('low', round.timeLeftMs <= 10_000);
    bar.style.transform = `scaleX(${round.timeLeftMs / total})`;
    if (lastSaved - round.timeLeftMs >= 1000) {
      lastSaved = round.timeLeftMs;
      persist();
    }
    if (round.timeLeftMs <= 0) endRound(true);
  };
  tick();
  tickTimer = window.setInterval(tick, 250);
}

function endRound(timeUp = false) {
  const g = game!;
  const round = g.rounds[g.roundIndex];
  if (round.finished) return;
  round.finished = true;
  if (timeUp) round.timeLeftMs = 0;
  g.phase = 'review';
  persist();
  renderReview(timeUp);
}

function renderReview(timeUp = false) {
  const g = game!;
  const round = g.rounds[g.roundIndex];
  const def = PROMPTS_BY_ID.get(round.promptId)!;
  const accepted = round.entries.filter((e) => e.answer);
  const rejected = round.entries.filter((e) => !e.answer);
  const missed = rarestMissed(g, round);
  const last = g.roundIndex === g.rounds.length - 1;

  const next = h('button', { class: 'btn block', type: 'button', onclick: nextRound }, last ? 'See results' : 'Next round');

  mount(
    h('section', { 'aria-labelledby': 'review-title', class: 'stack' },
      h('p', { class: 'muted small' }, `${timeUp ? 'Time’s up · ' : ''}Round ${g.roundIndex + 1} of ${ROUNDS_PER_DAY}`),
      h('h1', { id: 'review-title', tabindex: -1 }, def.prompt),
      h('p', { class: 'big' }, `+${fmtNum(round.score)}`),
      h('h3', {}, 'Your answer'),
      accepted.length
        ? h('ul', { class: 'chips' }, ...accepted.map((e) => h('li', { class: `chip t${e.tier}` },
            e.answer!, h('b', {}, `${labelForTier(e.tier!)} +${e.points}`))))
        : h('p', { class: 'muted' }, timeUp ? 'No correct answer in time.' : 'Skipped.'),
      accepted.some((e) => e.verified)
        ? h('p', { class: 'muted small' }, 'Not on our list, but it’s a real answer in the dictionary, so it scores as Rare.')
        : null,
      rejected.length
        ? h('div', {},
            h('h3', {}, 'Incorrect guesses'),
            h('ul', { class: 'rejected-list' }, ...rejected.map((e) => rejectedRow(e))),
            ONLINE ? h('p', { class: 'muted small' }, 'Every answer is recorded. Popular ones get added to the list.') : null,
          )
        : null,
      missed.length
        ? h('div', {},
            h('h3', {}, 'Rarest answers you missed'),
            h('ul', { class: 'chips' }, ...missed.map((m) => h('li', { class: `chip miss` },
              m.answer, h('b', {}, labelForTier(m.tier))))),
          )
        : null,
      h('div', { class: 'actions' }, next),
    ),
  );
  (document.getElementById('review-title') as HTMLElement).focus();
}

function rejectedRow(e: Entry) {
  const btn = h('button', { class: 'linkish', type: 'button' }, 'This should count');
  const note = h('span', { class: 'note' }, 'Thanks — noted.');
  const done = () => btn.replaceWith(note);
  btn.addEventListener('click', () => {
    e.flagged = true; // The server already receives every answer; nothing extra to send.
    persist();
    done();
  });
  const row = h('li', {}, h('span', { class: 'chip rej' }, e.text), ONLINE ? btn : null);
  if (e.flagged) done();
  return row;
}

function nextRound() {
  const g = game!;
  if (g.roundIndex >= g.rounds.length - 1) return finishDay();
  g.roundIndex++;
  g.phase = 'playing';
  persist();
  renderRound();
}

function finishDay() {
  const g = game!;
  g.phase = 'done';
  if (!g.submitted) {
    g.submitted = true;
    const rec: DayRecord = { date: g.date, score: totalScore(g), rounds: g.rounds.map((r) => r.score) };
    store.save('history', [...history().filter((h) => h.date !== g.date), rec]);
    enqueueSubmission({
      playerId: store.playerId(),
      date: g.date,
      rounds: g.rounds.map((r) => ({ promptId: r.promptId, answers: r.entries.map((e) => e.text) })),
    });
  }
  persist();
  renderEnd();
  void flushQueue().then(updatePendingNote);
}

let updatePendingNote = () => {};

function renderEnd() {
  const g = game!;
  const total = totalScore(g);
  const shareBtn = h('button', { class: 'btn', type: 'button' }, 'Share');
  const shareStatus = h('p', { class: 'muted small center', 'aria-live': 'polite' });
  shareBtn.addEventListener('click', async () => {
    const ok = await copy(shareText(g, location.origin + location.pathname));
    shareStatus.textContent = ok ? 'Copied to clipboard.' : 'Couldn’t copy — select the text below instead.';
    if (!ok) shareStatus.after(h('pre', { class: 'card small' }, shareText(g, location.origin)));
  });

  const countdown = h('strong', { style: 'font-variant-numeric:tabular-nums' }, fmtCountdown(msUntilReset()));
  const pending = h('p', { class: 'muted small center' });
  updatePendingNote = () => {
    pending.textContent = ONLINE && pendingSubmissions() ? 'Your answers are saved and will be sent when you’re back online.' : '';
  };
  updatePendingNote();

  const rows = g.rounds.map((r, i) => {
    const def = PROMPTS_BY_ID.get(r.promptId)!;
    const best = Math.max(0, ...r.entries.map((e) => e.tier ?? 0));
    return h('tr', {},
      h('td', {}, h('span', { 'aria-hidden': 'true' }, SHARE_SQUARES[best], ' '), `${i + 1}. ${def.prompt}`),
      h('td', {}, r.entries.find((e) => e.answer)?.answer ?? '—'),
      h('td', { class: 'num' }, fmtNum(r.score)),
    );
  });

  mount(
    h('section', { class: 'stack', 'aria-labelledby': 'end-title' },
      h('p', { class: 'muted small' }, formatDate(g.date)),
      h('h1', { id: 'end-title' }, 'Today’s score'),
      h('p', { class: 'big' }, fmtNum(total)),
      h('div', { class: 'actions' }, shareBtn),
      shareStatus,
      pending,
      h('p', { class: 'center' }, 'Next game in ', countdown),
      statRow(computeStats(history(), today)),
      h('h3', {}, 'Round by round'),
      h('table', { class: 'breakdown' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Prompt'), h('th', {}, 'Answer'), h('th', { class: 'num' }, 'Points'))),
        h('tbody', {}, ...rows),
      ),
      ONLINE && g.tiersSource === 'starting'
        ? h('p', { class: 'muted small' }, 'Scored with starting rarity tiers (live tiers were unavailable when you started).')
        : null,
    ),
  );
  countdownTimer = window.setInterval(() => {
    const ms = msUntilReset();
    countdown.textContent = fmtCountdown(ms);
    if (dateString() !== today) checkDay();
  }, 1000);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// --- dialogs ---------------------------------------------------------------

function openDialog(title: string, ...content: Child[]) {
  $dialog.replaceChildren(
    h('h2', { id: 'dialog-title' }, title),
    ...content.filter(Boolean).map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))),
    h('form', { method: 'dialog', class: 'actions' }, h('button', { class: 'btn secondary', type: 'submit' }, 'Close')),
  );
  $dialog.showModal();
}

function showHelp() {
  openDialog('How to play',
    h('ol', {},
      h('li', {}, `Everyone gets the same ${ROUNDS_PER_DAY} prompts each day.`),
      h('li', {}, `You have ${ROUND_SECONDS} seconds per prompt. Type an answer and press Enter. If it’s wrong, you can keep guessing; your first correct answer scores and ends the round.`),
      h('li', {}, 'Rarer answers score more: ', TIER_LABELS.map((l, i) => `${l} ${pointsForTier(i + 1)}`).join(' · '), '.'),
      ONLINE ? h('li', {}, 'Rarity starts from our answer bank and adjusts to what real players say once a prompt has enough plays.') : null,
      h('li', {}, 'Spelling slips on longer words, plurals and British/American spellings are fine.'),
      h('li', {}, 'Not on our list? If it’s a real word that fits the prompt (checked against a built-in dictionary), it still scores as Rare.'),
    ),
    h('p', { class: 'muted small' }, `A new game starts at midnight Melbourne time. One play per day. ${GAME_NAME} has no accounts and no ads.`),
  );
}

function showStats() {
  const hist = history().slice().sort((a, b) => b.date.localeCompare(a.date));
  openDialog('Your stats',
    statRow(computeStats(hist, today)),
    hist.length
      ? h('table', { class: 'breakdown', style: 'margin-top:16px' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'num' }, 'Score'))),
          h('tbody', {}, ...hist.slice(0, 14).map((r) => h('tr', {}, h('td', {}, formatDate(r.date)), h('td', { class: 'num' }, fmtNum(r.score))))),
        )
      : h('p', { class: 'muted', style: 'margin-top:12px' }, 'Play a game to start your stats.'),
    h('p', { class: 'muted small', style: 'margin-top:12px' }, 'Stats are stored on this device only.'),
  );
}

// --- day rollover ----------------------------------------------------------

function checkDay() {
  const now = dateString();
  if (now === today) return;
  const playing = game && game.phase === 'playing';
  $banner.replaceChildren(
    h('span', {}, playing ? 'A new day’s game is ready. Finish this round first, or switch now.' : 'A new day’s game is available.'),
    h('button', { class: 'btn', type: 'button', style: 'min-height:40px;padding:6px 16px', onclick: rollover }, 'Start new day'),
  );
  $banner.hidden = false;
}

function rollover() {
  // An unfinished game from yesterday is kept on this device but no longer playable.
  if (game && game.phase !== 'done' && game.rounds.some((r) => r.entries.length)) {
    game.rounds.forEach((r) => (r.finished = true));
    finishDaySilently(game);
  }
  today = dateString();
  game = loadGame(today);
  $banner.hidden = true;
  pruneOldGames(today);
  renderHome();
}

/** Record a partly played day (history + submission) without showing the results screen. */
function finishDaySilently(g: GameState) {
  g.phase = 'done';
  g.submitted = true;
  store.save('history', [...history().filter((h) => h.date !== g.date), { date: g.date, score: totalScore(g), rounds: g.rounds.map((r) => r.score) }]);
  enqueueSubmission({
    playerId: store.playerId(),
    date: g.date,
    rounds: g.rounds.filter((r) => r.entries.length).map((r) => ({ promptId: r.promptId, answers: r.entries.map((e) => e.text) })),
  });
  saveGame(g);
  void flushQueue();
}

// --- boot ------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const action = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'help') showHelp();
  else if (action === 'stats') showStats();
  else if (action === 'home') {
    // Leaving mid-round pauses the clock; time left is saved.
    if (game?.phase === 'playing') persist();
    renderHome();
  }
});

$dialog.addEventListener('click', (ev) => {
  if (ev.target === $dialog) $dialog.close(); // click on backdrop
});

window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
  else checkDay();
});
window.addEventListener('online', () => void flushQueue().then(() => updatePendingNote()));
window.setInterval(() => {
  checkDay();
  if (pendingSubmissions()) void flushQueue().then(() => updatePendingNote());
}, 30_000);

pruneOldGames(today);
void flushQueue();
if (game?.phase === 'done') renderEnd();
else renderHome();
