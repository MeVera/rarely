import { GAME_NAME } from '../config';
import type { GameState } from './game';

/** One square per round, by the rarest tier found (none, 1..5). */
export const SHARE_SQUARES = ['⬜', '🟨', '🟧', '🟩', '🟦', '🟪'];

export function formatDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function shareText(g: GameState, url: string): string {
  const total = g.rounds.reduce((n, r) => n + r.score, 0);
  const found = g.rounds.reduce((n, r) => n + r.entries.filter((e) => e.answer).length, 0);
  const squares = g.rounds.map((r) => {
    const best = Math.max(0, ...r.entries.map((e) => e.tier ?? 0));
    return SHARE_SQUARES[best];
  });
  const rows: string[] = [];
  for (let i = 0; i < squares.length; i += 5) rows.push(squares.slice(i, i + 5).join(''));
  const rarest = g.rounds.reduce((n, r) => n + r.entries.filter((e) => e.tier === 5).length, 0);
  return [
    `${GAME_NAME} · ${formatDate(g.date)}`,
    `${total.toLocaleString('en-AU')} pts · ${found} answers${rarest ? ` · ${rarest} rarest` : ''}`,
    ...rows,
    url,
  ].join('\n');
}
