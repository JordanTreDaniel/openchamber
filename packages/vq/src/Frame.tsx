import { useMemo, useState, type ReactNode } from 'react'
import { VQContext, useSize } from './hooks'
import { attachOutput } from './output'
import { Btn, Chip, Muted } from './prims'
import { T } from './tokens'
import { ThemeProvider, useInTheme, type ThemeProviderProps } from './theme'
import type { Answer, Comment, Spec, SpecType, Values } from './types'

export interface Def<S extends Spec = Spec, V = unknown> {
  Component: (p: { spec: S; value: V; onChange: (v: V) => void }) => ReactNode
  initial: (spec: S) => V
  label: (spec: S, value: V) => string
  valid: (spec: S, value: V) => boolean
}

export interface FrameProps<S extends Spec> extends Pick<ThemeProviderProps, 'theme' | 'scheme'> {
  spec: S; def: Def<S, any>; defaultValue?: Values[S['type']]
  onAnswer: (a: Answer<S['type']>) => void
  className?: string
}

/** Wraps any component with title, comment mode, note, confidence, skip and submit. */
export function Frame<S extends Spec>({ spec, def, defaultValue, onAnswer, theme, scheme, className }: FrameProps<S>) {
  const nested = useInTheme()
  const [value, setValue] = useState<any>(() => defaultValue ?? def.initial(spec))
  const [cm, setCm] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [draft, setDraft] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [text, setText] = useState('')
  const [conf, setConf] = useState<number | null>(null)
  const [box, width] = useSize<HTMLDivElement>(640)
  const ctx = useMemo(() => ({ commentMode: cm, selected: sel, select: setSel, compact: width < 520, width }), [cm, sel, width])

  // No output destination: answer now, exactly as before. With one: write the files first, so the envelope can
  // carry the location, but never let a failed write cost the answer (attachOutput does not throw).
  const submit = (skipped: boolean) => {
    const a: Answer<S['type']> = {
      v: 1, id: spec.id, type: spec.type as S['type'], value: value as Values[S['type']],
      label: skipped ? 'Skipped' : def.label(spec, value), confidence: conf, skipped, comments, text: text.trim() || null,
    }
    if (!spec.output) { onAnswer(a); return }
    void attachOutput(spec, a).then((x) => onAnswer(x), () => onAnswer(a))
  }
  const ok = def.valid(spec, value)
  const Comp = def.Component as unknown as (p: { spec: S; value: any; onChange: (v: any) => void }) => any
  const inner = (
    <VQContext.Provider value={ctx}>
      <div ref={box} className={cm ? 'vq-cm ' + (className ?? '') : className} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: ctx.compact ? 12 : 18, boxShadow: T.shadow, display: 'grid', gap: 12, width: '100%' }}>
        {(spec.title || spec.prompt) && (
          <div>
            {spec.title && <div style={{ fontWeight: 650, fontSize: ctx.compact ? 16 : 17 }}>{spec.title}</div>}
            {spec.prompt && <Muted style={{ fontSize: 14, marginTop: 2 }}>{spec.prompt}</Muted>}
          </div>
        )}
        {spec.explain && <details><summary style={{ color: T.muted, cursor: 'pointer', fontSize: 13 }}>Why am I being asked?</summary><Muted style={{ marginTop: 6 }}>{spec.explain}</Muted></details>}
        <div><Comp spec={spec} value={value} onChange={setValue} /></div>
        {cm && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Muted style={{ whiteSpace: 'nowrap' }}>{sel ? `On: ${sel}` : 'Tap any element to comment on it'}</Muted>
            <input className="vq-input" style={{ flex: 1, minWidth: 140 }} value={draft} disabled={!sel} placeholder="Your feedback" aria-label="Comment text" onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && sel && draft.trim()) { setComments([...comments, { target: sel, text: draft.trim() }]); setDraft('') } }} />
            <Btn disabled={!sel || !draft.trim()} onClick={() => { setComments([...comments, { target: sel!, text: draft.trim() }]); setDraft('') }}>Add</Btn>
          </div>
        )}
        {comments.length > 0 && <div style={{ display: 'grid', gap: 4 }}>{comments.map((c, i) => (
          <Muted key={i}><b style={{ color: T.text }}>{c.target}</b>: {c.text}{' '}
            <button type="button" className="vq-btn" data-tone="ghost" style={{ padding: '0 6px', minHeight: 24 }} aria-label="Remove comment" onClick={() => setComments(comments.filter((_, j) => j !== i))}>×</button></Muted>))}</div>}
        {noteOpen && <textarea className="vq-input" rows={2} value={text} placeholder="Add a note for the agent" aria-label="Note" onChange={(e) => setText(e.target.value)} />}
        {spec.allowConfidence && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><Muted>How sure?</Muted>
            {[['Guessing', 0.25], ['Fairly', 0.6], ['Certain', 0.95]].map(([l, v]) => <Chip key={l as string} on={conf === v} onClick={() => setConf(conf === v ? null : (v as number))}>{l}</Chip>)}</div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {spec.allowComments && <Btn tone="ghost" aria-pressed={cm} onClick={() => { setCm(!cm); setSel(null) }}>{cm ? 'Done commenting' : 'Comment'}</Btn>}
          {spec.allowText && <Btn tone="ghost" onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? 'Hide note' : 'Note'}</Btn>}
          <span style={{ flex: 1 }} />
          {spec.allowSkip && <Btn tone="ghost" onClick={() => submit(true)}>Skip</Btn>}
          <Btn tone="primary" disabled={!ok} onClick={() => submit(false)}>Submit</Btn>
        </div>
      </div>
    </VQContext.Provider>
  )
  return nested ? inner : <ThemeProvider theme={theme} scheme={scheme}>{inner}</ThemeProvider>
}
export type { SpecType }
