import { addDays } from './daily';

export interface DayRecord {
  date: string;
  score: number;
  rounds: number[];
}

export interface Stats {
  daysPlayed: number;
  best: number;
  streak: number;
}

/** Streak = consecutive dates ending today, or yesterday if today isn't played yet. */
export function computeStats(history: DayRecord[], today: string): Stats {
  const dates = new Set(history.map((h) => h.date));
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return {
    daysPlayed: dates.size,
    best: history.reduce((m, h) => Math.max(m, h.score), 0),
    streak,
  };
}
