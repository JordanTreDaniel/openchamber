import { resampleToPcm16, rms16 } from './core/audio'

export type Channel = 'me' | 'them'
export interface CaptureOpts { source: 'mic' | 'tab' | 'both'; constraints: MediaTrackConstraints; recordAudio: boolean; onPcm: (ch: Channel, pcm: Int16Array) => void; onLevel?: (ch: Channel, rms: number) => void }
export interface Capture { stop(): Promise<Blob | undefined> }
export type CaptureFn = (o: CaptureOpts) => Promise<Capture>
export const supportsCapture = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
export const insecure = () => typeof window !== 'undefined' && !window.isSecureContext

/** Real capture: microphone and/or shared-tab audio, resampled to 16 kHz mono PCM16 (what OpenChamber's dictation expects). */
export const realCapture: CaptureFn = async (o) => {
  if (!supportsCapture()) throw new Error(insecure() ? 'The microphone needs HTTPS (or localhost). Open this page over https.' : 'This browser cannot record audio.')
  const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext
  const ctx: AudioContext = new AC(); if (ctx.state === 'suspended') await ctx.resume()
  const owned: MediaStream[] = []; const ins: { ch: Channel; stream: MediaStream }[] = []
  try {
    if (o.source !== 'tab') { const s = await navigator.mediaDevices.getUserMedia({ audio: o.constraints }); owned.push(s); ins.push({ ch: 'me', stream: s }) }
    if (o.source !== 'mic') {
      const d = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }); d.getVideoTracks().forEach((t) => t.stop()); owned.push(d)
      if (!d.getAudioTracks().length) throw new Error('No audio was shared. In the picker choose a tab and tick "Share tab audio".')
      ins.push({ ch: 'them', stream: new MediaStream(d.getAudioTracks()) })
    }
  } catch (e) { owned.forEach((s) => s.getTracks().forEach((t) => t.stop())); await ctx.close(); throw e }
  const dest = o.recordAudio ? ctx.createMediaStreamDestination() : null; const nodes: AudioNode[] = []
  for (const { ch, stream } of ins) {
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0 // keeps the processor running without playing the mic back
    proc.onaudioprocess = (e) => { const pcm = resampleToPcm16(e.inputBuffer.getChannelData(0), ctx.sampleRate); o.onPcm(ch, pcm); o.onLevel?.(ch, rms16(pcm)) }
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination); if (dest) src.connect(dest); nodes.push(src, proc, mute)
  }
  let rec: MediaRecorder | null = null; const chunks: Blob[] = []
  if (dest && typeof MediaRecorder !== 'undefined') { rec = new MediaRecorder(dest.stream); rec.ondataavailable = (e) => e.data.size && chunks.push(e.data); rec.start(1000) }
  return { stop: async () => {
    const blob = rec ? await new Promise<Blob>((res) => { rec!.onstop = () => res(new Blob(chunks, { type: rec!.mimeType })); rec!.state !== 'inactive' ? rec!.stop() : res(new Blob(chunks)) }) : undefined
    nodes.forEach((n) => n.disconnect()); owned.forEach((s) => s.getTracks().forEach((t) => t.stop())); await ctx.close(); return blob
  } }
}

/** Synthetic speech-shaped audio (tone bursts, alternating speakers) so the whole pipeline can be exercised without hardware. Every channel gets continuous audio, like the real thing. */
export const mockCapture: CaptureFn = async (o) => {
  const RATE = 16000, TICK = 100, N = (RATE * TICK) / 1000, chans: Channel[] = o.source === 'both' ? ['me', 'them'] : o.source === 'tab' ? ['them'] : ['me']
  const turns = [2200, 1500, 2600, 1400, 2000, 1500]; let ti = 0, tl = turns[0], speaker: Channel = chans[0], phase = 0
  const id = setInterval(() => {
    const talking = ti % 2 === 0
    for (const ch of chans) {
      const pcm = new Int16Array(N), on = talking && (chans.length === 1 || ch === speaker)
      for (let i = 0; i < N; i++) { phase += (2 * Math.PI * (ch === 'me' ? 180 : 240)) / RATE; pcm[i] = on ? Math.round(Math.sin(phase) * 9000 * (0.6 + 0.4 * Math.sin(i / 90))) : Math.round((Math.random() - 0.5) * 60) }
      o.onPcm(ch, pcm); o.onLevel?.(ch, rms16(pcm))
    }
    tl -= TICK; if (tl <= 0) { ti++; if (ti % 2 === 0 && chans.length === 2) speaker = speaker === 'me' ? 'them' : 'me'; tl = turns[ti % turns.length] }
  }, TICK)
  return { stop: async () => { clearInterval(id); return undefined } }
}
