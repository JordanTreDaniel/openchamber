import { useEffect, useRef, useState } from 'react'
import type { Def } from '../Frame'
import { useTarget, useVQ } from '../hooks'
import { Body, Chip, Img, Muted, imgMode } from '../prims'
import { T } from '../tokens'
import type { Option, SpecOf } from '../types'

type S = SpecOf<'pick'>
/** Press-and-hold to commit (friction for risky choices). */
function useHold(ms: number, done: () => void) {
  const [p, setP] = useState(0); const raf = useRef(0); const t0 = useRef(0)
  const stop = () => { cancelAnimationFrame(raf.current); setP(0) }
  const start = () => { t0.current = performance.now(); const tick = () => { const v = (performance.now() - t0.current) / ms; if (v >= 1) { setP(0); done() } else { setP(v); raf.current = requestAnimationFrame(tick) } }; raf.current = requestAnimationFrame(tick) }
  useEffect(() => stop, [])
  return { p, bind: { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') done() } } }
}

function OptionView({ o, s, on, onPick, excl, img }: { o: Option; s: S; on: boolean; onPick: () => void; excl: boolean; img: string | null }) {
  const tg = useTarget(); const { compact } = useVQ()
  const hold = useHold(900, onPick)
  const [typing, setTyping] = useState(false); const [typed, setTyped] = useState('')
  const need = s.confirmText ?? o.label
  const click = () => { if (s.friction === 'none') onPick(); else if (s.friction === 'type') setTyping(!typing) }
  const common = { ...tg('option:' + o.id), 'aria-pressed': on, onClick: click, ...(s.friction === 'hold' ? hold.bind : {}) }
  const mark = excl && on ? { textDecoration: 'line-through', opacity: 0.6 } : {}
  if (s.skin === 'chips') return <Chip on={on} {...common}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{img !== null && <Img size={24} radius={12} src={img || undefined} label={o.label} />}{o.recommended ? '★ ' : ''}{o.label}</span></Chip>
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button type="button" className="vq-opt" {...common} style={{ position: 'relative', overflow: 'hidden', width: '100%', display: 'flex', gap: 12, alignItems: s.skin === 'list' ? 'center' : 'flex-start', flexDirection: s.skin === 'cards' && !compact ? 'column' : 'row', minHeight: s.skin === 'cards' ? 88 : 48, borderColor: on ? (excl ? T.danger : T.accent) : undefined }}>
        {s.friction === 'hold' && hold.p > 0 && <span style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${hold.p * 100}%`, background: T.accent }} />}
        {img !== null && (s.skin === 'cards' && !compact ? <Img ratio="16/10" src={img || undefined} label={o.label} style={{ width: '100%' }} /> : <Img size={s.skin === 'cards' ? 56 : 44} src={img || undefined} label={o.label} />)}
        {img === null && o.color && <span style={{ width: 14, height: 14, borderRadius: 4, background: o.color, flex: 'none', marginTop: 4 }} />}
        <span style={{ display: 'grid', gap: 4, flex: 1 }}>
          <span style={{ fontWeight: 600, ...mark }}>{o.label}{o.recommended && <span style={{ marginLeft: 8, fontSize: 11, color: T.accent, fontWeight: 500 }}>recommended</span>}</span>
          {o.detail && <Body c={o.detail} />}
        </span>
        {s.skin === 'list' && <span aria-hidden style={{ width: 20, height: 20, flex: 'none', borderRadius: s.multiple ? 5 : 10, border: `2px solid ${on ? T.accent : T.border}`, background: on ? T.accent : 'transparent' }} />}
      </button>
      {typing && !on && <input className="vq-input" autoFocus value={typed} placeholder={`Type "${need}" to confirm`} aria-label="Confirm by typing" onChange={(e) => { setTyped(e.target.value); if (e.target.value === need) { onPick(); setTyping(false); setTyped('') } }} />}
      {s.friction === 'hold' && !on && <Muted style={{ fontSize: 11 }}>Press and hold to choose</Muted>}
    </div>
  )
}

function PickView({ spec: s, value, onChange }: { spec: S; value: string[]; onChange: (v: string[]) => void }) {
  const im = imgMode(s.options, s.images)
  const multi = s.multiple || s.mode === 'exclude'
  const toggle = (id: string) => {
    if (!multi) return onChange([id])
    if (value.includes(id)) return onChange(value.filter((x) => x !== id))
    if (s.max != null && value.length >= s.max) return
    onChange([...value, id])
  }
  const layout = s.skin === 'chips' ? { display: 'flex', flexWrap: 'wrap' as const, gap: 8 } : s.skin === 'list' ? { display: 'grid', gap: 8 } : { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))' }
  return (
    <div>
      <div style={layout} role={multi ? 'group' : 'radiogroup'}>{s.options.map((o) => <OptionView key={o.id} img={im(o)} o={o} s={s} excl={s.mode === 'exclude'} on={value.includes(o.id)} onPick={() => toggle(o.id)} />)}</div>
      {(multi || s.min != null) && <Muted style={{ marginTop: 8 }}>{s.mode === 'exclude' ? 'Tap the ones to rule out. ' : ''}{value.length} selected{s.max != null ? ` of up to ${s.max}` : ''}</Muted>}
    </div>
  )
}
const lbl = (s: S, v: string[]) => (v.length ? (s.mode === 'exclude' ? 'Exclude: ' : '') + v.map((id) => s.options.find((o) => o.id === id)?.label ?? id).join(', ') : 'None')
export const pick: Def<S, string[]> = {
  Component: PickView, initial: (s) => s.options.filter((o) => o.recommended && s.mode === 'include' && !s.multiple && s.friction === 'none').map((o) => o.id).slice(0, 1),
  label: lbl, valid: (s, v) => (s.mode === 'exclude' || v.length >= (s.min ?? 1)) && (s.max == null || v.length <= s.max),
}
