import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnswer, scheduleReview } from './study.ts';

test('answer normalization preserves Unicode meaning while ignoring case and spacing', () => {
  assert.equal(normalizeAnswer('  TIẾNG   VIỆT! '), normalizeAnswer('tiếng việt'));
  assert.notEqual(normalizeAnswer('ありがとう'), normalizeAnswer('ありがと'));
});
test('again schedules a short relearning interval and records a lapse', () => {
  const first = scheduleReview(undefined, 'good', new Date('2026-01-01T00:00:00Z'));
  const missed = scheduleReview(first, 'again', new Date('2026-01-02T00:00:00Z'));
  assert.equal(missed.state, 'relearning');
  assert.equal(missed.repetitions, 0);
  assert.equal(missed.lapses, 1);
  assert.ok(new Date(missed.due_at).getTime() > new Date('2026-01-02T00:00:00Z').getTime());
});
test('easy review produces a longer interval than good review', () => {
  const good = scheduleReview(undefined, 'good', new Date('2026-01-01T00:00:00Z'));
  const easy = scheduleReview(undefined, 'easy', new Date('2026-01-01T00:00:00Z'));
  assert.ok(easy.interval_days > good.interval_days);
});
