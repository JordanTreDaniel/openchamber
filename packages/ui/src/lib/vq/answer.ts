import type { Answer } from 'vq-react';
import type { UiBlockReplyAnswerData } from '@/components/chat/uiBlocks/answer';

/**
 * What a `vq` fence's answer sends: the pick names the question, `values`
 * carries the whole envelope. Pure, so the channel's shape is checked without
 * a render.
 */

const MAX_NOTE = 120;
const NOTE_IDS = 3;

const listSummary = (value: unknown, label: string, empty: string): string => {
  if (!Array.isArray(value) || value.length === 0) return empty;
  const head = value.slice(0, NOTE_IDS).map((id) => String(id)).join(', ');
  const rest = value.length > NOTE_IDS ? ` +${value.length - NOTE_IDS} more` : '';
  return `${value.length} ${label}: ${head}${rest}`;
};

const assignSummary = (value: unknown): string => {
  if (!value || typeof value !== 'object') return 'nothing assigned';
  const counts = new Map<string, number>();
  let total = 0;
  for (const targets of Object.values(value as Record<string, unknown>)) {
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      const key = String(target);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
  }
  if (total === 0) return 'nothing assigned';
  const parts = [...counts].map(([target, count]) => `${count} ${target}`);
  return `${total} ${total === 1 ? 'item' : 'items'}: ${parts.join(', ')}`;
};

const duelSummary = (value: unknown): string => {
  const winner = value && typeof value === 'object' ? (value as { winner?: unknown }).winner : undefined;
  const ranking = value && typeof value === 'object' ? (value as { ranking?: unknown }).ranking : undefined;
  const place = Array.isArray(ranking) && ranking.length > 0 ? ` of ${ranking.length}` : '';
  return winner ? `winner ${String(winner)}${place}` : 'no winner';
};

const tableSummary = (value: unknown): string => {
  if (!value || typeof value !== 'object') return 'table answered';
  const read = (key: string): number => {
    const entries = (value as Record<string, unknown>)[key];
    return entries && typeof entries === 'object' ? Object.keys(entries).length : 0;
  };
  const verdicts = read('verdicts');
  const edits = read('edits');
  const parts = [verdicts ? `${verdicts} verdicts` : '', edits ? `${edits} edits` : ''].filter(Boolean);
  return parts.length ? `table: ${parts.join(', ')}` : 'table answered';
};

const mapSummary = (value: unknown): string => {
  const points = value && typeof value === 'object' ? (value as { points?: unknown }).points : undefined;
  const count = Array.isArray(points) ? points.length : 0;
  return count ? `map: ${count} ${count === 1 ? 'point' : 'points'}` : 'map answered';
};

const summaryFor = (answer: Answer): string => {
  switch (answer.type) {
    case 'assign':
      return assignSummary(answer.value);
    case 'pick':
      return listSummary(answer.value, 'picks', 'nothing picked');
    case 'rank':
      return listSummary(answer.value, 'ranked', 'nothing ranked');
    case 'duel':
      return duelSummary(answer.value);
    case 'table':
      return tableSummary(answer.value);
    case 'map':
      return mapSummary(answer.value);
    default:
      return answer.label || 'answered';
  }
};

/** One line for the user's note and the agent's turn: never the whole envelope. */
export function summarizeVqAnswer(answer: Answer): string {
  const full = answer.skipped ? 'skipped' : summaryFor(answer);
  return full.length > MAX_NOTE ? `${full.slice(0, MAX_NOTE - 1)}…` : full;
}

/** The input text that starts the agent's next turn; the envelope rides in `values`. */
export function vqAnswerText(specId: string, answer: Answer): string {
  const summary = summarizeVqAnswer(answer);
  return summary && summary !== answer.label ? `VQ ${specId}: ${answer.label} (${summary})` : `VQ ${specId}: ${answer.label}`;
}

export function buildVqAnswerPayload(specId: string, answer: Answer): UiBlockReplyAnswerData {
  return {
    picks: [{ value: specId, button: answer.label, note: summarizeVqAnswer(answer) }],
    // A block's values are strings only, so the structured answer rides as JSON.
    values: { [specId]: JSON.stringify(answer) },
    skipped: [],
  };
}
