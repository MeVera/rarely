// ---------------------------------------------------------------------------
// Day boundary. Change this one constant to move the daily reset elsewhere.
// ---------------------------------------------------------------------------
export const TIMEZONE = 'Australia/Melbourne';

export const GAME_NAME = 'Rarely';
export const ROUNDS_PER_DAY = 20;
export const ROUND_SECONDS = 30;
/** Day 0 for the prompt schedule. Changing it reshuffles every future day. */
export const SCHEDULE_EPOCH = '2026-01-01';
/** Limits shared by client and server. */
/** One correct answer per prompt; a correct answer ends the round. */
export const MAX_ANSWERS_PER_ROUND = 1;
/** Wrong guesses don't end the round, but are capped to keep submissions small. */
export const MAX_ATTEMPTS_PER_ROUND = 50;
export const MAX_ANSWER_LENGTH = 60;
