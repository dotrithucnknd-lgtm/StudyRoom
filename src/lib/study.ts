import type { Progress } from './types';
export type Rating = 'again' | 'hard' | 'good' | 'easy';
export function scheduleReview(previous: Progress | undefined, rating: Rating, now = new Date()): Progress {
  const old = previous ?? { card_id: '', user_id: '', state: 'new', ease: 2.5, interval_days: 0, repetitions: 0, lapses: 0, correct_count: 0, wrong_count: 0, last_reviewed_at: null, due_at: now.toISOString() };
  const ease = Math.max(1.3, old.ease + ({ again: -0.2, hard: -0.15, good: 0, easy: 0.15 })[rating]);
  const interval_days = rating === 'again' ? 0.007 : rating === 'hard' ? Math.max(0.5, old.interval_days * 1.2) : rating === 'good' ? (old.repetitions === 0 ? 1 : old.repetitions === 1 ? 3 : Math.max(1, old.interval_days * ease)) : (old.repetitions === 0 ? 3 : Math.max(4, old.interval_days * ease * 1.3));
  const repetitions = rating === 'again' ? 0 : old.repetitions + 1;
  const state = rating === 'again' ? 'relearning' : repetitions >= 5 && interval_days >= 21 ? 'mastered' : interval_days >= 1 ? 'review' : 'learning';
  return { ...old, state, ease, interval_days, repetitions, lapses: old.lapses + Number(rating === 'again'), correct_count: old.correct_count + Number(rating !== 'again'), wrong_count: old.wrong_count + Number(rating === 'again'), last_reviewed_at: now.toISOString(), due_at: new Date(now.getTime() + interval_days * 86400000).toISOString() };
}
export function normalizeAnswer(value: string) { return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim(); }
export function shuffle<T>(items: T[]): T[] { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }
