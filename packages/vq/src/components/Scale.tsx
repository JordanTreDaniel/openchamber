import { useRef } from 'react'
import { clamp as cl, nearestKey } from '../core'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { Chip, Muted, Row, SvgBox, snap } from '../prims'
import { T } from '../tokens'
import type { SpecOf } from '../types'

type S = SpecOf<'scale'>; type V = number[] | Record<string, number>
const nums = (v: V) => (Array.isArray(v) ? v : [])

function Slider({ s, v, onChange }: { s: S; v: number[]; onChange: (v: number[]) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const near = useRef(0)
  const { min, max, step } = s; const bins = s.backdrop?.bins
  const set = (i: number, val: number) => { const n = v.slice(); n[i] = val; if (n.length === 2) n.sort((a, b) => a - b); onChange(n) }
  const track = bins ? 130 : 34
  return (
    <SvgBox h={bins ? 176 : 78} svgRef={ref}>{(W) => {
      const x0 = 22, x1 = W - 22, X = (q: number) => x0 + ((q - min) / (max - min)) * (x1 - x0), Vx = (x: number) => cl(snap(min + ((x - x0) / (x1 - x0)) * (max - min), step, min), min, max)
      const lo = v.length === 2 ? v[0] : min, hi = v.length === 2 ? v[1] : v[0], bw = Math.max(2, ((x1 - x0) / ((max - min) / step || 1)) * 0.78)
      const mx = Math.max(...(bins ?? [1]), 1), tk = Math.min(6, Math.floor((max - min) / step) + 1), ticks = Array.from({ length: tk }, (_, i) => min + ((max - min) * i) / Math.max(tk - 1, 1))
      const pick = bind({ onStart: (p) => { const q = Vx(p.x); near.current = v.length === 2 && Math.abs(q - v[1]) < Math.abs(q - v[0]) ? 1 : 0; set(near.current, q) }, onMove: (p) => set(near.current, Vx(p.x)) })
      return (
        <g>
          {bins?.map((n, i) => { const q = min + i * step, h = (n / mx) * 84; return <rect key={i} {...tg('bin:' + q)} x={X(q) - bw / 2} y={110 - h} width={bw} height={Math.max(h, 1)} rx={2} fill={q >= lo && q <= hi ? T.accent : T.border} opacity={q >= lo && q <= hi ? 0.9 : 1} /> })}
          <line x1={x0} x2={x1} y1={track} y2={track} stroke={T.border} strokeWidth={6} strokeLinecap="round" />
          <line x1={X(lo)} x2={X(hi)} y1={track} y2={track} stroke={T.accent} strokeWidth={6} strokeLinecap="round" />
          <rect {...tg('track')} x={x0 - 10} y={track - 22} width={x1 - x0 + 20} height={44} fill="transparent" {...pick} />
          {ticks.map((t) => <text key={t} x={X(t)} y={track + 34} textAnchor="middle" style={{ fontSize: 11 }}>{Number.isInteger(t) ? t : t.toFixed(1)}</text>)}
          {s.recommended != null && <g {...tg('recommended')}><polygon points={`${X(s.recommended) - 5},${track - 16} ${X(s.recommended) + 5},${track - 16} ${X(s.recommended)},${track - 8}`} fill={T.ok} /></g>}
          {v.map((val, i) => { const h = bind({ onMove: (p) => set(i, Vx(p.x)) }); return (
            <g key={i} role="slider" tabIndex={0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={val} aria-label={s.handles === 2 ? (i ? 'Maximum' : 'Minimum') : 'Value'}
              onKeyDown={(e) => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0; if (d) { e.preventDefault(); set(i, cl(val + d, min, max)) } }}>
              <circle cx={X(val)} cy={track} r={24} fill="transparent" {...h} {...tg('handle:' + i)} /><circle cx={X(val)} cy={track} r={12} fill={T.accent} stroke={T.surface} strokeWidth={3} pointerEvents="none" />
              <text x={X(val)} y={track - 20} textAnchor="middle" style={{ fill: T.text, fontWeight: 600, fontSize: 12 }}>{val}{s.unit ? ' ' + s.unit : ''}</text>
            </g>) })}
        </g>)
    }}</SvgBox>
  )
}
function Radar({ s, v, onChange }: { s: S; v: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const ax = s.axes ?? []; const n = ax.length
  return (
    <SvgBox h={(w) => Math.min(w, 380)} max={420} svgRef={ref}>{(W) => {
      const c = W / 2, r = W / 2 - 44, ang = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2
      const rng = (a: typeof ax[number]) => [a.min ?? s.min, a.max ?? s.max] as const
      const P = (i: number, f: number) => [c + r * f * Math.cos(ang(i)), c + r * f * Math.sin(ang(i))]
      const frac = (i: number) => { const [a, b] = rng(ax[i]); return ((v[ax[i].id] ?? a) - a) / (b - a) }
      return (
        <g>
          {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={ax.map((_, i) => P(i, f).join(',')).join(' ')} fill="none" stroke={T.border} />)}
          {ax.map((a, i) => <g key={a.id}><line x1={c} y1={c} x2={P(i, 1)[0]} y2={P(i, 1)[1]} stroke={T.border} /><text {...tg('axis:' + a.id)} x={P(i, 1.14)[0]} y={P(i, 1.14)[1]} textAnchor="middle" dominantBaseline="middle" style={{ fill: T.text, fontSize: 12 }}>{a.label}</text></g>)}
          <polygon points={ax.map((_, i) => P(i, frac(i)).join(',')).join(' ')} fill={T.accent} fillOpacity={0.22} stroke={T.accent} strokeWidth={2} />
          {ax.map((a, i) => { const [lo, hi] = rng(a); const [x, y] = P(i, frac(i)); const h = bind({ onMove: (p) => { const d = [Math.cos(ang(i)), Math.sin(ang(i))], f = cl(((p.x - c) * d[0] + (p.y - c) * d[1]) / r, 0, 1); onChange({ ...v, [a.id]: cl(snap(lo + f * (hi - lo), s.step, lo), lo, hi) }) } }); return (
            <g key={a.id}><circle cx={x} cy={y} r={24} fill="transparent" {...h} {...tg('vertex:' + a.id)} /><circle cx={x} cy={y} r={8} fill={T.accent} stroke={T.surface} strokeWidth={2} pointerEvents="none" /></g>) })}
        </g>)
    }}</SvgBox>)
}
function ScaleView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const v = nums(value)
  if (s.skin === 'radar') return <Radar s={s} v={value as Record<string, number>} onChange={onChange} />
  const stepsN = Math.round((s.max - s.min) / s.step) + 1
  const row = (labels: boolean) => labels && (s.lowLabel || s.highLabel) ? <Row style={{ justifyContent: 'space-between' }}><Muted>{s.lowLabel}</Muted><Muted>{s.highLabel}</Muted></Row> : null
  const cons = nearestKey(s.consequence, v[0])
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {s.skin === 'chips' && s.handles === 1 && stepsN <= 21 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <Row>{Array.from({ length: stepsN }, (_, i) => s.min + i * s.step).map((q) => <Chip key={q} on={v[0] === q} {...tg('chip:' + q)} style={{ minWidth: 44, textAlign: 'center' }} onClick={() => onChange([q])}>{q}</Chip>)}</Row>{row(true)}
        </div>
      ) : s.skin === 'stars' && stepsN <= 12 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <Row style={{ gap: 4 }}>{Array.from({ length: stepsN }, (_, i) => s.min + i * s.step).map((q) => (
            <button key={q} type="button" aria-label={`${q} of ${s.max}`} aria-pressed={(v[0] ?? s.min - 1) >= q} {...tg('star:' + q)} onClick={() => onChange([q])} style={{ background: 'none', border: 0, padding: 4, cursor: 'pointer', width: 44, height: 44, fontSize: 32, lineHeight: 1, color: (v[0] ?? s.min - 1) >= q ? T.warn : T.border }}>★</button>))}</Row>{row(true)}
        </div>
      ) : <div>{row(true)}<Slider s={s} v={v} onChange={onChange} /></div>}
      {cons && <Row style={{ gap: 8 }}>{Object.entries(cons).map(([k, val]) => <div key={k} {...tg('metric:' + k)} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '6px 12px' }}><div style={{ fontSize: 18, fontWeight: 650 }}>{val}</div><Muted style={{ fontSize: 11 }}>{k}</Muted></div>)}</Row>}
    </div>)
}
const mid = (s: S) => snap(s.min + (s.max - s.min) / 2, s.step, s.min)
export const scale: Def<S, V> = {
  Component: ScaleView,
  initial: (s) => s.skin === 'radar' ? Object.fromEntries((s.axes ?? []).map((a) => [a.id, snap(((a.min ?? s.min) + (a.max ?? s.max)) / 2, s.step, a.min ?? s.min)])) : s.default != null ? (Array.isArray(s.default) ? s.default : [s.default]) : s.handles === 2 ? [snap(s.min + (s.max - s.min) / 4, s.step, s.min), snap(s.min + ((s.max - s.min) * 3) / 4, s.step, s.min)] : [s.recommended ?? mid(s)],
  label: (s, v) => Array.isArray(v) ? v.join('–') + (s.unit ? ' ' + s.unit : '') : (s.axes ?? []).map((a) => `${a.label} ${v[a.id]}`).join(', '),
  valid: () => true,
}
