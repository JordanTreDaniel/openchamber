/**
 * The voice session protocol: event names, our tolerances, and the text
 * shaping every append goes through before it leaves the browser.
 *
 * Pure on purpose. Everything here is a value or a function of its arguments,
 * so the client and the panel stay free of protocol trivia and the shaping
 * rules can be tested without a peer connection. The behaviour these numbers
 * buy is described in `DOCUMENTATION.md` beside this file.
 *
 * Inbound frames are decoded here, at the boundary: `parseInboundEvent` runs
 * a schema over the raw frame, so nothing downstream narrows a value it has
 * not parsed.
 */

import { z } from 'zod';

/** Must equal `gpt-live` or start with `gpt-live-`. */
export const VOICE_MODEL = 'gpt-live-1';

/**
 * The data channel name is fixed by the protocol. Anything else is ignored,
 * which looks exactly like a connection that opens and then never speaks.
 */
export const DATA_CHANNEL = 'oai-events';

/**
 * The mint route, reached through OpenChamber's own `/api` proxy: the proxy
 * adds this instance's OpenCode credential, so the browser never holds one.
 */
export const VOICE_SESSION_ENDPOINT = '/api/experimental/voice/session';

/** Default output voice. */
export const DEFAULT_VOICE = 'marin';

/** Events the voice model sends us. */
export const INBOUND = {
  /** Carries `expires_at`; the session is live from here. */
  STARTED: 'session.started',
  /** Carries `reason`; any string ends the session — see `CloseReason`. */
  CLOSED: 'session.closed',
  /** Carries a delegation id and NO task text — the task is reconstructed. */
  DELEGATION_CREATED: 'session.delegation.created',
  /** Deltas only. There is no final transcript event. */
  INPUT_TRANSCRIPT: 'session.input_transcript.delta',
  OUTPUT_TRANSCRIPT: 'session.output_transcript.delta',
  /** Arrives for a rejected append too; dropping it loses the only clue. */
  ERROR: 'error',
} as const;

/** Verbs we send back. `content` is a plain string; `delegation_id` is required. */
export const OUTBOUND = {
  /** Silent context. Sent immediately, and it does NOT mute the spoken ack. */
  THINKING: 'session.thinking.append',
  /** Spoken and paraphrased by the model. The only path to the user's ear. */
  COMMENTARY: 'session.commentary.append',
  /** The only verb that interrupts speech. A scalpel, not a progress channel. */
  INSTRUCTIONS: 'session.instructions.append',
} as const;

export type OutboundType = (typeof OUTBOUND)[keyof typeof OUTBOUND];

/**
 * Why a session ended, as the protocol documents it. The wire may carry a
 * reason this list does not know yet, so the parser accepts any string: an
 * unrecognised reason must still end the session rather than dropping the
 * event that says so.
 */
type CloseReason = 'close_requested' | 'expired' | 'content' | 'remote_hangup' | 'connection_lost';

/** The reason assumed when the far side closes without naming one. */
export const DEFAULT_CLOSE_REASON: CloseReason = 'close_requested';

/**
 * Hard protocol limits and our own pacing.
 *
 * `APPEND_BYTES` exists because the protocol's cap is *tokens*, and a
 * character count is a lie for anything outside ASCII: one CJK character is
 * three UTF-8 bytes and often more than one token. Clamping on both counts
 * keeps the same text under the cap in every language.
 */
export const LIMITS = {
  /** Protocol maximum per append. */
  APPEND_TOKENS: 500,
  /** Character ceiling for ASCII text. */
  APPEND_CHARS: 1400,
  /** Byte ceiling — the binding one for non-ASCII text. */
  APPEND_BYTES: 1400,
  /** Commentary chunk size, byte aware. */
  CHUNK_BYTES: 400,
  /** Minimum gap between two appends, so an answer never bursts. */
  APPEND_GAP_MS: 120,
  /** Silent progress ping. */
  THINKING_EVERY_MS: 4000,
  /** Spoken progress is expensive attention; this is the floor. */
  COMMENTARY_EVERY_MS: 10000,
  /** One short fragment, not a status report. */
  PROGRESS_MAX_CHARS: 110,
  /** Input-transcript gap that starts a new speaker turn. */
  TURN_GAP_MS: 700,
  /** Progress fragments only — never applied to a final answer. */
  MIN_SPOKEN_CHARS: 12,
  /** Keep a non-trickle SDP offer from leaving before its candidates. */
  ICE_TIMEOUT_MS: 4000,
  /** Two delegations carrying the same task inside this window are one ask. */
  DUPLICATE_WINDOW_MS: 15000,
  /** Fallback turn end when this prompt's own execution events never arrive. */
  QUIESCENCE_MS: 8000,
  /** Transcript rows kept in the panel. */
  MAX_TRANSCRIPT_ENTRIES: 200,
} as const;

/**
 * What the voice model believes it is. Kept short: it is forwarded to the
 * audio model on every mint, and every line competes for its attention.
 */
export const DEFAULT_INSTRUCTIONS = [
  'You are the voice of a coding agent working in OpenChamber.',
  'Speak briefly and conversationally, one or two sentences at a time.',
  'When someone asks for work, delegate it rather than guessing at the answer.',
  'Never read out file paths, code, identifiers or long numbers; summarise them instead.',
  'While work is running, narrate progress in short fragments.',
  'Never invent results. If you do not know, say so.',
].join(' ');

// ---------------------------------------------------------------------------
// Inbound events
// ---------------------------------------------------------------------------

// The event payloads as the protocol sends them. Each has a schema below, and
// `parseInboundEvent` decodes against those schemas: these types describe what
// has already been checked, never what an assertion claimed.

type DelegationCreatedEvent = {
  type: typeof INBOUND.DELEGATION_CREATED;
  offset_ms?: number;
  delegation?: { id?: string; type?: string };
};

type TranscriptDeltaEvent = {
  type: typeof INBOUND.INPUT_TRANSCRIPT | typeof INBOUND.OUTPUT_TRANSCRIPT;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
};

type SessionStartedEvent = {
  type: typeof INBOUND.STARTED;
  expires_at?: number;
};

type SessionClosedEvent = {
  type: typeof INBOUND.CLOSED;
  /** Any string, not only `CloseReason`: see the schema below. */
  reason?: string;
};

type ProtocolErrorEvent = {
  type: typeof INBOUND.ERROR;
  error?: { code?: string; message?: string; param?: string };
};

type VoiceInboundEvent =
  | DelegationCreatedEvent
  | TranscriptDeltaEvent
  | SessionStartedEvent
  | SessionClosedEvent
  | ProtocolErrorEvent;

const sessionStartedEventSchema = z.object({
  type: z.literal(INBOUND.STARTED),
  expires_at: z.number().optional(),
});

/**
 * `reason` is a plain string on purpose. The protocol is additive, so a
 * reason this client has never heard of must still end the session — enum
 * validation here would swallow `session.closed` and leave the microphone
 * open on a session the far side has already closed.
 */
const sessionClosedEventSchema = z.object({
  type: z.literal(INBOUND.CLOSED),
  reason: z.string().optional(),
});

const delegationCreatedEventSchema = z.object({
  type: z.literal(INBOUND.DELEGATION_CREATED),
  offset_ms: z.number().optional(),
  delegation: z.object({ id: z.string().optional(), type: z.string().optional() }).optional(),
});

const transcriptDeltaEventSchema = z.object({
  type: z.union([z.literal(INBOUND.INPUT_TRANSCRIPT), z.literal(INBOUND.OUTPUT_TRANSCRIPT)]),
  delta: z.string().optional(),
  start_ms: z.number().optional(),
  end_ms: z.number().optional(),
});

const protocolErrorEventSchema = z.object({
  type: z.literal(INBOUND.ERROR),
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    param: z.string().optional(),
  }).optional(),
});

/**
 * Every frame this client acts on. A frame of any other shape — an unknown
 * type, a wrong field, a value of the wrong kind — fails the union and is
 * dropped, which is what makes the protocol additive without being unsafe.
 */
const inboundEventSchema: z.ZodType<VoiceInboundEvent> = z.union([
  sessionStartedEventSchema,
  sessionClosedEventSchema,
  delegationCreatedEventSchema,
  transcriptDeltaEventSchema,
  protocolErrorEventSchema,
]);

/**
 * A frame as `RTCDataChannel.onmessage` hands it over. The channel carries
 * text, so the protocol arrives as a string; a null frame carries no data and
 * a binary frame is not the protocol. The parser drops everything it cannot
 * decode, whatever the transport delivered.
 */
export type InboundFrame = string | ArrayBuffer | Blob | null;

/**
 * Parse one data-channel frame. A frame we cannot read, or one of a type this
 * client does not act on, is `null`: the protocol is additive, and an unknown
 * type is not a failure. The schema is the only thing that decides what the
 * rest of the client is allowed to see.
 */
export const parseInboundEvent = (frame: InboundFrame): VoiceInboundEvent | null => {
  const text = z.string().safeParse(frame);
  if (!text.success) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.data);
  } catch {
    return null;
  }
  const event = inboundEventSchema.safeParse(decoded);
  return event.success ? event.data : null;
};

/** One line for the panel, from an `error` event or a failed mint. */
export const describeProtocolError = (event: ProtocolErrorEvent): string => {
  const code = event.error?.code?.trim();
  const message = event.error?.message?.trim();
  const param = event.error?.param?.trim();
  if (message && param) return `${message} (${param})`;
  if (message) return message;
  if (code) return `The voice session reported ${code}.`;
  return 'The voice session reported an error.';
};

export type AppendPayload = {
  type: OutboundType;
  delegation_id: string;
  content: string;
};

export const encodeAppend = (payload: AppendPayload): string => JSON.stringify(payload);

// ---------------------------------------------------------------------------
// Text shaping
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

const byteLength = (text: string): number => encoder.encode(text).length;

/**
 * Byte-aware chunker: never splits a multi-byte character, and always makes
 * progress even when a single character exceeds the budget.
 */
export const chunkByBytes = (text: string, maxBytes: number): string[] => {
  const chunks: string[] = [];
  let current = '';
  let size = 0;
  for (const char of text) {
    const bytes = byteLength(char);
    if (size + bytes > maxBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
};

/**
 * Trim to the append budget on both counts. A truncated append ends in an
 * ellipsis so the model reads a break, not a sentence that stops mid-word.
 */
export const clampForAppend = (text: string): string => {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';
  let chars = 0;
  let bytes = 0;
  let clamped = '';
  for (const char of trimmed) {
    const charBytes = byteLength(char);
    if (chars + 1 > LIMITS.APPEND_CHARS || bytes + charBytes > LIMITS.APPEND_BYTES) {
      return `${clamped.trimEnd()}…`;
    }
    clamped += char;
    chars += 1;
    bytes += charBytes;
  }
  return trimmed;
};

/** The last `maxChars` characters, trimmed — a tail, never a head. */
export const tailForAppend = (text: string, maxChars: number): string => {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(trimmed.length - maxChars);
};

/**
 * Strip the shapes that make a model read something out verbatim: code
 * fences, inline ticks, markdown emphasis, heading marks, list bullets and
 * path-shaped links. The voice model paraphrases what it hears, so cleaner
 * input is what keeps a fenced block from being read out character by
 * character.
 */
export const flattenForSpeech = (text: string): string => String(text ?? '')
  .replace(/```[a-zA-Z0-9]*\n?/g, ' ')
  .replace(/`+/g, '')
  .replace(/\*\*|__/g, '')
  .replace(/^\s*[-*+]\s+/gm, '')
  .replace(/^\s*#{1,6}\s+/gm, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // A markdown table is the shape a model reads out worst: the separator row
  // becomes "dash dash dash", and the cell pipes break every phrase.
  .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, ' ')
  .replace(/\s*\|\s*/g, ', ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * First sentence, shortened — a spoken progress fragment, not a read-out.
 * `MIN_SPOKEN_CHARS` is deliberately absent: it filters fragments at the call
 * site, never the final answer, where "main" or "4" is a real answer.
 */
export const progressFragment = (text: string): string => {
  const flat = flattenForSpeech(text);
  if (!flat) return '';
  const firstStop = flat.search(/[.!?]\s/);
  let fragment = firstStop > 20 ? flat.slice(0, firstStop + 1) : flat;
  if (fragment.length > LIMITS.PROGRESS_MAX_CHARS) {
    fragment = `${fragment.slice(0, LIMITS.PROGRESS_MAX_CHARS).replace(/[,;:\s]+\S*$/, '')}…`;
  }
  return fragment;
};

// ---------------------------------------------------------------------------
// Speaker turns and the delegated task
// ---------------------------------------------------------------------------

export type InputTurn = {
  text: string;
  startMs?: number;
  endMs?: number;
};

/**
 * Fold one input-transcript delta into the turn list. The protocol sends no
 * turn boundaries, so a gap in the timestamps starts a new one.
 */
export const appendInputTurn = (
  turns: readonly InputTurn[],
  delta: string,
  startMs?: number,
  endMs?: number,
): InputTurn[] => {
  if (!delta) return [...turns];
  const current = turns[turns.length - 1];
  // Without timestamps on both sides there is no evidence of a gap, so the
  // delta continues the turn we are in rather than starting one per fragment.
  const gap = current && startMs !== undefined && current.endMs !== undefined
    ? startMs - current.endMs
    : current
      ? 0
      : Number.POSITIVE_INFINITY;
  if (!current || gap > LIMITS.TURN_GAP_MS) {
    return [...turns, { text: delta, startMs, endMs }];
  }
  const merged: InputTurn = { ...current, text: current.text + delta };
  if (endMs !== undefined) merged.endMs = endMs;
  return [...turns.slice(0, -1), merged];
};

/** The last turn long enough to be an instruction rather than a noise word. */
const lastSubstantialTurn = (turns: readonly InputTurn[]): string => {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = turns[index]?.text.trim() ?? '';
    if (text.length >= 3) return text;
  }
  return '';
};

/** What a delegation's task is, and where the transcript was read up to. */
type ReconstructedTask = { task: string; nextCursor: number };

/**
 * The task for a delegation, rebuilt from what has been heard since the last
 * one. The event carries no task text, so this is the only source.
 */
export const reconstructTask = (
  turns: readonly InputTurn[],
  delegatedUpTo: number,
): ReconstructedTask => {
  const pending = turns.slice(delegatedUpTo);
  const task = pending.map((turn) => turn.text.trim()).filter(Boolean).join(' ').trim();
  return {
    task: task || lastSubstantialTurn(turns.slice(0, delegatedUpTo)),
    nextCursor: turns.length,
  };
};

/**
 * Case and punctuation free, so "What time is it?" and "what time is it"
 * compare equal. Used for duplicate detection only — never for prompting.
 */
export const normalizeTaskKey = (text: string): string => String(text ?? '')
  .toLowerCase()
  .replace(/[\p{P}\p{S}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Whether a reconstructed task is worth sending to the agent at all. A
 * delegation with nothing behind it (silence, a breath, a bare "um") must
 * prompt nothing: an empty prompt re-runs the previous request, which is how
 * the reference implementation drove the same job twice.
 */
export const isPromptableTask = (text: string): boolean => /\p{L}|\p{N}/u.test(String(text ?? ''));
