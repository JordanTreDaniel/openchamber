import { describe, expect, test } from 'bun:test';

import {
  LIMITS,
  appendInputTurn,
  clampForAppend,
  chunkByBytes,
  describeProtocolError,
  flattenForSpeech,
  isPromptableTask,
  normalizeTaskKey,
  parseInboundEvent,
  progressFragment,
  reconstructTask,
  tailForAppend,
  type InputTurn,
} from './realtime-protocol';

describe('parseInboundEvent', () => {
  test('keeps known events and drops anything unreadable or unknown', () => {
    expect(parseInboundEvent('{"type":"session.started","expires_at":1}')).toEqual({ type: 'session.started', expires_at: 1 });
    expect(parseInboundEvent('{"type":"session.delegation.created","delegation":{"id":"item_Ej63QT"}}')).toEqual({
      type: 'session.delegation.created',
      delegation: { id: 'item_Ej63QT' },
    });
    // The protocol is additive: a type we do not act on is not a failure.
    expect(parseInboundEvent('{"type":"session.something.new"}')).toBeNull();
    expect(parseInboundEvent('not json')).toBeNull();
    expect(parseInboundEvent('')).toBeNull();
    expect(parseInboundEvent(null)).toBeNull();
  });
});

describe('describeProtocolError', () => {
  test('names the parameter that was refused', () => {
    expect(describeProtocolError({
      type: 'error',
      error: { code: 'invalid_value', message: 'Context append text must not exceed 500 tokens.', param: 'content' },
    })).toBe('Context append text must not exceed 500 tokens. (content)');
    expect(describeProtocolError({ type: 'error' })).toBe('The voice session reported an error.');
  });
});

describe('clampForAppend', () => {
  test('leaves short text alone', () => {
    expect(clampForAppend('  hello there  ')).toBe('hello there');
    expect(clampForAppend('')).toBe('');
  });

  test('clamps ASCII on the character budget', () => {
    const clamped = clampForAppend('a'.repeat(LIMITS.APPEND_CHARS + 200));
    expect(clamped.length).toBeLessThanOrEqual(LIMITS.APPEND_CHARS + 1);
    expect(clamped.endsWith('…')).toBe(true);
  });

  test('clamps non-ASCII on the byte budget, not the character count', () => {
    // One CJK character is three UTF-8 bytes: 1400 of them would be 4200 bytes,
    // well past the 500-token cap that 1400 characters is meant to approximate.
    const clamped = clampForAppend('漢'.repeat(1400));
    expect(new TextEncoder().encode(clamped).length).toBeLessThanOrEqual(LIMITS.APPEND_BYTES + 4);
    expect(clamped.length).toBeLessThan(600);
  });
});

describe('chunkByBytes', () => {
  test('never splits a multi-byte character', () => {
    const chunks = chunkByBytes('漢'.repeat(10), 7);
    expect(chunks.join('')).toBe('漢'.repeat(10));
    for (const chunk of chunks) expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(9);
  });

  test('always makes progress when one character exceeds the budget', () => {
    expect(chunkByBytes('漢', 1)).toEqual(['漢']);
  });
});

describe('flattenForSpeech', () => {
  test('strips the shapes a model would otherwise read out', () => {
    const spoken = flattenForSpeech([
      'Here is the answer:',
      '```ts',
      'const x = **1**;',
      '```',
      '- see [the docs](https://example.com/a/b)',
      '## Done',
    ].join('\n'));
    expect(spoken).not.toContain('`');
    expect(spoken).not.toContain('**');
    expect(spoken).not.toContain('##');
    expect(spoken).toContain('the docs');
    expect(spoken).not.toContain('example.com');
  });

  test('turns a table into something speakable', () => {
    const spoken = flattenForSpeech([
      '| Path | Entries |',
      '|---|---|',
      '| /tmp/a | 0 |',
    ].join('\n'));
    expect(spoken).not.toContain('|');
    expect(spoken).not.toContain('---');
    expect(spoken).toContain('Path, Entries');
  });
});

describe('progressFragment', () => {
  test('keeps one short fragment and never the whole report', () => {
    const fragment = progressFragment('Reading the whole manifest and every package it mentions. Then it will run the tests.');
    expect(fragment).toBe('Reading the whole manifest and every package it mentions.');
    expect(progressFragment('   ')).toBe('');
  });
});

describe('appendInputTurn', () => {
  test('splits turns on a timestamp gap and merges inside one', () => {
    let turns: InputTurn[] = [];
    turns = appendInputTurn(turns, 'what is', 0, 100);
    turns = appendInputTurn(turns, ' the branch', 100, 300);
    turns = appendInputTurn(turns, 'and the tests', 2000, 2400);
    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe('what is the branch');
    expect(turns[1].text).toBe('and the tests');
  });

  test('keeps deltas together when the protocol sends no timestamps', () => {
    let turns: InputTurn[] = [];
    turns = appendInputTurn(turns, 'check', undefined, undefined);
    turns = appendInputTurn(turns, ' the tests', undefined, undefined);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('check the tests');
  });
});

describe('reconstructTask', () => {
  test('joins only what was heard since the previous delegation', () => {
    let turns: InputTurn[] = [];
    turns = appendInputTurn(turns, 'first request', 0, 100);
    turns = appendInputTurn(turns, 'second request', 5000, 5100);
    const first = reconstructTask(turns, 0);
    expect(first.task).toBe('first request second request');
    expect(first.nextCursor).toBe(2);

    turns = appendInputTurn(turns, 'third', 9000, 9100);
    const next = reconstructTask(turns, first.nextCursor);
    expect(next.task).toBe('third');
  });

  test('falls back to the last real turn, never to nothing, when no new turn exists', () => {
    const turns: InputTurn[] = [{ text: 'run the tests', startMs: 0, endMs: 100 }];
    expect(reconstructTask(turns, 1).task).toBe('run the tests');
  });
});

describe('isPromptableTask', () => {
  test('refuses silence, whitespace and punctuation-only delegations', () => {
    expect(isPromptableTask('')).toBe(false);
    expect(isPromptableTask('   ')).toBe(false);
    expect(isPromptableTask('?')).toBe(false);
    expect(isPromptableTask('... uh ... ')).toBe(true);
    expect(isPromptableTask('run the tests')).toBe(true);
    expect(isPromptableTask('分支')).toBe(true);
  });
});

describe('normalizeTaskKey', () => {
  test('makes a spoken ask and its echo the same key', () => {
    expect(normalizeTaskKey('What time is it?')).toBe(normalizeTaskKey('what   time is it'));
    expect(normalizeTaskKey('???')).toBe('');
  });
});

describe('tailForAppend', () => {
  test('keeps the end of a growing message', () => {
    expect(tailForAppend('abcdef', 3)).toBe('def');
    expect(tailForAppend('  short  ', 100)).toBe('short');
  });
});
