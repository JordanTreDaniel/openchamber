import { useRef } from 'react'
import { barycentric, equalSplit, moveBoundary, outcomeValue, roundToSum, setPart } from '../core'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { Img, Muted, Row, SvgBox, imgMode } from '../prims'
import { series, T } from '../tokens'
import type { SpecOf } from '../types'

type S = SpecOf<'split'>; type V = Record<string, number>
const arr = (s: S, v: V) => s.parts.map((p) => v[p.id] ?? 0)
const rec = (s: S, a: number[]): V => Object.fromEntries(s.parts.map((p, i) => [p.id, a[i]]))
const col = (s: S, i: number) => s.parts[i].color ?? series(i)

function Bar({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const a = arr(s, v), mins = s.parts.map((p) => p.min ?? 0), maxs = s.parts.map((p) => p.max ?? s.total)
  return <SvgBox h={64} svgRef={ref}>{(W) => {
    const x0 = 14, w = W - 28; let c = 0
    return <g>{a.map((n, i) => { const x = x0 + (c / s.total) * w, ww = (n / s.total) * w; c += n; return <rect key={i} {...tg('seg:' + s.parts[i].id)} x={x} y={12} width={Math.max(ww, 0)} height={36} fill={col(s, i)} rx={i === 0 || i === a.length - 1 ? 8 : 2} /> })}
      {a.slice(0, -1).map((_, i) => { const cum = a.slice(0, i + 1).reduce((p, q) => p + q, 0), x = x0 + (cum / s.total) * w
        const h = bind({ onMove: (p) => onChange(rec(s, moveBoundary(a, i, ((p.x - x0) / w) * s.total, s.step, mins, maxs))) })
        return <g key={i}><circle cx={x} cy={30} r={24} fill="transparent" {...h} {...tg('divider:' + (i + 1))} /><circle cx={x} cy={30} r={11} fill={T.surface} stroke={T.text} strokeWidth={2} pointerEvents="none" /></g> })}</g>
  }}</SvgBox>
}
const arc = (c: number, r0: number, r1: number, a0: number, a1: number) => {
  const p = (r: number, a: number) => [c + r * Math.cos(a), c + r * Math.sin(a)], l = a1 - a0 > Math.PI ? 1 : 0
  if (a1 - a0 >= 2 * Math.PI - 1e-6) return `M${c + r1} ${c}A${r1} ${r1} 0 1 1 ${c - r1} ${c}A${r1} ${r1} 0 1 1 ${c + r1} ${c}M${c + r0} ${c}A${r0} ${r0} 0 1 0 ${c - r0} ${c}A${r0} ${r0} 0 1 0 ${c + r0} ${c}Z`
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${l} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${l} 0 ${p(r0, a0)}Z`
}
function Pie({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const a = arr(s, v), mins = s.parts.map((p) => p.min ?? 0), maxs = s.parts.map((p) => p.max ?? s.total)
  return <SvgBox h={(w) => Math.min(w, 300)} max={300} svgRef={ref}>{(W) => {
    const c = W / 2, r1 = c - 16, r0 = r1 * 0.58, T0 = -Math.PI / 2; let cum = 0
    return <g>{a.map((n, i) => { const a0 = T0 + (cum / s.total) * 2 * Math.PI; cum += n; const a1 = T0 + (cum / s.total) * 2 * Math.PI; return n > 0 ? <path key={i} {...tg('slice:' + s.parts[i].id)} d={arc(c, r0, r1, a0, a1)} fill={col(s, i)} stroke={T.surface} strokeWidth={2} /> : null })}
      <text x={c} y={c - 2} textAnchor="middle" style={{ fill: T.text, fontSize: 22, fontWeight: 650 }}>{s.total}{s.unit}</text><text x={c} y={c + 16} textAnchor="middle">drag the dots</text>
      {a.slice(0, -1).map((_, i) => { const ci = a.slice(0, i + 1).reduce((p, q) => p + q, 0), ang = T0 + (ci / s.total) * 2 * Math.PI, rm = (r0 + r1) / 2, x = c + rm * Math.cos(ang), y = c + rm * Math.sin(ang)
        const h = bind({ onMove: (p) => { let f = (Math.atan2(p.y - c, p.x - c) - T0) / (2 * Math.PI); f = ((f % 1) + 1) % 1; let tgt = f * s.total; if (Math.abs(tgt - ci) > s.total / 2) tgt += tgt < ci ? s.total : -s.total; onChange(rec(s, moveBoundary(a, i, tgt, s.step, mins, maxs))) } })
        return <g key={i}><circle cx={x} cy={y} r={24} fill="transparent" {...h} {...tg('divider:' + (i + 1))} /><circle cx={x} cy={y} r={11} fill={T.surface} stroke={T.text} strokeWidth={2} pointerEvents="none" /></g> })}</g>
  }}</SvgBox>
}
function Ternary({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const a = arr(s, v)
  return <SvgBox h={(w) => Math.min(w * 0.9, 330)} max={380} svgRef={ref}>{(W) => {
    const H = Math.min(W * 0.9, 330), A = { x: W / 2, y: 34 }, B = { x: 28, y: H - 34 }, C = { x: W - 28, y: H - 34 }
    const px = a[0] / s.total * A.x + a[1] / s.total * B.x + a[2] / s.total * C.x, py = a[0] / s.total * A.y + a[1] / s.total * B.y + a[2] / s.total * C.y
    const h = bind({ onMove: (p) => { const w = barycentric(p, A, B, C); onChange(rec(s, roundToSum(w, s.total, s.step))) } })
    return <g>
      <polygon {...tg('triangle')} points={`${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`} fill={T.bg} stroke={T.border} strokeWidth={2} {...h} />
      {[0.25, 0.5, 0.75].map((f) => <g key={f} stroke={T.border} strokeDasharray="3 4" pointerEvents="none"><line x1={A.x + (B.x - A.x) * f} y1={A.y + (B.y - A.y) * f} x2={A.x + (C.x - A.x) * f} y2={A.y + (C.y - A.y) * f} /></g>)}
      {[A, B, C].map((P, i) => <g key={i} {...tg('corner:' + s.parts[i].id)}><circle cx={P.x} cy={P.y} r={7} fill={col(s, i)} /><text x={P.x} y={i ? P.y + 22 : P.y - 12} textAnchor="middle" style={{ fill: T.text, fontSize: 12, fontWeight: 600 }}>{s.parts[i].label} {a[i]}{s.unit}</text></g>)}
      <circle cx={px} cy={py} r={24} fill="transparent" {...h} /><circle cx={px} cy={py} r={11} fill={T.text} stroke={T.surface} strokeWidth={3} pointerEvents="none" />
    </g>
  }}</SvgBox>
}
function SplitView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const a = arr(s, value); const im = imgMode(s.parts, s.images)
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {s.skin === 'pie' ? <Pie s={s} v={value} onChange={onChange} /> : s.skin === 'ternary' && s.parts.length === 3 ? <Ternary s={s} v={value} onChange={onChange} /> : <Bar s={s} v={value} onChange={onChange} />}
      <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        {s.parts.map((p, i) => <label key={p.id} {...tg('part:' + p.id)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{im(p) !== null ? <Img size={26} radius={7} src={im(p) || undefined} label={p.label} style={{ outline: `2px solid ${col(s, i)}` }} /> : <span style={{ width: 12, height: 12, borderRadius: 4, background: col(s, i), flex: 'none' }} />}<span style={{ flex: 1 }}>{p.label}</span>
          <input className="vq-input" style={{ width: 76, textAlign: 'right' }} type="number" inputMode="decimal" min={0} max={s.total} step={s.step} value={a[i]} aria-label={p.label} onChange={(e) => onChange(rec(s, setPart(a, i, Number(e.target.value) || 0, s.total, s.step)))} /></label>)}
      </div>
      {s.outcomes && <Row style={{ gap: 8 }}>{s.outcomes.map((o) => <div key={o.id} {...tg('outcome:' + o.id)} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '6px 12px' }}><div style={{ fontSize: 18, fontWeight: 650 }}>{Math.round(outcomeValue(o, value) * 10) / 10}{o.unit ?? ''}</div><Muted style={{ fontSize: 11 }}>{o.label}</Muted></div>)}</Row>}
    </div>)
}
export const split: Def<S, V> = {
  Component: SplitView, initial: (s) => rec(s, equalSplit(s.parts.length, s.total, s.step)),
  label: (s, v) => s.parts.map((p) => `${p.label} ${v[p.id]}${s.unit}`).join(', '), valid: (s, v) => arr(s, v).reduce((p, q) => p + q, 0) === s.total,
}
