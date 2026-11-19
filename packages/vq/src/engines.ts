import { concatPcm, encodeWav, int16ToBase64 } from './core/audio'

/** A speech-to-text backend. Functions can't travel in JSON, so the host registers engines and the spec names one by id. */
export interface EngineOpts { language?: string; model?: string; provider?: 'local' | 'openai-compatible'; correct?: boolean; openaiCompatible?: { baseUrl?: string; model?: string; apiKey?: string; endpointPath?: string } }
export interface StreamSession { push(pcm: Int16Array): void; finish(): Promise<string>; cancel(): void }
export interface Engine {
  id: string; label: string
  /** One finished utterance (16 kHz mono PCM16) in, text out. Used with voice-activity segmenting. */
  transcribe?: (pcm: Int16Array, o: EngineOpts) => Promise<string>
  /** A continuous stream; the backend segments and sends partial text as it commits. */
  open?: (o: EngineOpts & { onPartial?: (text: string) => void }) => Promise<StreamSession>
  /** Engines that own the microphone themselves (browser Web Speech). */
  live?: (h: { onText: (text: string, final: boolean) => void; onError: (e: Error) => void }, o: EngineOpts) => { stop(): void }
}

// ---------- OpenChamber: its /api/dictation/ws protocol (Parakeet, Whisper, Qwen3-ASR via the local sherpa-onnx worker) ----------
export interface OpenChamberConfig {
  /** Origin of the OpenChamber server. Default: the page's own origin (right when running inside OpenChamber). */
  baseUrl?: string
  /** The WebSocket upgrade authenticates with an oc_url_token query parameter. */
  token?: string | (() => string | Promise<string>)
  path?: string; WebSocketImpl?: typeof WebSocket; connectTimeoutMs?: number; finishTimeoutMs?: number
}
export const PCM_FORMAT = 'audio/pcm;rate=16000;bits=16'
const uid = () => 'vq-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
export function openChamberEngine(cfg: OpenChamberConfig = {}): Engine {
  let ws: WebSocket | null = null, connecting: Promise<WebSocket> | null = null, idle: ReturnType<typeof setTimeout> | null = null, active = 0
  const handlers = new Map<string, (m: any) => void>()
  const WS = cfg.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : (undefined as never))
  const wsUrl = async () => {
    const base = cfg.baseUrl ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost')
    const u = new URL(cfg.path ?? '/api/dictation/ws', base); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    const t = typeof cfg.token === 'function' ? await cfg.token() : cfg.token; if (t) u.searchParams.set('oc_url_token', t)
    return u.toString()
  }
  const failAll = (e: Error) => { for (const h of handlers.values()) h({ type: 'error', error: e.message, retryable: true }); handlers.clear() }
  const connect = (): Promise<WebSocket> => {
    if (ws && ws.readyState === 1) return Promise.resolve(ws)
    return (connecting ??= (async () => {
      const sock = new WS(await wsUrl())
      return await new Promise<WebSocket>((resolve, reject) => {
        let done = false; const t = setTimeout(() => { if (!done) { done = true; connecting = null; reject(new Error('Dictation connection timed out')); try { sock.close() } catch { /* */ } } }, cfg.connectTimeoutMs ?? 10000)
        sock.onmessage = (ev: MessageEvent) => {
          let m: any; try { m = JSON.parse(String(ev.data)) } catch { return }
          if (!done && m.type === 'ready') { done = true; clearTimeout(t); ws = sock; connecting = null; resolve(sock); return }
          if (m.dictationId) handlers.get(m.dictationId)?.(m)
        }
        sock.onerror = () => { setTimeout(() => { if (!done) { done = true; clearTimeout(t); connecting = null; reject(new Error('Dictation connection failed')) } }, 250) }
        sock.onclose = (ev: CloseEvent) => { if (!done) { done = true; clearTimeout(t); connecting = null; reject(new Error('Dictation connection failed' + (ev?.reason ? ': ' + ev.reason : ''))) } else if (ws === sock) { ws = null; failAll(new Error('Dictation connection lost')) } }
      })
    })())
  }
  const release = () => { active = Math.max(0, active - 1); if (!active) { if (idle) clearTimeout(idle); idle = setTimeout(() => { if (!active) { try { ws?.close() } catch { /* */ } ws = null } }, 30000) } }
  const open: NonNullable<Engine['open']> = async (o) => {
    const sock = await connect(); if (idle) { clearTimeout(idle); idle = null } active++
    const id = uid(); let seq = 0, finished = false
    let onAck: (() => void) | null = null, onErr: ((e: Error) => void) | null = null, onFinal: ((t: string) => void) | null = null, finTimer: ReturnType<typeof setTimeout> | null = null
    const err = (m: any) => Object.assign(new Error(m.error || 'Dictation failed'), { retryable: m.retryable !== false, reasonCode: m.reasonCode })
    handlers.set(id, (m) => {
      if (m.type === 'ack') onAck?.()
      else if (m.type === 'partial') o.onPartial?.(m.text ?? '')
      else if (m.type === 'finish_accepted' && typeof m.timeoutMs === 'number') { if (finTimer) clearTimeout(finTimer); finTimer = setTimeout(() => onErr?.(new Error('Timed out waiting for transcription')), m.timeoutMs + 5000) }
      else if (m.type === 'final') onFinal?.(m.text ?? '')
      else if (m.type === 'error') onErr?.(err(m))
    })
    const done = () => { handlers.delete(id); if (finTimer) clearTimeout(finTimer); if (!finished) { finished = true; release() } }
    const options = { provider: o.provider ?? 'local', ...(o.language && o.language !== 'auto' ? { language: o.language } : {}), ...(o.model ? { localModel: o.model } : {}), ...(o.correct ? { correct: true } : {}), ...(o.openaiCompatible ? { openaiCompatible: o.openaiCompatible } : {}) }
    try {
      await new Promise<void>((res, rej) => { onAck = res; onErr = rej; setTimeout(() => rej(new Error('Dictation start timed out')), 30000); sock.send(JSON.stringify({ type: 'start', dictationId: id, format: PCM_FORMAT, options })) })
    } catch (e) { done(); throw e }
    return {
      push(pcm) { for (let i = 0; i < pcm.length; i += 16000) sock.send(JSON.stringify({ type: 'chunk', dictationId: id, seq: seq++, audio: int16ToBase64(pcm.subarray(i, i + 16000)) })) },
      finish: () => new Promise<string>((res, rej) => {
        const t = setTimeout(() => rej(new Error('Timed out waiting for transcription')), cfg.finishTimeoutMs ?? 60000)
        onFinal = (x) => { clearTimeout(t); done(); res(x) }; onErr = (e) => { clearTimeout(t); done(); rej(e) }
        sock.send(JSON.stringify({ type: 'finish', dictationId: id, finalSeq: seq - 1 }))
      }),
      cancel() { try { sock.send(JSON.stringify({ type: 'cancel', dictationId: id })) } catch { /* */ } done() },
    }
  }
  return { id: 'openchamber', label: 'OpenChamber (local)', open, transcribe: async (pcm, o) => { const s = await open(o); s.push(pcm); return s.finish() } }
}

// ---------- any OpenAI-compatible /v1/audio/transcriptions endpoint ----------
export function openAICompatibleEngine(cfg: { baseUrl: string; apiKey?: string; model?: string; endpointPath?: string; fetchImpl?: typeof fetch }): Engine {
  return { id: 'openai-compatible', label: 'OpenAI-compatible', transcribe: async (pcm, o) => {
    const f = new FormData(); f.append('file', new Blob([encodeWav(pcm)], { type: 'audio/wav' }), 'audio.wav'); f.append('model', o.openaiCompatible?.model ?? cfg.model ?? o.model ?? 'whisper-1'); f.append('response_format', 'json')
    if (o.language && o.language !== 'auto') f.append('language', o.language)
    const r = await (cfg.fetchImpl ?? fetch)(cfg.baseUrl.replace(/\/$/, '') + (cfg.endpointPath ?? '/v1/audio/transcriptions'), { method: 'POST', body: f, headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : undefined })
    if (!r.ok) throw new Error(`Transcription failed (${r.status})`); return String((await r.json()).text ?? '').trim()
  } }
}

// ---------- browser Web Speech API (no server; Chrome and Safari; audio goes to the browser vendor) ----------
export function browserSpeechEngine(): Engine {
  return { id: 'browser', label: 'Browser speech', live: (h, o) => {
    const SR = (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) as any
    if (!SR) { h.onError(new Error('This browser has no speech recognition. Use OpenChamber or another engine.')); return { stop() {} } }
    let stopped = false; const r = new SR(); r.continuous = true; r.interimResults = true; if (o.language && o.language !== 'auto') r.lang = o.language
    r.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) h.onText(e.results[i][0].transcript, !!e.results[i].isFinal) }
    r.onerror = (e: any) => { if (e.error !== 'no-speech' && e.error !== 'aborted') h.onError(new Error('Speech recognition: ' + e.error)) }
    r.onend = () => { if (!stopped) { try { r.start() } catch { /* */ } } }
    try { r.start() } catch (e) { h.onError(e as Error) }
    return { stop() { stopped = true; try { r.stop() } catch { /* */ } } }
  } }
}

// ---------- scripted engine for demos and tests: no microphone, no server ----------
export const MOCK_LINES = [
  'Hi, is this Mrs. Alvarez? This is Justin with Resource Realty.', 'Yes, speaking. What is this about?', 'I am calling about the house on Test Street. Are you still thinking about selling?',
  'Maybe. It needs a lot of work, the roof especially.', 'Understood. If we bought it as-is, would a quick close in thirty days help?', 'That could work. What number were you thinking?',
  'I would want to run the numbers first. Can I call you back Thursday?', 'Thursday afternoon is fine. Use this number.',
]
export function mockEngine(lines: string[] = MOCK_LINES, delayMs = 250): Engine {
  let n = 0; return { id: 'mock', label: 'Simulated', transcribe: () => new Promise((r) => setTimeout(() => r(lines[n++ % lines.length]), delayMs)) }
}
export const defaultEngines = (oc?: OpenChamberConfig): Record<string, Engine> => ({ mock: mockEngine(), browser: browserSpeechEngine(), openchamber: openChamberEngine(oc) })
export { concatPcm }
