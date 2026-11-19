/** Audio helpers: no DOM, no hardware. Everything here is unit-testable. */
export const TARGET_RATE = 16000

export const floatToInt16 = (s: number) => { const c = Math.max(-1, Math.min(1, s)); return c < 0 ? c * 0x8000 : c * 0x7fff }
/** Linear resample Float32 -> 16-bit PCM. Same approach OpenChamber's dictation capture uses. */
export function resampleToPcm16(input: Float32Array, inRate: number, outRate = TARGET_RATE): Int16Array {
  if (!input.length) return new Int16Array(0)
  if (inRate === outRate) { const o = new Int16Array(input.length); for (let i = 0; i < input.length; i++) o[i] = floatToInt16(input[i]); return o }
  const n = Math.floor((input.length * outRate) / inRate), out = new Int16Array(n), k = inRate / outRate
  for (let i = 0; i < n; i++) { const p = i * k, i0 = Math.floor(p), i1 = Math.min(i0 + 1, input.length - 1), f = p - i0; out[i] = floatToInt16(input[i0] * (1 - f) + input[i1] * f) }
  return out
}
export function int16ToBase64(pcm: Int16Array): string {
  const b = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength); let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
export function base64ToInt16(b64: string): Int16Array { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Int16Array(u.buffer) }
export const concatPcm = (parts: Int16Array[]) => { const o = new Int16Array(parts.reduce((a, p) => a + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length } return o }
/** Normalized RMS (0..1) of a PCM16 frame. */
export function rms16(p: Int16Array): number { if (!p.length) return 0; let s = 0; for (let i = 0; i < p.length; i++) s += (p[i] / 32768) ** 2; return Math.sqrt(s / p.length) }
/** 16-bit mono WAV file bytes, for HTTP transcription endpoints. */
export function encodeWav(pcm: Int16Array, rate = TARGET_RATE): Uint8Array<ArrayBuffer> {
  const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b), w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true)
  return new Uint8Array(b)
}

// ---------- voice processing presets (what the spec's `processing.preset` means) ----------
export interface Processing {
  preset: 'speech' | 'phone' | 'room' | 'raw'; source: 'mic' | 'tab' | 'both'
  echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean; deviceId?: string
  mode: 'toggle' | 'hold'; segmenting: 'utterance' | 'stream'
  vad: { threshold?: number; silenceMs: number; minSpeechMs: number; maxSegmentSec: number }
}
const PRESETS = {
  speech: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, threshold: 0.012 }, // one person close to the mic (OpenChamber's dictation defaults)
  phone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, threshold: 0.008 }, // speakerphone / far voices: more sensitive
  room: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, threshold: 0.01 }, // meetings: keep distant voices intact
  raw: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, threshold: 0.015 },
} as const
export function resolveProcessing(p: Processing) {
  const d = PRESETS[p.preset]
  return {
    constraints: { channelCount: 1, echoCancellation: p.echoCancellation ?? d.echoCancellation, noiseSuppression: p.noiseSuppression ?? d.noiseSuppression, autoGainControl: p.autoGainControl ?? d.autoGainControl, ...(p.deviceId ? { deviceId: { exact: p.deviceId } } : {}) } as MediaTrackConstraints,
    vad: { threshold: p.vad.threshold ?? d.threshold, silenceMs: p.vad.silenceMs, minSpeechMs: p.vad.minSpeechMs, maxSegmentMs: p.vad.maxSegmentSec * 1000 },
  }
}

// ---------- voice activity detection: cut a continuous stream into utterances ----------
export interface Utterance { startMs: number; endMs: number; pcm: Int16Array }
export interface VadOptions { threshold: number; silenceMs: number; minSpeechMs: number; maxSegmentMs: number; preRollMs?: number; rate?: number }
/** Energy VAD with an adaptive noise floor, pre-roll (so word onsets aren't clipped) and a forced split on long speech. */
export class Vad {
  private rate: number; private frame: number; private preRoll: number; private floor = 0.004
  private carry = new Int16Array(0); private pos = 0 // samples consumed
  private ring: Int16Array[] = []; private speaking = false; private cur: Int16Array[] = []; private startSample = 0
  private silent = 0; private speechFrames = 0; level = 0
  constructor(private o: VadOptions) { this.rate = o.rate ?? TARGET_RATE; this.frame = Math.round(this.rate * 0.02); this.preRoll = Math.ceil((o.preRollMs ?? 300) / 20) }
  push(pcm: Int16Array): Utterance[] {
    const out: Utterance[] = []; const all = this.carry.length ? concatPcm([this.carry, pcm]) : pcm; let i = 0
    for (; i + this.frame <= all.length; i += this.frame) { const f = all.subarray(i, i + this.frame), u = this.frameIn(f); if (u) out.push(u) }
    this.carry = all.slice(i); return out
  }
  /** End of stream: emit any speech in progress. */
  flush(): Utterance[] { const u = this.speaking ? this.emit() : null; this.speaking = false; return u ? [u] : [] }
  private ms = (samples: number) => Math.round((samples / this.rate) * 1000)
  private frameIn(f: Int16Array): Utterance | null {
    const r = rms16(f); this.level = r; const isSpeech = r > Math.max(this.o.threshold, this.floor * 3)
    if (!isSpeech) this.floor = this.floor * 0.98 + Math.min(r, 0.05) * 0.02 // learn the room's noise only from non-speech
    const fs = f.slice(); let res: Utterance | null = null
    if (!this.speaking) {
      this.ring.push(fs); if (this.ring.length > this.preRoll) this.ring.shift()
      if (isSpeech) { this.speaking = true; this.cur = this.ring.slice(); this.startSample = this.pos - (this.ring.length - 1) * this.frame; this.ring = []; this.silent = 0; this.speechFrames = 1 }
    } else {
      this.cur.push(fs)
      if (isSpeech) { this.silent = 0; this.speechFrames++ } else this.silent++
      const len = this.cur.length * this.frame
      if (this.silent * 20 >= this.o.silenceMs) { res = this.emit(); this.speaking = false }
      else if (this.ms(len) >= this.o.maxSegmentMs) { res = this.emit(); this.speaking = true; this.cur = []; this.startSample = this.pos + this.frame; this.silent = 0; this.speechFrames = 0 }
    }
    this.pos += this.frame; return res
  }
  private emit(): Utterance | null {
    const keepTail = Math.min(this.silent, 10) // keep up to 200 ms of trailing silence
    const frames = this.cur.slice(0, this.cur.length - this.silent + keepTail), speechMs = this.speechFrames * 20
    this.cur = []; this.silent = 0; this.speechFrames = 0
    if (speechMs < this.o.minSpeechMs || !frames.length) return null
    const pcm = concatPcm(frames); return { startMs: this.ms(this.startSample), endMs: this.ms(this.startSample + pcm.length), pcm }
  }
}
