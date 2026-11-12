/**
 * The live voice client — one module-level instance for the whole app.
 *
 * It is not effect-scoped and must not become so. A voice session costs money
 * per minute and owns the microphone; mounting it under a React effect means
 * a surface switch (or Strict Mode's double invoke) either mints two sessions
 * or drops the one the user is talking through. The panel's Start button is
 * the only entry point, and `teardown` is the only exit.
 *
 * The three responsibilities, in the order a conversation meets them:
 *
 *   1. transport  — mint the WebRTC session through `/api`, keep the
 *                   `oai-events` channel, and tear all of it down exactly once.
 *   2. delegation — turn an inbound delegation into one queued job: reconstruct
 *                   the task from what was heard, prompt the bound OpenCode
 *                   session, and follow the run to its real end.
 *   3. narration  — pace what goes back: silent `thinking` pings while the
 *                   agent works, one short spoken `commentary` fragment every
 *                   ten seconds, and the answer chunked at the end.
 *
 * What it never does: cancel work on barge-in, speak through a local voice,
 * or guess at an answer the agent did not give. `DOCUMENTATION.md` beside
 * this file records why each of those is a rule.
 */

import type { StoreApi } from 'zustand';
import { z } from 'zod';

import { flattenAssistantTextParts } from '@/lib/messages/messageText';
import type { DirectoryStore } from '@/sync/child-store';
import { subscribeDirectoryForm, subscribeDirectorySessionMessages } from '@/sync/child-store';
import { subscribeSessionStatusTransitions } from '@/sync/global-session-status';
import { getSyncChildStores } from '@/sync/sync-refs';
import { abortCurrentOperation, getSessionLastAssistantModel } from '@/sync/session-actions';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useConfigStore } from '@/stores/useConfigStore';
import { useContextStore } from '@/stores/contextStore';

import { useLiveVoiceStore, type VoiceBinding } from './live-voice-store';
import {
  DATA_CHANNEL,
  DEFAULT_CLOSE_REASON,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_VOICE,
  INBOUND,
  LIMITS,
  OUTBOUND,
  VOICE_MODEL,
  VOICE_SESSION_ENDPOINT,
  appendInputTurn,
  clampForAppend,
  chunkByBytes,
  describeProtocolError,
  encodeAppend,
  flattenForSpeech,
  isPromptableTask,
  normalizeTaskKey,
  parseInboundEvent,
  progressFragment,
  reconstructTask,
  tailForAppend,
  type AppendPayload,
  type InboundFrame,
  type InputTurn,
  type OutboundType,
} from './realtime-protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Job = {
  delegationId: string;
  seq: number;
  task: string;
  taskKey: string;
  sessionId: string;
  directory: string;
  /** Full text of this turn's assistant message, replaced as it grows. */
  buffer: string;
  /** Message ids that existed before the prompt — anything else is our answer. */
  baselineMessageIds: Set<string>;
  lastThinkingAt: number;
  lastCommentaryAt: number;
  lastSpokenText: string;
  /** Set once this job's own `execution.started` equivalent is observed. */
  sawStart: boolean;
  finished: boolean;
  /** True when a question interrupted it, so its partial text is not the answer. */
  interrupted: boolean;
  timers: ReturnType<typeof setTimeout>[];
  intervals: ReturnType<typeof setInterval>[];
  unsubscribers: Array<() => void>;
};

type AppendJob = AppendPayload;

/** One open transcript row per speaker, so deltas extend instead of stacking. */
type OpenLine = { id: string; endMs: number | null };

/** Both speaker rows: each is open (id and last timestamp) or closed. */
type OpenLines = { you: OpenLine | null; voice: OpenLine | null };

type TeardownOptions = {
  /** Shown in the panel and stops the run; omit for a user-requested stop. */
  error?: string;
  /** Protocol reason, when the far side closed the session. */
  reason?: string;
};

/**
 * What our own mint endpoint returns: an SDP answer under `data.transport` on
 * success, a message or error string on refusal. Parsed rather than asserted,
 * so a body of any other shape degrades to the HTTP status in the panel
 * instead of pretending to hold an answer.
 */
const mintResponseSchema = z.object({
  data: z.object({ transport: z.object({ sdp: z.string().optional() }).optional() }).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const HARD_JOB_TIMEOUT_MS = 5 * 60 * 1000;
/** How long a prompt response may take before the job is called a failure. */
const PROMPT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

class LiveVoiceClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;

  /** Guards double starts: Strict Mode, a double click, a reconnect race. */
  private running = false;

  private inputTurns: InputTurn[] = [];
  private delegatedUpTo = 0;

  private activeJob: Job | null = null;
  private queue: Job[] = [];
  private delegationSeq = 0;
  private recentTasks: Array<{ key: string; at: number }> = [];

  private outbound: AppendJob[] = [];
  private outboundTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSentKey = '';

  private openLines: OpenLines = { you: null, voice: null };
  private statusUnsubscribers: Array<() => void> = [];

  private readonly store = useLiveVoiceStore;

  // -- public surface -------------------------------------------------------

  isRunning(): boolean {
    return this.running;
  }

  /** Everything the panel and a headless check need to see, and nothing secret. */
  snapshot() {
    return {
      running: this.running,
      status: this.store.getState().status,
      transport: {
        pc: this.pc?.connectionState ?? null,
        dc: this.dc?.readyState ?? null,
      },
      micTracks: this.mic?.getTracks().map((track) => track.readyState) ?? [],
      activeJob: this.activeJob
        ? { id: this.activeJob.delegationId, task: this.activeJob.task, sawStart: this.activeJob.sawStart }
        : null,
      queued: this.queue.length,
      pendingOutbound: this.outbound.length,
    };
  }

  /** Bind the panel to an existing session. Refused while a session is live. */
  bind(binding: VoiceBinding | null): void {
    if (this.running) return;
    this.store.getState().setBinding(binding);
  }

  /**
   * Mint a voice session and start listening. Idempotent: a second call while
   * one is running is ignored, which is what keeps Strict Mode from billing
   * for two.
   */
  async start(): Promise<void> {
    if (this.running) return;

    const store = this.store.getState();
    const binding = store.binding;
    if (!binding) {
      store.setStatus('error');
      store.setError('No chat session is open. Open a session first — voice work runs in it.');
      store.appendTranscript('error', 'No chat session is bound.');
      return;
    }

    this.running = true;
    this.inputTurns = [];
    this.delegatedUpTo = 0;
    this.recentTasks = [];
    this.openLines = { you: null, voice: null };
    store.resetSession();
    store.setBinding(binding);
    store.setStatus('connecting');
    store.setRunning(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.mic = stream;

      const pc = new RTCPeerConnection();
      this.pc = pc;

      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        this.attachAudio(remoteStream);
      };

      // Three ways a transport dies. All of them land in the same idempotent
      // teardown, so the microphone can never outlive the connection and a
      // stale `running` flag can never swallow the next Start.
      pc.onconnectionstatechange = () => {
        if (pc !== this.pc) return;
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          this.teardown({ error: 'The voice connection dropped. Press Reconnect.' });
        }
      };
      pc.oniceconnectionstatechange = () => {
        if (pc !== this.pc) return;
        const state = pc.iceConnectionState;
        if (state === 'failed' || state === 'closed') {
          this.teardown({ error: 'The voice connection was lost. Press Reconnect.' });
        }
      };

      const dc = pc.createDataChannel(DATA_CHANNEL_NAME);
      this.dc = dc;
      dc.onopen = () => {
        if (this.store.getState().status === 'connecting') this.store.getState().setStatus('listening');
      };
      dc.onclose = () => {
        if (dc !== this.dc) return;
        this.teardown({ error: 'The voice event channel closed. Press Reconnect.' });
      };
      dc.onmessage = (event) => this.handleInbound(event.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc, LIMITS.ICE_TIMEOUT_MS);

      const sdp = pc.localDescription?.sdp ?? '';
      if (!sdp) {
        this.teardown({ error: 'The microphone offer could not be created.' });
        return;
      }

      const response = await fetch(VOICE_SESSION_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: VOICE_MODEL,
          transport: { type: 'webrtc', sdp },
          session: {
            instructions: DEFAULT_INSTRUCTIONS,
            audio: { output: { voice: this.store.getState().voice || DEFAULT_VOICE } },
            // Forced, never defaulted: without it the model answers work
            // itself instead of delegating, and nothing reaches the agent.
            delegation: { type: 'client' },
          },
        }),
      });

      const body: unknown = await response.json().catch(() => null);
      const parsed = mintResponseSchema.safeParse(body);
      const payload = parsed.success ? parsed.data : null;

      if (!response.ok) {
        const detail = payload?.message || payload?.error || `HTTP ${response.status}`;
        this.teardown({ error: `The voice session was refused: ${detail}` });
        return;
      }

      const answerSdp = payload?.data?.transport?.sdp;
      if (!answerSdp) {
        this.teardown({ error: 'The voice session returned no answer.' });
        return;
      }

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      this.store.getState().appendTranscript('marker', 'Voice session connected.');
      // Stay in `connecting` until the channel is genuinely open: until then
      // every append would be dropped silently, so claiming to listen is a lie.
      if (dc.readyState === 'open') this.store.getState().setStatus('listening');
    } catch (error) {
      const message = error instanceof Error && error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow it, then press Start again.'
        : `Could not start voice: ${error instanceof Error ? error.message : String(error)}`;
      this.teardown({ error: message });
    }
  }

  /** User-requested stop. Always available, always idempotent. */
  stop(): void {
    this.teardown({});
  }

  /** Stop and mint again — the Reconnect path after a dropped transport. */
  async reconnect(): Promise<void> {
    this.teardown({});
    this.store.getState().setStatus('idle');
    await this.start();
  }

  /**
   * Interrupt for a blocked agent: `instructions.append` is the only verb
   * that cuts speech, and the prompt is aborted so the agent is not left
   * holding a question nobody can answer.
   */
  interruptForQuestion(): void {
    const job = this.activeJob;
    const question = this.store.getState().pendingQuestion;
    if (job) {
      this.enqueue(OUTBOUND.INSTRUCTIONS, job.delegationId,
        'Stop. The agent is waiting on a question in the panel; tell the user, then wait.');
      job.interrupted = true;
      this.finishJob(job);
    }
    if (question) {
      void abortCurrentOperation(question.sessionId).catch(() => undefined);
    }
    this.store.getState().setPendingQuestion(null);
    this.store.getState().appendTranscript('marker', 'Interrupted: the agent is waiting on a question.');
    if (this.running) this.store.getState().setStatus('listening');
  }

  /** Clear the panel's transcript without touching the transport. */
  clearTranscript(): void {
    this.store.getState().clearTranscript();
    this.openLines = { you: null, voice: null };
  }

  // -- transport plumbing ---------------------------------------------------

  private attachAudio(stream: MediaStream): void {
    if (!this.audio) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.dataset.liveVoiceRemote = '';
      audio.className = 'sr-only';
      document.body.appendChild(audio);
      this.audio = audio;
    }
    this.audio.srcObject = stream;
    void this.audio.play().catch(() => {
      // Autoplay can require a gesture; pressing Start is one, so a rejection
      // here means the browser still refused. The panel's status pill says
      // connected, so nothing is silently lost — the user hears it after the
      // next click.
    });
  }

  /**
   * The single exit. Stops the microphone first (a live track outliving the
   * call is the defect this replaces), then the channel, the peer, the audio
   * element, the jobs and every watcher. Safe to call from any state, any
   * number of times, from inside any of those handlers.
   */
  private teardown(options: TeardownOptions): void {
    const wasRunning = this.running;
    this.running = false;

    this.finishAllJobs();

    if (this.outboundTimer) {
      clearTimeout(this.outboundTimer);
      this.outboundTimer = null;
    }
    this.outbound = [];
    this.lastSentKey = '';

    for (const unsubscribe of this.statusUnsubscribers) {
      try {
        unsubscribe();
      } catch {
        // A listener that already detached is not a failure.
      }
    }
    this.statusUnsubscribers = [];

    if (this.mic) {
      for (const track of this.mic.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore: the track is being discarded either way.
        }
      }
      this.mic = null;
    }

    if (this.dc) {
      const dc = this.dc;
      this.dc = null;
      dc.onopen = null;
      dc.onmessage = null;
      dc.onclose = null;
      try {
        dc.close();
      } catch {
        // Ignore.
      }
    }

    if (this.pc) {
      const pc = this.pc;
      this.pc = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.ontrack = null;
      try {
        pc.close();
      } catch {
        // Ignore.
      }
    }

    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio.remove();
      this.audio = null;
    }

    this.inputTurns = [];
    this.delegatedUpTo = 0;
    this.openLines = { you: null, voice: null };

    const store = this.store.getState();
    store.setRunning(false);
    store.setExpiresAt(null);
    store.setPendingQuestion(null);

    if (options.error) {
      store.setError(options.error);
      store.setStatus('error');
      store.appendTranscript('error', options.error);
      return;
    }
    store.setError(null);
    if (!wasRunning) return;
    if (options.reason) {
      store.setStatus('ended');
      store.appendTranscript('marker', `Voice session ended (${options.reason}).`);
      return;
    }
    store.setStatus('idle');
    store.appendTranscript('marker', 'Voice session stopped.');
  }

  // -- inbound --------------------------------------------------------------

  private handleInbound(frame: InboundFrame): void {
    const event = parseInboundEvent(frame);
    if (!event) return;
    const store = this.store.getState();

    switch (event.type) {
      case INBOUND.STARTED: {
        if (event.expires_at !== undefined) store.setExpiresAt(event.expires_at);
        if (this.dc?.readyState === 'open') store.setStatus('listening');
        store.appendTranscript('marker', 'Voice session live.');
        return;
      }

      case INBOUND.CLOSED: {
        const reason = event.reason ?? DEFAULT_CLOSE_REASON;
        // The far side owns the exit; teardown still owns the microphone.
        this.teardown({ reason });
        return;
      }

      case INBOUND.DELEGATION_CREATED: {
        this.handleDelegation(event.delegation?.id);
        return;
      }

      case INBOUND.INPUT_TRANSCRIPT: {
        const delta = event.delta ?? '';
        if (!delta) return;
        this.inputTurns = appendInputTurn(this.inputTurns, delta, event.start_ms, event.end_ms);
        this.appendTranscriptDelta('you', delta, event.end_ms);
        return;
      }

      case INBOUND.OUTPUT_TRANSCRIPT: {
        const delta = event.delta ?? '';
        if (!delta) return;
        this.appendTranscriptDelta('voice', delta, event.end_ms);
        return;
      }

      case INBOUND.ERROR: {
        // Never dropped: this is the only report that an append was rejected
        // (a 500-token overflow arrives exactly this way).
        const message = describeProtocolError(event);
        store.setError(message);
        store.appendTranscript('error', message);
        return;
      }

      default:
        return;
    }
  }

  /**
   * Transcript deltas carry no end-of-line marker, so a gap in timestamps
   * starts a new row. Same rule as speaker turns, different consumer.
   */
  private appendTranscriptDelta(kind: 'you' | 'voice', delta: string, endMs?: number): void {
    const store = this.store.getState();
    const open = this.openLines[kind];
    const gap = open && endMs !== undefined && open.endMs !== null ? endMs - open.endMs : Number.POSITIVE_INFINITY;
    if (!open || gap > LIMITS.TURN_GAP_MS) {
      const id = store.appendTranscript(kind, delta);
      this.openLines[kind] = { id, endMs: endMs !== undefined ? endMs : null };
      return;
    }
    store.extendTranscript(open.id, delta);
    if (endMs !== undefined) open.endMs = endMs;
  }

  // -- delegation -----------------------------------------------------------

  private handleDelegation(delegationId: string | undefined): void {
    const store = this.store.getState();
    if (!delegationId) return;

    const { task, nextCursor } = reconstructTask(this.inputTurns, this.delegatedUpTo);
    this.delegatedUpTo = nextCursor;

    // Nothing was said: prompting here would re-run the previous request.
    if (!isPromptableTask(task)) {
      store.appendTranscript('marker', 'Delegation with nothing behind it — nothing was prompted.');
      this.settleStatus();
      return;
    }

    const taskKey = normalizeTaskKey(task);
    if (this.isDuplicate(taskKey)) {
      store.appendTranscript('marker', 'Duplicate delegation in flight — ignored.');
      this.settleStatus();
      return;
    }
    this.rememberTask(taskKey);

    const binding = store.binding;
    if (!binding) {
      store.appendTranscript('error', 'No chat session is bound, so the request could not run.');
      store.setError('No chat session is bound.');
      this.settleStatus();
      return;
    }

    this.delegationSeq += 1;
    const directory = binding.directory;
    const job: Job = {
      delegationId,
      seq: this.delegationSeq,
      task,
      taskKey,
      sessionId: binding.sessionId,
      directory,
      buffer: '',
      baselineMessageIds: readMessageIds(directory, binding.sessionId),
      lastThinkingAt: 0,
      lastCommentaryAt: 0,
      lastSpokenText: '',
      sawStart: false,
      finished: false,
      interrupted: false,
      timers: [],
      intervals: [],
      unsubscribers: [],
    };

    store.appendTranscript('marker', `Delegated #${job.seq} — ${task.slice(0, 140)}`);
    store.setLastTask(task);

    // Immediate and silent. It does NOT reliably mute the spoken "on it",
    // so nothing downstream may depend on that acknowledgement being absent.
    this.enqueue(OUTBOUND.THINKING, delegationId, clampForAppend(task));

    this.queue.push(job);
    this.drainQueue();
  }

  private isDuplicate(taskKey: string): boolean {
    const now = Date.now();
    this.recentTasks = this.recentTasks.filter((entry) => now - entry.at < LIMITS.DUPLICATE_WINDOW_MS);
    const busy = Boolean(this.activeJob) || this.queue.length > 0;
    return busy && this.recentTasks.some((entry) => entry.key === taskKey);
  }

  private rememberTask(taskKey: string): void {
    this.recentTasks = this.recentTasks.filter((entry) => entry.key !== taskKey);
    this.recentTasks.push({ key: taskKey, at: Date.now() });
  }

  private drainQueue(): void {
    if (!this.running || this.activeJob || this.queue.length === 0) return;
    const job = this.queue.shift();
    if (!job) return;
    this.activeJob = job;
    void this.runJob(job);
  }

  private async runJob(job: Job): Promise<void> {
    const store = this.store.getState();
    store.setStatus('delegating');

    const childStore = resolveDirectoryStore(job.directory);
    if (!childStore) {
      this.failJob(job, 'This session\'s project is not loaded, so the request could not run.');
      return;
    }

    // Subscribe before prompting: a fast answer must not land between the
    // prompt and the subscription.
    job.unsubscribers.push(subscribeDirectorySessionMessages(childStore, job.sessionId, () => {
      if (job.finished) return;
      const latest = readLastAssistantMessage(childStore, job.sessionId);
      if (!latest || job.baselineMessageIds.has(latest.id)) return;
      if (latest.text === job.buffer) return;
      job.buffer = latest.text;
      this.maybeSpeakProgress(job);
    }));

    job.unsubscribers.push(subscribeDirectoryForm(childStore, job.sessionId, () => {
      this.notePendingQuestion(childStore, job.sessionId);
    }));
    this.notePendingQuestion(childStore, job.sessionId);

    // One turn end, and only one: the status leaving `busy` after this job's
    // own start. `step.ended` is deliberately not consulted — a prompt ends a
    // step after every tool call, which would close the job on an empty step
    // and lose the answer.
    job.unsubscribers.push(subscribeSessionStatusTransitions((sessionId, activeSessionIds) => {
      if (job.finished || sessionId !== job.sessionId) return;
      if (activeSessionIds.has(sessionId)) {
        job.sawStart = true;
        if (this.activeJob === job) this.store.getState().setStatus('working');
        return;
      }
      if (job.sawStart) this.completeTurn(job);
    }));

    // Silent progress pings, cheap enough to send blind.
    job.intervals.push(setInterval(() => {
      if (job.finished || !job.buffer.trim()) return;
      const now = Date.now();
      if (now - job.lastThinkingAt < LIMITS.THINKING_EVERY_MS) return;
      job.lastThinkingAt = now;
      this.enqueue(OUTBOUND.THINKING, job.delegationId, tailForAppend(job.buffer, 1200));
    }, 1000));

    // Fallback for the case where this prompt's own execution events never
    // arrive at all (a late attach, a server restart mid-job). Generous on
    // purpose, and only when the start was never seen.
    job.timers.push(setTimeout(() => {
      if (job.finished || job.sawStart) return;
      const status = resolveSessionStatus(job.sessionId, job.directory);
      if (status === 'busy') {
        job.sawStart = true;
        this.store.getState().setStatus('working');
        return;
      }
      this.completeTurn(job);
    }, LIMITS.QUIESCENCE_MS));

    // A job that never reports an end must not leave the panel in WORKING.
    job.timers.push(setTimeout(() => {
      if (job.finished) return;
      this.completeTurn(job);
    }, HARD_JOB_TIMEOUT_MS));

    const sent = await this.postPrompt(job);
    if (!sent) return;

    const status = resolveSessionStatus(job.sessionId, job.directory);
    if (status === 'busy') {
      job.sawStart = true;
      this.store.getState().setStatus('working');
    }
  }

  private async postPrompt(job: Job): Promise<boolean> {
    const config = resolveSendConfig(job.sessionId);
    if (!config.providerID || !config.modelID) {
      this.failJob(job, 'No model is selected for this session, so the request could not run.');
      return false;
    }

    try {
      await withTimeout(
        useSessionUIStore.getState().sendMessage(
          job.task,
          config.providerID,
          config.modelID,
          config.agent,
          [],
          undefined,
          undefined,
          undefined,
          'normal',
          {
            target: { runtimeKey: getRuntimeKey(), sessionId: job.sessionId, directory: job.directory },
            sessionId: job.sessionId,
            directory: job.directory,
          },
        ),
        PROMPT_TIMEOUT_MS,
        'The prompt did not reach the agent.',
      );
      this.store.getState().setStatus('working');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failJob(job, `The prompt was not accepted: ${message}`);
      return false;
    }
  }

  /**
   * Speak this turn's answer and let the panel settle. Called from the turn
   * end, the quiescence fallback and the hard timeout alike: whichever gets
   * here first wins, and every one of them leaves the status at `listening`.
   */
  private completeTurn(job: Job): void {
    if (job.finished) return;

    const childStore = resolveDirectoryStore(job.directory);
    const latest = childStore ? readLastAssistantMessage(childStore, job.sessionId) : null;
    const fromStore = latest && !job.baselineMessageIds.has(latest.id) ? latest.text : '';
    const spokenAnswer = flattenForSpeech(fromStore || job.buffer);

    this.finishJob(job);

    if (job.interrupted) {
      this.settleStatus();
      return;
    }

    if (!spokenAnswer) {
      // A job that only ran tools produces no final text. Say something
      // neutral rather than leave silence — but never invent a result.
      this.enqueue(OUTBOUND.COMMENTARY, job.delegationId, 'That is done.');
      this.store.getState().appendTranscript('spoken', 'That is done.');
      this.settleStatus();
      return;
    }

    // A final answer is spoken whatever its length: "main" and "4" are real
    // answers, and the fragment minimum exists for progress only.
    if (spokenAnswer !== job.lastSpokenText) {
      for (const chunk of chunkByBytes(spokenAnswer, LIMITS.CHUNK_BYTES)) {
        this.enqueue(OUTBOUND.COMMENTARY, job.delegationId, clampForAppend(chunk));
      }
      this.store.getState().appendTranscript('spoken', spokenAnswer);
    }
    this.settleStatus();
  }

  private failJob(job: Job, message: string): void {
    this.finishJob(job);
    const store = this.store.getState();
    store.setError(message);
    store.appendTranscript('error', message);
    this.settleStatus();
  }

  private finishJob(job: Job): void {
    if (job.finished) return;
    job.finished = true;
    for (const timer of job.timers) clearTimeout(timer);
    for (const interval of job.intervals) clearInterval(interval);
    job.timers = [];
    job.intervals = [];
    for (const unsubscribe of job.unsubscribers) {
      try {
        unsubscribe();
      } catch {
        // Ignore.
      }
    }
    job.unsubscribers = [];
    if (this.activeJob === job) this.activeJob = null;
    this.drainQueue();
  }

  private finishAllJobs(): void {
    for (const job of this.queue) this.finishJob(job);
    this.queue = [];
    if (this.activeJob) this.finishJob(this.activeJob);
    this.activeJob = null;
  }

  /** Never leave the panel showing WORKING or DELEGATING after a job ends. */
  private settleStatus(): void {
    if (!this.running) return;
    // A queued job may have taken over while this one finished; its status is
    // the truth now, not ours.
    if (this.activeJob) return;
    const status = this.store.getState().status;
    if (status === 'working' || status === 'delegating') {
      this.store.getState().setStatus('listening');
    }
  }

  private maybeSpeakProgress(job: Job): void {
    const now = Date.now();
    if (now - job.lastCommentaryAt < LIMITS.COMMENTARY_EVERY_MS) return;
    const fragment = progressFragment(job.buffer);
    if (!fragment || fragment.length < LIMITS.MIN_SPOKEN_CHARS || fragment === job.lastSpokenText) return;
    job.lastCommentaryAt = now;
    job.lastSpokenText = fragment;
    this.enqueue(OUTBOUND.COMMENTARY, job.delegationId, clampForAppend(fragment));
  }

  private notePendingQuestion(childStore: StoreApi<DirectoryStore>, sessionId: string): void {
    const forms = childStore.getState().form[sessionId] ?? [];
    const first = forms[0];
    if (!first) {
      if (this.store.getState().pendingQuestion?.sessionId === sessionId) {
        this.store.getState().setPendingQuestion(null);
      }
      return;
    }
    const existing = this.store.getState().pendingQuestion;
    if (existing && existing.formId === first.id) return;
    this.store.getState().setPendingQuestion({
      sessionId,
      formId: String(first.id),
      title: first.title || 'The agent is waiting on a question.',
      at: Date.now(),
    });
  }

  // -- outbound -------------------------------------------------------------

  /**
   * Queue one append. Everything leaves through here so the pacing holds for
   * answers, fragments and pings alike: three chunks landing in the same
   * millisecond is what the reference implementation did, and the model reads
   * a burst as one run-on.
   */
  private enqueue(type: OutboundType, delegationId: string, content: string): void {
    if (!this.running) return;
    const trimmed = clampForAppend(content);
    if (!trimmed) return;
    const key = `${type}\u0000${trimmed}`;
    if (key === this.lastSentKey) return;
    this.outbound.push({ type, delegation_id: delegationId, content: trimmed });
    this.scheduleOutbound();
  }

  private scheduleOutbound(): void {
    if (this.outboundTimer || this.outbound.length === 0) return;
    this.outboundTimer = setTimeout(() => {
      this.outboundTimer = null;
      this.flushOne();
      this.scheduleOutbound();
    }, LIMITS.APPEND_GAP_MS);
  }

  private flushOne(): void {
    const next = this.outbound.shift();
    if (!next) return;
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') {
      this.outbound = [];
      return;
    }
    try {
      dc.send(encodeAppend(next));
      this.lastSentKey = `${next.type}\u0000${next.content}`;
    } catch (error) {
      this.store.getState().appendTranscript('error',
        `Could not reach the voice session: ${error instanceof Error ? error.message : String(error)}`);
      this.outbound = [];
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The fixed channel name, aliased so the class body reads cleanly. */
const DATA_CHANNEL_NAME = DATA_CHANNEL;

const waitForIce = (pc: RTCPeerConnection, timeoutMs: number): Promise<void> => {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const resolveDirectoryStore = (directory: string): StoreApi<DirectoryStore> | null => {
  if (!directory) return null;
  try {
    return getSyncChildStores().getChild(directory) ?? null;
  } catch {
    return null;
  }
};

const readMessageIds = (directory: string, sessionId: string): Set<string> => {
  const store = resolveDirectoryStore(directory);
  if (!store) return new Set();
  const messages = store.getState().message[sessionId] ?? [];
  return new Set(messages.map((message) => message.id));
};

const readLastAssistantMessage = (
  store: StoreApi<DirectoryStore>,
  sessionId: string,
): { id: string; text: string } | null => {
  const state = store.getState();
  const messages = state.message[sessionId];
  if (!messages || messages.length === 0) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    return { id: message.id, text: flattenAssistantTextParts(state.part[message.id] ?? []) };
  }
  return null;
};

/**
 * Is this session working right now, read the way the chat reads it: the live
 * status first, then a trailing assistant message that has not completed as
 * the evidence of a turn the status map missed.
 */
const resolveSessionStatus = (sessionId: string, directory: string): 'busy' | 'idle' => {
  const store = resolveDirectoryStore(directory);
  if (!store) return 'idle';
  const state = store.getState();
  const status = state.session_status[sessionId]?.type;
  if (status === 'busy' || status === 'retry') return 'busy';
  const messages = state.message[sessionId] ?? [];
  const last = messages[messages.length - 1];
  // `role === 'assistant'` narrows to the message shape that carries a
  // completion timestamp; absent (or null, from a malformed payload) means the
  // turn has not finished, which is the evidence this function is after.
  if (last?.role === 'assistant' && last.time.completed == null) {
    return 'busy';
  }
  return 'idle';
};

/** Which model and agent a delegation prompt runs as. */
type SendConfig = {
  providerID: string | undefined;
  modelID: string | undefined;
  agent: string | undefined;
};

/**
 * Which model and agent the delegation prompt runs as. The session's own last
 * assistant model wins over the composer's picker: a voice job must not change
 * the model of a session the user is reading in another tab.
 */
const resolveSendConfig = (sessionId: string): SendConfig => {
  const lastUsed = getSessionLastAssistantModel(sessionId);
  const config = useConfigStore.getState();
  // The panel's own pick wins: it is the one the user chose for voice work,
  // and it never writes the chat composer's selection.
  const agent = useLiveVoiceStore.getState().agentName
    ?? useContextStore.getState().getSessionAgentSelection(sessionId)
    ?? config.currentAgentName
    ?? undefined;
  return {
    providerID: lastUsed?.providerID ?? config.currentProviderId ?? undefined,
    modelID: lastUsed?.modelID ?? config.currentModelId ?? undefined,
    agent,
  };
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let client: LiveVoiceClient | null = null;

export const getLiveVoiceClient = (): LiveVoiceClient => {
  if (!client) {
    client = new LiveVoiceClient();
    // A reload cannot keep the session: the peer connection dies with the
    // page, so the microphone must be released before the tab goes.
    if ('window' in globalThis) {
      window.addEventListener('beforeunload', () => client?.stop());
    }
  }
  return client;
};

declare global {
  interface Window {
    /** The transport handle a headless check reads; nothing in the app reads it back. */
    openchamberLiveVoice?: { snapshot: () => ReturnType<LiveVoiceClient['snapshot']> };
  }
}

/**
 * The same handle on `window`, so a headless check can assert transport state
 * (`pc`, `dc`, mic tracks) without a build step or a test hook. Reached from
 * `page.evaluate` only; nothing in the app reads it back.
 */
if ('window' in globalThis) {
  window.openchamberLiveVoice = {
    snapshot: () => getLiveVoiceClient().snapshot(),
  };
}
