import { useEffect, useRef, useState } from 'react'
import type { Def } from '../Frame'
import { useTarget } from '../hooks'
import { Btn, Img, Muted, SvgBox, SvgImg, imgMode } from '../prims'
import { series, T } from '../tokens'
import type { SpecOf, Values } from '../types'

type S = SpecOf<'random'>; type V = Values['random']
const ease = (t: number) => 1 - Math.pow(1 - t, 4)
function useSpin(n: number, onDone: (i: number) => void) {
  const [a, setA] = useState(0); const [busy, setBusy] = useState(false); const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const spin = (turnsDeg: (i: number) => number) => {
    if (busy) return; setBusy(true)
    const i = Math.floor(Math.random() * n), from = a, to = from + turnsDeg(i), t0 = performance.now(), dur = 3200
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); setA(from + (to - from) * ease(p)); if (p < 1) raf.current = requestAnimationFrame(tick); else { setBusy(false); onDone(i) } }
    raf.current = requestAnimationFrame(tick)
  }
  return { a, busy, spin }
}
function RandomView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const im = imgMode(s.options, s.images); const n = s.options.length, seg = 360 / n
  const done = (i: number) => onChange({ picked: s.options[i].id })
  const sp = useSpin(n, done)
  const picked = s.options.find((o) => o.id === value.picked)
  const go = () => {
    if (s.skin === 'wheel') sp.spin((i) => { const cur = ((sp.a % 360) + 360) % 360; return 360 * 5 + ((360 - ((i + 0.5) * seg + cur)) % 360 + 360) % 360 })
    else sp.spin((i) => 5 * n * 52 + (((i - ((Math.round(sp.a / 52) % n) + n) % n) + n) % n) * 52)
  }
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
      {s.skin === 'wheel' ? (
        <SvgBox h={(w) => Math.min(w, 340)} max={340}>{(W) => { const r = W / 2 - 14, c = W / 2; return (
          <g>
            <g transform={`rotate(${sp.a} ${c} ${c})`}>{s.options.map((o, i) => {
              const a0 = (i * seg - 90) * Math.PI / 180, a1 = ((i + 1) * seg - 90) * Math.PI / 180, mid = (i + 0.5) * seg - 90
              const d = `M${c} ${c}L${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)}A${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)}Z`
              return <g key={o.id} {...tg('wedge:' + o.id)}><path d={d} fill={o.color ?? series(i)} opacity={0.9} stroke={T.surface} strokeWidth={2} />
                <text transform={`rotate(${mid} ${c} ${c}) translate(${c + r * 0.5} ${c})`} textAnchor="middle" dominantBaseline="middle" style={{ fill: '#0b0b0c', fontSize: 12, fontWeight: 600 }}>{o.label.length > 12 ? o.label.slice(0, 11) + '…' : o.label}</text>{im(o) !== null && <g transform={`rotate(${mid} ${c} ${c})`}><SvgImg cx={c + r * 0.84} cy={c} size={Math.max(18, Math.min(34, r * 0.3))} src={im(o) || undefined} label={o.label} /></g>}</g> })}</g>
            <polygon points={`${c - 10},2 ${c + 10},2 ${c},26`} fill={T.text} /><circle cx={c} cy={c} r={14} fill={T.surface} stroke={T.border} />
          </g>) }}</SvgBox>
      ) : (
        <div {...tg('reel')} style={{ height: 156, width: '100%', maxWidth: 360, overflow: 'hidden', position: 'relative', border: `1px solid ${T.border}`, borderRadius: 12, background: T.bg }} aria-live="polite">
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 52, marginTop: -26, borderTop: `2px solid ${T.accent}`, borderBottom: `2px solid ${T.accent}`, zIndex: 1, pointerEvents: 'none' }} />
          <div style={{ transform: `translateY(${52 - (n + (((sp.a / 52) % n) + n) % n) * 52}px)` }}>
            {[...s.options, ...s.options, ...s.options].map((o, i) => <div key={i} style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 18, gap: 10 }}>{im(o) !== null && <Img size={36} radius={8} src={im(o) || undefined} label={o.label} />}{o.label}</div>)}
          </div>
        </div>
      )}
      {picked && !sp.busy && <div style={{ fontSize: 20, fontWeight: 700 }}>{picked.label}</div>}
      <Btn tone="primary" onClick={go} disabled={sp.busy}>{picked ? 'Spin again' : 'Spin'}</Btn>
      <Muted>Leave it to chance. You can spin again until you like the result.</Muted>
    </div>
  )
}
export const random: Def<S, V> = { Component: RandomView, initial: () => ({ picked: null }), label: (s, v) => `Random: ${s.options.find((o) => o.id === v.picked)?.label ?? '?'}`, valid: (_s, v) => v.picked != null }
