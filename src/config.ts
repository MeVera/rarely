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
/** One answer per prompt; the first submission is final. */
export const MAX_ANSWERS_PER_ROUND = 1;
export const MAX_ANSWER_LENGTH = 60;
