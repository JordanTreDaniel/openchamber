/**
 * The Live Voice panel's state.
 *
 * Deliberately dumb: it holds what the panel draws and nothing else. The peer
 * connection, the delegation queue and the append pacing live in
 * `live-voice-client.ts`, which writes here through plain setters. One
 * consequence worth knowing before adding anything: this store must never
 * hold a credential or a peer connection, so it stays safe to serialise.
 */

import { create } from 'zustand';

import { LIMITS } from './realtime-protocol';

export type LiveVoiceStatus =
  /** Nothing running; Start is available. */
  | 'idle'
  /** Microphone granted, offer on its way to the mint endpoint. */
  | 'connecting'
  /** Connected and hearing; the only state where a wake word would be live. */
  | 'listening'
  /** A delegation arrived and its prompt is being posted. */
  | 'delegating'
  /** The agent is working a job we started. */
  | 'working'
  /** The session ended on the far side (expiry, hangup, content). */
  | 'ended'
  /** Something failed; the message is in `error`. */
  | 'error';

/** Who said it: the user's microphone, the voice model, the agent, or us. */
export type TranscriptKind = 'you' | 'voice' | 'agent' | 'spoken' | 'marker' | 'error';

export type TranscriptEntry = {
  id: string;
  kind: TranscriptKind;
  text: string;
  at: number;
};

/** A question the agent is blocked on, until someone answers it in the chat. */
type PendingQuestion = {
  sessionId: string;
  formId: string;
  title: string;
  at: number;
};

/** The OpenCode session this panel is talking through. */
export type VoiceBinding = {
  sessionId: string;
  directory: string;
  title: string | null;
};

type LiveVoiceState = {
  status: LiveVoiceStatus;
  /** True from Start until teardown, including `error`, so the panel knows to offer Reconnect. */
  running: boolean;
  binding: VoiceBinding | null;
  /** Agent the delegation prompts run as. */
  agentName: string | null;
  voice: string;
  /** When the minted session expires, as the protocol reported it. */
  expiresAt: number | null;
  error: string | null;
  transcript: TranscriptEntry[];
  pendingQuestion: PendingQuestion | null;
  /** The task last handed to the agent, for the panel's own record. */
  lastTask: string | null;

  setStatus: (status: LiveVoiceStatus) => void;
  setRunning: (running: boolean) => void;
  setBinding: (binding: VoiceBinding | null) => void;
  setAgentName: (agentName: string | null) => void;
  setVoice: (voice: string) => void;
  setExpiresAt: (expiresAt: number | null) => void;
  setError: (error: string | null) => void;
  setPendingQuestion: (question: PendingQuestion | null) => void;
  setLastTask: (task: string | null) => void;

  /** Add a row. Returns its id so a stream of deltas can extend it. */
  appendTranscript: (kind: TranscriptKind, text: string) => string;
  /** Extend an existing row in place; a no-op if the row is gone. */
  extendTranscript: (id: string, text: string) => void;
  clearTranscript: () => void;
  /** Clear everything a session owns, keeping the user's picks. */
  resetSession: () => void;
};

let entrySeq = 0;

const nextEntryId = (): string => {
  entrySeq += 1;
  return `lv-${Date.now().toString(36)}-${entrySeq}`;
};

/**
 * What `resetSession` restores: everything a session owns, and nothing the
 * user picked. Typing the literal here is what lets the reset values be plain
 * values — `status: 'idle'`, not `status: 'idle' as LiveVoiceStatus`.
 */
type SessionResetState = Pick<
  LiveVoiceState,
  'status' | 'running' | 'expiresAt' | 'error' | 'transcript' | 'pendingQuestion' | 'lastTask'
>;

const initialSessionState: SessionResetState = {
  status: 'idle',
  running: false,
  expiresAt: null,
  error: null,
  transcript: [],
  pendingQuestion: null,
  lastTask: null,
};

export const useLiveVoiceStore = create<LiveVoiceState>()((set) => ({
  ...initialSessionState,
  binding: null,
  agentName: null,
  voice: 'marin',

  setStatus: (status) => set({ status }),
  setRunning: (running) => set({ running }),
  setBinding: (binding) => set({ binding }),
  setAgentName: (agentName) => set({ agentName }),
  setVoice: (voice) => set({ voice }),
  setExpiresAt: (expiresAt) => set({ expiresAt }),
  setError: (error) => set({ error }),
  setPendingQuestion: (question) => set({ pendingQuestion: question }),
  setLastTask: (lastTask) => set({ lastTask }),

  appendTranscript: (kind, text) => {
    const id = nextEntryId();
    set((state) => {
      const next = [...state.transcript, { id, kind, text, at: Date.now() }];
      return {
        transcript: next.length > LIMITS.MAX_TRANSCRIPT_ENTRIES
          ? next.slice(next.length - LIMITS.MAX_TRANSCRIPT_ENTRIES)
          : next,
      };
    });
    return id;
  },

  extendTranscript: (id, text) => {
    if (!text) return;
    set((state) => {
      let found = false;
      const transcript = state.transcript.map((entry) => {
        if (entry.id !== id) return entry;
        found = true;
        return { ...entry, text: entry.text + text };
      });
      return found ? { transcript } : state;
    });
  },

  clearTranscript: () => set({ transcript: [] }),

  resetSession: () => set({ ...initialSessionState }),
}));
