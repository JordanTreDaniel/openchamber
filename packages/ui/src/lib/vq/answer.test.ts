import { expect, test } from 'bun:test';
import type { Answer } from 'vq-react';
import { buildVqAnswerPayload, readVqAnswer, summarizeVqAnswer } from './answer';
import { uiBlockAnswerRecord } from '@/components/chat/uiBlocks/answer';

const answer = (overrides: Partial<Answer>): Answer => ({
  v: 1,
  id: 'calls-2026-11-11',
  type: 'assign',
  value: { a: ['keep'], b: ['keep'], c: ['drop'] },
  label: '2 kept, 1 dropped',
  confidence: null,
  skipped: false,
  comments: [],
  text: null,
  ...overrides,
}) as Answer;

test('assign summary counts per target', () => {
  expect(summarizeVqAnswer(answer({}))).toBe('3 items: 2 keep, 1 drop');
});

test('pick summary lists a few ids', () => {
  const summary = summarizeVqAnswer(answer({ type: 'pick', value: ['x', 'y', 'z', 'w', 'v'] }));
  expect(summary).toBe('5 picks: x, y, z +2 more');
});

test('rank, table, map, duel summaries', () => {
  expect(summarizeVqAnswer(answer({ type: 'rank', value: ['a', 'b'] }))).toBe('2 ranked: a, b');
  expect(summarizeVqAnswer(answer({ type: 'table', value: { verdicts: { r1: 'yes', r2: 'no' }, edits: { r1: { c: '1' } } } })))
    .toBe('table: 2 verdicts, 1 edits');
  expect(summarizeVqAnswer(answer({ type: 'map', value: { points: [{ lat: 1, lng: 2 }] } }))).toBe('map: 1 point');
  expect(summarizeVqAnswer(answer({ type: 'duel', value: { winner: 'b', ranking: ['b', 'a'] } }))).toBe('winner b of 2');
});

test('skipped wins over the value', () => {
  expect(summarizeVqAnswer(answer({ skipped: true }))).toBe('skipped');
});

test('a long summary is cut short', () => {
  const value = { a: Array.from({ length: 40 }, (_, index) => `target-with-a-long-name-${index}`) };
  expect(summarizeVqAnswer(answer({ value })).length).toBeLessThanOrEqual(120);
});

test('the payload passes the block answer schema', () => {
  const payload = buildVqAnswerPayload('calls-2026-11-11', answer({}));
  expect(uiBlockAnswerRecord.safeParse({ messageId: 'm1', block: 'k1', answer: payload }).success).toBe(true);
  expect(payload.picks[0]?.value).toBe('calls-2026-11-11');
  expect(payload.picks[0]?.button).toBe('2 kept, 1 dropped');
  expect(payload.skipped).toEqual([]);
  expect(JSON.parse(payload.values['calls-2026-11-11'] as string).type).toBe('assign');
});

test('a deck answer reads back as the answer that was sent', () => {
  const original = answer({ value: { a: ['keep'], b: ['keep'], c: ['drop'] } });
  const sent = buildVqAnswerPayload('calls-2026-11-11', original);
  const record = uiBlockAnswerRecord.safeParse({ messageId: 'm1', block: 'k1', answer: sent });
  if (!record.success) throw new Error('the payload must pass the block answer schema');

  // What the block gets after a reload is the record's own values, no other hop.
  expect(readVqAnswer(record.data.answer.values, 'calls-2026-11-11')).toEqual(original);
  // The restored value is what the component is initialised with, so the deck
  // shows its own progress instead of starting over.
  expect(readVqAnswer(record.data.answer.values, 'calls-2026-11-11')?.value).toEqual({ a: ['keep'], b: ['keep'], c: ['drop'] });
});

test('a value that is not this fence answer reads as nothing', () => {
  expect(readVqAnswer(undefined, 'calls')).toBeNull();
  // Another block in the same message: the key is not there.
  expect(readVqAnswer({ other: '{"v":1}' }, 'calls')).toBeNull();
  // A block field holds a list of strings; JSON is a string.
  expect(readVqAnswer({ calls: ['a', 'b'] }, 'calls')).toBeNull();
  expect(readVqAnswer({ calls: 'not json' }, 'calls')).toBeNull();
  expect(readVqAnswer({ calls: '' }, 'calls')).toBeNull();
  expect(readVqAnswer({ calls: '"a string"' }, 'calls')).toBeNull();
  expect(readVqAnswer({ calls: '[]' }, 'calls')).toBeNull();
  expect(readVqAnswer({ calls: 'null' }, 'calls')).toBeNull();
});
