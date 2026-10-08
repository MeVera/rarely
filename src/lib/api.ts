// Talking to the Worker: tiers.json and the submission queue.
import type { TiersFile } from './bank';
import { load, save } from './storage';

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export interface Submission {
  playerId: string;
  date: string;
  rounds: { promptId: string; answers: string[] }[];
}

export async function fetchTiers(timeoutMs = 6000): Promise<TiersFile | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/tiers.json`, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) return null;
    const data = (await res.json()) as TiersFile;
    return data && typeof data.prompts === 'object' ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const QUEUE_KEY = 'submitQueue';

export function enqueueSubmission(sub: Submission): void {
  const queue = load<Submission[]>(QUEUE_KEY, []).filter((q) => q.date !== sub.date);
  queue.push(sub);
  save(QUEUE_KEY, queue);
}

export function pendingSubmissions(): number {
  return load<Submission[]>(QUEUE_KEY, []).length;
}

let flushing = false;

/** Send queued submissions. Keeps them on network errors, 429 and 5xx. */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const sub of load<Submission[]>(QUEUE_KEY, [])) {
      let done = false;
      try {
        const res = await fetch(`${API_BASE}/submit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sub),
        });
        // 2xx accepted; 409 already recorded; other 4xx will never succeed.
        done = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408);
      } catch {
        done = false;
      }
      if (done) save(QUEUE_KEY, load<Submission[]>(QUEUE_KEY, []).filter((q) => q.date !== sub.date));
      else break;
    }
  } finally {
    flushing = false;
  }
}
