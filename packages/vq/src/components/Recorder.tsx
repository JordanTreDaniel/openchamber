import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Vad, resolveProcessing } from '../core/audio'
import { addNote, addSegment, clock, hasContent, newSession, patchSegment, removeNote, removeSegment, toMarkdown, toggleCheck, wordCount, type RecSession, type Speaker } from '../core/recorder'
import { mockCapture, realCapture, supportsCapture, type Capture, type CaptureFn, type Channel } from '../capture'
import { defaultEngines, openAICompatibleEngine, type Engine, type EngineOpts, type StreamSession } from '../engines'
import type { Def } from '../Frame'
import { useTarget, useVQ } from '../hooks'
import { ContextView } from '../md'
import { putAudio } from '../output'
import { Btn, Chip, Img, Muted, Row } from '../prims'
import { T } from '../tokens'
import type { SpecOf, Values } from '../types'

type S = SpecOf<'recorder'>; type V = Values['recorder']
export interface RecorderEnv { engines: Record<string, Engine>; capture: CaptureFn; /** Called with the recorded audio when the take is worth keeping (spec.output.audio or the old saveAudio), so the host can upload or store it. */ onAudio?: (sessionId: string, blob: Blob) => void }
const base: RecorderEnv = { engines: defaultEngines(), capture: realCapture }
export const RecorderEnvContext = createContext<RecorderEnv>(base)
/** Register engines (e.g. openChamberEngine({ baseUrl, token })) and a capture function for every recorder below. */
export function RecorderProvider({ env, children }: { env: Partial<RecorderEnv>; children: ReactNode }) {
  return <RecorderEnvContext.Provider value={{ ...base, ...env, engines: { ...base.engines, ...env.engines } }}>{children}</RecorderEnvContext.Provider>
}
const OUTCOMES = [{ id: 'connected', label: 'Connected' }, { id: 'voicemail', label: 'Voicemail' }, { id: 'no-answer', label: 'No answer' }, { id: 'call-back', label: 'Call back' }, { id: 'wrong-number', label: 'Wrong number' }, { id: 'not-interested', label: 'Not interested' }]
const items = (s: S) => (s.items?.length ? s.items : [{ id: 'main', label: s.title ?? 'Recording' } as NonNullable<S['items']>[number]])
const SPK: Record<Speaker, { l: string; c: string }> = { me: { l: 'Me', c: T.accent }, them: { l: 'Them', c: T.violet }, unknown: { l: '?', c: T.muted } }

function RecorderView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const env = useContext(RecorderEnvContext); const tg = useTarget(); const { compact } = useVQ()
  const list = items(s); const [idx, setIdx] = useState(0); const item = list[Math.min(idx, list.length - 1)]
  const vref = useRef(value); vref.current = value
  const upd = (id: string, fn: (x: RecSession) => RecSession) => { const nv = { sessions: vref.current.sessions.map((x) => (x.id === id ? fn(x) : x)) }; vref.current = nv; onChange(nv) }
  const sess = value.sessions.find((x) => x.id === item.id) ?? newSession(item.id, item.label)
  /** Keep the take when a destination asks for audio (output.audio defaults to true) or the old flag is set. */
  const wantAudio = s.saveAudio || (s.output?.audio ?? false)
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'stopping'>('idle'); const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0); const [elapsed, setElapsed] = useState(0); const [level, setLevel] = useState(0); const [partial, setPartial] = useState('')
  const [editing, setEditing] = useState<string | null>(null); const [note, setNote] = useState(''); const [flash, setFlash] = useState(''); const [audio, setAudio] = useState<Record<string, string>>({})
  const run = useRef<{ id: string; stop: () => Promise<void> } | null>(null); const lastLvl = useRef(0)
  useEffect(() => () => { void run.current?.stop() }, [])
  const resolve = (): Engine => {
    if (s.engine.id === 'openai-compatible') return openAICompatibleEngine({ baseUrl: s.engine.openaiCompatible?.baseUrl ?? '', apiKey: s.engine.openaiCompatible?.apiKey, model: s.engine.openaiCompatible?.model, endpointPath: s.engine.openaiCompatible?.endpointPath })
    const e = env.engines[s.engine.id]; if (!e) throw new Error(`No speech engine registered as "${s.engine.id}".`); return e
  }

  const start = async () => {
    if (state !== 'idle') return; setError(null); setState('starting'); const sid = item.id, base0 = sess.durationSec
    try {
      const eng = resolve(), pr = resolveProcessing(s.processing), opts: EngineOpts = { language: s.engine.language, model: s.engine.model, provider: s.engine.provider, correct: s.engine.correct, openaiCompatible: s.engine.openaiCompatible }
      const useStream = s.processing.segmenting === 'stream' && !!eng.open && !eng.live, t0 = performance.now(), now = () => base0 + (performance.now() - t0) / 1000
      const tasks: Promise<unknown>[] = [], vads: Partial<Record<Channel, Vad>> = {}, streams: Partial<Record<Channel, Promise<StreamSession>>> = {}, seen: Partial<Record<Channel, string>> = {}; let n = 0, liveFrom = base0
      const bump = (d: number) => { n += d; setPending(n) }
      const seg = (sp: Speaker, a: number, b: number, text: string) => { if (text.trim()) upd(sid, (x) => addSegment({ ...x, startedAt: x.startedAt ?? new Date().toISOString().slice(0, 16).replace('T', ' ') }, { start: a, end: Math.max(b, a), text: text.trim(), speaker: sp })) }
      const spk = (ch: Channel): Speaker => (s.processing.source === 'mic' ? 'me' : ch)
      const utter = (ch: Channel, u: { startMs: number; endMs: number; pcm: Int16Array }) => {
        if (!eng.transcribe) return; bump(1)
        tasks.push(eng.transcribe(u.pcm, opts).then((t) => seg(spk(ch), base0 + u.startMs / 1000, base0 + u.endMs / 1000, t)).catch((e) => setError((e as Error).message)).finally(() => bump(-1)))
      }
      let live: { stop(): void } | null = null
      if (eng.live) live = eng.live({ onText: (t, fin) => { if (fin) { seg('me', liveFrom, now(), t); liveFrom = now(); setPartial('') } else setPartial(t) }, onError: (e) => setError(e.message) }, opts)
      else if (!useStream && !eng.transcribe) throw new Error(`Engine "${eng.label}" can't transcribe recorded audio.`)
      const onPcm = (ch: Channel, pcm: Int16Array) => {
        if (live) return
        if (useStream) { (streams[ch] ??= eng.open!({ ...opts, onPartial: (text) => { const prev = seen[ch] ?? ''; const delta = text.startsWith(prev) ? text.slice(prev.length) : text; seen[ch] = text; if (delta.trim()) seg(spk(ch), liveFrom, now(), delta); liveFrom = now() } })).then((x) => x.push(pcm)).catch((e) => setError((e as Error).message)); return }
        const v = (vads[ch] ??= new Vad({ ...pr.vad })); for (const u of v.push(pcm)) utter(ch, u)
      }
      const cap: Capture = await (s.engine.id === 'mock' ? mockCapture : env.capture)({ source: s.processing.source, constraints: pr.constraints, recordAudio: wantAudio, onPcm, onLevel: (_c, r) => { const t = performance.now(); if (t - lastLvl.current > 70) { lastLvl.current = t; setLevel(Math.min(1, r * 8)) } } })
      const tick = setInterval(() => setElapsed(now()), 250)
      run.current = { id: sid, stop: async () => {
        clearInterval(tick); const blob = await cap.stop(); live?.stop()
        for (const ch of Object.keys(vads) as Channel[]) for (const u of vads[ch]!.flush()) utter(ch, u)
        for (const ch of Object.keys(streams) as Channel[]) { const p = await streams[ch]; if (p) tasks.push(p.finish().then((text) => { const prev = seen[ch] ?? ''; const rest = text.startsWith(prev) ? text.slice(prev.length) : ''; if (rest.trim()) seg(spk(ch), liveFrom, now(), rest) }).catch((e) => setError((e as Error).message))) }
        await Promise.allSettled(tasks)
        upd(sid, (x) => ({ ...x, durationSec: Math.round(now() * 10) / 10, audioBytes: blob ? (x.audioBytes ?? 0) + blob.size : x.audioBytes }))
        if (blob) { env.onAudio?.(sid, blob); putAudio(sid, blob); setAudio((a) => ({ ...a, [sid]: URL.createObjectURL(blob) })) }
        setPartial(''); setLevel(0); run.current = null
      } }
      setState('recording')
    } catch (e) { setError((e as Error).message); setState('idle') }
  }
  const stop = async () => { if (state !== 'recording' && state !== 'starting') return; setState('stopping'); try { await run.current?.stop() } catch (e) { setError((e as Error).message) } setState('idle'); setElapsed(0) }

  const nowT = state === 'recording' ? elapsed : sess.durationSec
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); setFlash(`${what} copied`) } catch { setFlash('Copy blocked by the browser') } setTimeout(() => setFlash(''), 1800) }
  const download = (name: string, text: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); a.download = name; a.click() }
  const outcomes = s.outcomes ?? (list.length > 1 ? OUTCOMES : undefined), blocks = [...(s.context ?? []), ...(item.context ?? [])]
  const hide = state === 'recording' && s.transcript === 'after'; const rec = state === 'recording'
  const hold = s.processing.mode === 'hold'
  const holdProps = hold ? { onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); void start() }, onPointerUp: () => void stop(), onPointerLeave: () => void stop(), onPointerCancel: () => void stop() } : { onClick: () => (rec ? void stop() : void start()) }
  const eng = s.engine
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {list.length > 1 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }} role="tablist" aria-label="Sessions">
            {list.map((it, j) => { const ss = value.sessions.find((x) => x.id === it.id), done = ss && hasContent(ss); return <button key={it.id} role="tab" aria-selected={j === idx} type="button" className="vq-chip" aria-pressed={j === idx} disabled={rec} {...tg('session:' + it.id)} onClick={() => setIdx(j)} style={{ whiteSpace: 'nowrap', minHeight: 36, padding: '4px 12px', borderColor: done && j !== idx ? T.ok : undefined }}>{done ? '✓ ' : ''}{j + 1}. {it.label}</button> })}
          </div>
        </div>)}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {(item.image || list.length > 1) && <Img size={48} radius={24} src={item.image} label={item.label} />}
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 650, fontSize: 17 }}>{item.label}</div>{item.subtitle && <Muted>{item.subtitle}</Muted>}</div>
        {item.phone && <a className="vq-btn" href={`tel:${item.phone.replace(/[^+\d]/g, '')}`} style={{ textDecoration: 'none' }}>Call {item.phone}</a>}
      </div>
      {blocks.length > 0 && <details open style={{ display: 'block' }}><summary style={{ cursor: 'pointer', color: T.muted, fontSize: 13, marginBottom: 6 }}>Context</summary><ContextView blocks={blocks} id={item.id} checks={sess.checks} onCheck={(k) => upd(item.id, (x) => toggleCheck(x, k))} /></details>}
      {s.disclosure && <div role="note" style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${T.warn}`, color: T.text, fontSize: 13 }}>{s.disclosure}</div>}

      <div style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: '6px 0' }}>
        <button type="button" {...tg('record')} {...holdProps} disabled={state === 'starting' || state === 'stopping'} aria-pressed={rec} aria-label={rec ? 'Stop recording' : hold ? 'Hold to record' : 'Start recording'}
          style={{ width: 84, height: 84, borderRadius: 42, border: `3px solid ${rec ? T.danger : T.border}`, background: T.surface, cursor: 'pointer', display: 'grid', placeItems: 'center', boxShadow: rec ? `0 0 0 ${6 + level * 22}px color-mix(in srgb, ${T.danger} 22%, transparent)` : undefined, transition: 'box-shadow .08s', touchAction: 'none', opacity: state === 'starting' || state === 'stopping' ? 0.6 : 1 }}>
          {rec ? <span style={{ width: 28, height: 28, borderRadius: 6, background: T.danger }} /> : <span style={{ width: 34, height: 34, borderRadius: 17, background: T.danger }} />}
        </button>
        <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 22, fontWeight: 650 }}>{clock(nowT)}</div>
        <Muted>{state === 'starting' ? 'Starting…' : state === 'stopping' ? 'Finishing transcription…' : rec ? `Listening${pending ? ` · transcribing ${pending}` : ''}` : hold ? 'Hold to record' : sess.segments.length ? 'Tap to keep recording' : 'Tap to record'}</Muted>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[eng.id === 'mock' ? 'Simulated (no mic)' : eng.id, eng.model, s.processing.preset, s.processing.source === 'mic' ? undefined : s.processing.source === 'tab' ? 'tab audio' : 'mic + tab'].filter(Boolean).map((x) => <span key={x} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, border: `1px solid ${T.border}`, color: T.muted }}>{x}</span>)}
        </div>
        {!supportsCapture() && eng.id !== 'mock' && <Muted style={{ color: T.warn }}>Recording needs a secure page (https or localhost) and a microphone.</Muted>}
        {error && <div role="alert" style={{ color: T.danger, fontSize: 13, textAlign: 'center', maxWidth: 420 }}>{error}</div>}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontWeight: 650, display: 'flex', justifyContent: 'space-between' }}><span>Transcript</span><Muted>{wordCount(sess)} words</Muted></div>
        {hide ? <Muted>The transcript appears when you stop.</Muted> : !sess.segments.length && !partial ? <Muted>{rec ? 'Waiting for speech…' : 'Nothing recorded yet.'}</Muted> : null}
        {!hide && sess.segments.map((g) => (
          <div key={g.id} {...tg('seg:' + g.id)} style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '56px 54px 1fr auto', gap: compact ? 4 : 8, alignItems: 'start', padding: '8px 10px', borderRadius: 10, background: g.flag ? 'color-mix(in srgb, var(--vq-warn) 12%, transparent)' : T.bg, border: `1px solid ${g.flag ? T.warn : T.border}` }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: T.muted, fontSize: 12, minWidth: 40 }}>{clock(g.start)}</span>
              <button type="button" aria-label={`Speaker ${SPK[g.speaker].l}, tap to change`} onClick={() => upd(item.id, (x) => patchSegment(x, g.id, { speaker: g.speaker === 'me' ? 'them' : g.speaker === 'them' ? 'unknown' : 'me' }))} style={{ border: 0, borderRadius: 999, padding: '2px 10px', minHeight: 28, cursor: 'pointer', background: SPK[g.speaker].c, color: T.accentFg, font: 'inherit', fontSize: 12, fontWeight: 700 }}>{SPK[g.speaker].l}</button>
            </div>
            {compact ? null : <span />}
            {editing === g.id ? <textarea className="vq-input" autoFocus rows={2} defaultValue={g.text} aria-label="Edit transcript text" onBlur={(e) => { const v = e.target.value.trim(); if (v) upd(item.id, (x) => patchSegment(x, g.id, { text: v, edited: v !== g.text || g.edited })); setEditing(null) }} />
              : <div onClick={() => setEditing(g.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEditing(g.id)} style={{ cursor: 'text', lineHeight: 1.45 }}>{g.text}{g.edited && <span style={{ color: T.muted, fontSize: 11 }}> (edited)</span>}</div>}
            <div style={{ display: 'flex', gap: 2 }}>
              <button type="button" aria-label={g.flag ? 'Unflag' : 'Flag this moment'} aria-pressed={!!g.flag} onClick={() => upd(item.id, (x) => patchSegment(x, g.id, { flag: !g.flag }))} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 18, minWidth: 36, minHeight: 36, color: g.flag ? T.warn : T.muted }}>⚑</button>
              <button type="button" aria-label="Delete segment" onClick={() => upd(item.id, (x) => removeSegment(x, g.id))} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 18, minWidth: 36, minHeight: 36, color: T.muted }}>×</button>
            </div>
          </div>))}
        {!hide && partial && <div style={{ padding: '8px 10px', color: T.muted, fontStyle: 'italic' }}>{partial}…</div>}
        {audio[item.id] && <audio controls src={audio[item.id]} style={{ width: '100%' }} />}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontWeight: 650 }}>Notes</div>
        {s.quickNotes && <Row>{s.quickNotes.map((q) => <Chip key={q.id} {...tg('quicknote:' + q.id)} onClick={() => upd(item.id, (x) => addNote(x, { t: nowT, text: q.label, tag: q.label }))} style={q.color ? { borderColor: q.color } : undefined}>+ {q.label}</Chip>)}</Row>}
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="vq-input" value={note} placeholder={rec ? `Note at ${clock(nowT)}` : 'Add a note'} aria-label="Note text" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) { upd(item.id, (x) => addNote(x, { t: nowT, text: note.trim() })); setNote('') } }} />
          <Btn disabled={!note.trim()} onClick={() => { upd(item.id, (x) => addNote(x, { t: nowT, text: note.trim() })); setNote('') }}>Add</Btn>
        </div>
        {sess.notes.map((n) => <div key={n.id} {...tg('note:' + n.id)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 10px', borderRadius: 10, border: `1px solid ${T.border}` }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: T.muted, fontSize: 12 }}>{clock(n.t)}</span>{n.tag && <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, border: `1px solid ${T.border}`, color: T.muted }}>{n.tag}</span>}<span style={{ flex: 1 }}>{n.tag && n.text === n.tag ? '' : n.text}</span>
          <button type="button" aria-label="Remove note" onClick={() => upd(item.id, (x) => removeNote(x, n.id))} style={{ background: 'none', border: 0, cursor: 'pointer', color: T.muted, minWidth: 32, minHeight: 32, fontSize: 18 }}>×</button></div>)}
      </div>

      {outcomes && <div style={{ display: 'grid', gap: 8 }}><div style={{ fontWeight: 650 }}>Outcome</div>
        <Row>{outcomes.map((o) => <Chip key={o.id} on={sess.outcome === o.label} {...tg('outcome:' + o.id)} disabled={rec} onClick={() => { upd(item.id, (x) => ({ ...x, outcome: x.outcome === o.label ? undefined : o.label })); if (s.autoAdvance && sess.outcome !== o.label && idx < list.length - 1) setIdx(idx + 1) }}>{o.label}</Chip>)}</Row></div>}

      <Row style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
        <Btn tone="ghost" disabled={!hasContent(sess)} onClick={() => copy(toMarkdown([sess]), 'Markdown')}>Copy Markdown</Btn>
        <Btn tone="ghost" disabled={!value.sessions.some(hasContent)} onClick={() => copy(JSON.stringify(value.sessions.filter(hasContent), null, 2), 'JSON')}>Copy JSON{list.length > 1 ? ' (all)' : ''}</Btn>
        <Btn tone="ghost" disabled={!value.sessions.some(hasContent)} onClick={() => download('recording.md', toMarkdown(value.sessions))}>Download .md</Btn>
        {flash && <Muted>{flash}</Muted>}
      </Row>
    </div>)
}

const sum = (v: V) => { const d = v.sessions.filter(hasContent), words = d.reduce((a, x) => a + wordCount(x), 0), notes = d.reduce((a, x) => a + x.notes.length, 0); return { d, words, notes } }
export const recorder: Def<S, V> = {
  Component: RecorderView, initial: (s) => ({ sessions: items(s).map((i) => newSession(i.id, i.label)) }),
  label: (_s, v) => { const { d, words, notes } = sum(v); const oc = d.filter((x) => x.outcome).map((x) => `${x.label}: ${x.outcome}`); return `${d.length}/${v.sessions.length} recorded, ${words} words, ${notes} notes${oc.length ? '. ' + oc.join('; ') : ''}` },
  valid: (_s, v) => v.sessions.some(hasContent),
}
