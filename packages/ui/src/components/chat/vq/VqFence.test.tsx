import { afterAll, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * The fence's own side of an answer: what it hands the library to start from,
 * and whether a block that already answered can still be submitted. The
 * library draws through a Vite alias (`vq-react` -> `packages/vq/src`) that a
 * test process cannot resolve, so it stands in here and only the props are read.
 *
 * The restore parser itself is covered without a render (`lib/vq/answer.test.ts`).
 */

const browser = new Window({ url: 'http://localhost/' });
browser.document.write('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  localStorage: browser.localStorage, sessionStorage: browser.sessionStorage, HTMLElement: browser.HTMLElement,
  Element: browser.Element, Node: browser.Node, Text: browser.Text, SVGElement: browser.SVGElement,
  MutationObserver: browser.MutationObserver, DOMParser: browser.DOMParser, CustomEvent: browser.CustomEvent,
  ResizeObserver: browser.ResizeObserver, IntersectionObserver: browser.IntersectionObserver,
  requestAnimationFrame: browser.requestAnimationFrame, cancelAnimationFrame: browser.cancelAnimationFrame,
});
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

// Marks the initial value and a live button, so both are read from the DOM alone.
mock.module('vq-react', () => ({
  hostTheme: (map: Record<string, string>) => map,
  registerWriter: () => {},
  VQ: (props: { defaultValue?: unknown }) => React.createElement(
    'button',
    { type: 'button', 'data-default': props.defaultValue === undefined ? 'none' : JSON.stringify(props.defaultValue) },
    'Submit',
  ),
}));

const { VqFence } = await import('./VqFence');
const { buildVqAnswerPayload } = await import('@/lib/vq/answer');

// The app's stores reach for the running server; a test has none.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
afterAll(async () => {
  await act(() => root.unmount());
  browser.happyDOM.abort();
  globalThis.fetch = realFetch;
});

const SPEC = JSON.stringify({
  v: 1,
  id: 'calls-2026-11-11',
  type: 'assign',
  skin: 'deck',
  items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  targets: [{ id: 'keep', label: 'Keep' }, { id: 'drop', label: 'Drop' }],
});

const ANSWER = {
  v: 1,
  id: 'calls-2026-11-11',
  type: 'assign',
  value: { a: ['keep'], b: ['drop'] },
  label: '2 items: 1 keep, 1 drop',
  confidence: null,
  skipped: false,
  comments: [],
  text: null,
};

const record = (values: Record<string, string | string[]>) => ({ picks: [], values, skipped: [] });
// What the fence really wrote when it answered, through the real builder.
const sent = () => buildVqAnswerPayload('calls-2026-11-11', ANSWER);

const draw = async (answered: { picks: { button?: string }[]; values: Record<string, string | string[]>; skipped: string[] } | null) => {
  await act(() => root.render(<VqFence code={SPEC} target={null} answered={answered} />));
  // The library loads in an effect; one more pass settles the draw.
  await act(async () => {});
  const button = host.querySelector('button');
  if (!button) throw new Error(`expected the fence to draw, got: ${host.innerHTML}`);
  return { button, fieldset: button.closest('fieldset') };
};

test('an answered block starts the component from its stored value', async () => {
  // Given: the record of the send this fence made before the page reloaded.
  const { button, fieldset } = await draw(sent());

  expect(JSON.parse(button.getAttribute('data-default') as string)).toEqual(ANSWER.value);
  expect(fieldset?.disabled).toBe(true);
  expect(host.textContent).toContain('Answered · 2 items: 1 keep, 1 drop');
});

test('an unanswered block starts empty and can still submit', async () => {
  const { button, fieldset } = await draw(null);

  expect(button.getAttribute('data-default')).toBe('none');
  expect(fieldset?.disabled).toBe(false);
  expect(host.textContent).not.toContain('Answered');
});

test('a record that is not this fence answer leaves the deck open', async () => {
  // Given: another block's record, and a field list where the envelope would be.
  const { button, fieldset } = await draw(record({ other: JSON.stringify(ANSWER), 'calls-2026-11-11': ['a', 'b'] }));

  expect(button.getAttribute('data-default')).toBe('none');
  // The record says this block answered once, so it stays answered.
  expect(fieldset?.disabled).toBe(true);
  expect(host.textContent).not.toContain('Answered ·');
});
