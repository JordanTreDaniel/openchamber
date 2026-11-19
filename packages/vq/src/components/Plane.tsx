import { useRef } from 'react'
import { clamp } from '../core'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { SvgBox, SvgImg, imgMode } from '../prims'
import { series, T } from '../tokens'
import type { Pt, SpecOf } from '../types'

type S = SpecOf<'plane'>; type V = Record<string, Pt>
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
function PlaneView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const im = imgMode(s.items, s.images); const free = s.mode === 'free'
  return (
    <SvgBox h={(w) => clamp(w * 0.72, 280, 480)} svgRef={ref}>{(W) => {
      const H = clamp(W * 0.72, 280, 480), L = free ? 12 : 38, R = 12, Tp = 12, B = free ? 12 : 34, w = W - L - R, h = H - Tp - B
      const px = (p: Pt) => ({ x: L + p.x * w, y: Tp + (1 - p.y) * h }), q = s.quadrants
      return (
        <g>
          <rect {...tg('plane')} x={L} y={Tp} width={w} height={h} rx={10} fill={T.bg} stroke={T.border} />
          {!free && <><line x1={L + w / 2} x2={L + w / 2} y1={Tp} y2={Tp + h} stroke={T.border} strokeDasharray="4 4" /><line x1={L} x2={L + w} y1={Tp + h / 2} y2={Tp + h / 2} stroke={T.border} strokeDasharray="4 4" /></>}
          {!free && q && [[0, 0, 'start'], [1, 0, 'end'], [0, 1, 'start'], [1, 1, 'end']].map(([cx, cy, an], i) => <text key={i} {...tg('quadrant:' + i)} x={L + (cx as number) * w + ((cx as number) ? -10 : 10)} y={Tp + (cy as number) * h + ((cy as number) ? -10 : 20)} textAnchor={an as 'start' | 'end'} style={{ fontSize: 12, fill: T.muted, opacity: 0.8 }}>{q[i]}</text>)}
          {!free && <><text x={L + w / 2} y={H - 8} textAnchor="middle" style={{ fill: T.text, fontSize: 12 }}>{s.xAxis.label}{s.xAxis.high ? ` → ${s.xAxis.high}` : ''}</text><text x={L} y={H - 8} style={{ fontSize: 11 }}>{s.xAxis.low}</text>
            <text transform={`translate(12 ${Tp + h / 2}) rotate(-90)`} textAnchor="middle" style={{ fill: T.text, fontSize: 12 }}>{s.yAxis.label}{s.yAxis.high ? ` → ${s.yAxis.high}` : ''}</text></>}
          {s.items.map((it, i) => { const p = px(value[it.id] ?? { x: 0.5, y: 0.5 }); const hd = bind({ onMove: (e) => onChange({ ...value, [it.id]: { x: clamp((e.x - L) / w, 0, 1), y: clamp(1 - (e.y - Tp) / h, 0, 1) } }) })
            return <g key={it.id} {...tg('item:' + it.id)}><circle cx={p.x} cy={p.y} r={26} fill="transparent" {...hd} /><circle cx={p.x} cy={p.y} r={im(it) !== null ? 19 : 15} fill={it.color ?? series(i)} stroke={T.surface} strokeWidth={2} pointerEvents="none" />
              {im(it) !== null ? <SvgImg cx={p.x} cy={p.y} size={32} src={im(it) || undefined} label={it.label} /> : <text x={p.x} y={p.y + 4} textAnchor="middle" pointerEvents="none" style={{ fill: '#0b0b0c', fontSize: 12, fontWeight: 700 }}>{it.label.slice(0, 1).toUpperCase()}</text>}
              <text x={p.x + (im(it) !== null ? 26 : 20)} y={p.y + 4} pointerEvents="none" style={{ fill: T.text, fontSize: 12 }}>{cut(it.label, 18)}</text></g> })}
        </g>)
    }}</SvgBox>)
}
export const plane: Def<S, V> = {
  Component: PlaneView,
  initial: (s) => Object.fromEntries(s.items.map((it, i) => [it.id, { x: it.x ?? (i + 1) / (s.items.length + 1), y: it.y ?? 0.5 }])),
  label: (s, v) => s.items.map((it) => `${it.label} (${s.xAxis.label} ${Math.round(v[it.id].x * 100)}, ${s.yAxis.label} ${Math.round(v[it.id].y * 100)})`).join('; '),
  valid: () => true,
}
