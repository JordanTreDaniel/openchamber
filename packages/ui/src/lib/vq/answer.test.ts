import { expect, test } from 'bun:test';
import type { Answer } from 'vq-react';
import { buildVqAnswerPayload, summarizeVqAnswer } from './answer';
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
