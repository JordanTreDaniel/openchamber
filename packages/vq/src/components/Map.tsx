import { useRef, useState } from 'react'
import { clamp, kmToPx, project, pxToKm, unproject, type Bounds } from '../core'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { Btn, Muted, Row, SvgBox, SvgImg, imgMode } from '../prims'
import { T } from '../tokens'
import type { SpecOf, Values } from '../types'

type S = SpecOf<'map'>; type V = Values['map']; type View = { lat: number; lng: number; span: number }
const rad = (d: number) => (d * Math.PI) / 180
const boundsOf = (v: View, W: number, H: number): Bounds => { const ls = (v.span * (W / H)) / Math.max(Math.cos(rad(v.lat)), 0.2); return { minLat: v.lat - v.span / 2, maxLat: v.lat + v.span / 2, minLng: v.lng - ls / 2, maxLng: v.lng + ls / 2 } }
const nice = (x: number) => { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p }
function initView(s: S): View {
  const pts = [...s.places, ...(s.shapes ? [] : [])]
  const b = s.bounds
  if (b) return { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2, span: Math.max(b.maxLat - b.minLat, 0.01) }
  if (!pts.length) return { lat: 20, lng: 0, span: 100 }
  const la = pts.map((p) => p.lat), ln = pts.map((p) => p.lng), c = Math.cos(rad((Math.min(...la) + Math.max(...la)) / 2))
  return { lat: (Math.min(...la) + Math.max(...la)) / 2, lng: (Math.min(...ln) + Math.max(...ln)) / 2, span: Math.max((Math.max(...la) - Math.min(...la)) * 1.7, ((Math.max(...ln) - Math.min(...ln)) * c * 1.7) / 1.6, 0.02) }
}
function MapView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const imM = imgMode(s.places, s.images); const [view, setView] = useState(() => initView(s)); const v0 = useRef(view)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <SvgBox h={(w) => clamp(w * 0.62, 260, 440)} svgRef={ref}>{(W) => {
          const H = clamp(W * 0.62, 260, 440), b = boundsOf(view, W, H), P = (lat: number, lng: number) => project(lat, lng, b, W, H), step = nice(view.span / 4)
          const bg = bind({ onStart: () => { v0.current = view }, onMove: (p) => { const k = view.span / H; setView({ ...v0.current, lat: clamp(v0.current.lat + p.dy * k, -85, 85), lng: v0.current.lng - (p.dx * k) / Math.max(Math.cos(rad(v0.current.lat)), 0.2) }) },
            onEnd: (p) => { if (Math.hypot(p.dx, p.dy) > 6 || (s.mode !== 'drop' && s.mode !== 'radius')) return; const q = unproject(p.x, p.y, b, W, H); onChange({ points: [{ lat: q.lat, lng: q.lng }], radiusKm: value.radiusKm ?? Math.round(s.maxRadiusKm / 4) }) } })
          const pts = value.points; const place = (id?: string) => s.places.find((p) => p.id === id)
          const pin = (id: string, la: number, ln: number, label: string, on: boolean, n?: number, img: string | null = null) => { const q = P(la, ln); return (
            <g key={id} {...tg('place:' + id)} onClick={() => { if (s.mode === 'pick') onChange({ points: s.multiple ? (on ? pts.filter((x) => x.id !== id) : [...pts, { id, lat: la, lng: ln }]) : [{ id, lat: la, lng: ln }] }); if (s.mode === 'route') onChange({ points: [...pts, { id, lat: la, lng: ln }] }) }} style={{ cursor: 'pointer' }}>
              <circle cx={q.x} cy={q.y} r={22} fill="transparent" />{img !== null ? <><circle cx={q.x} cy={q.y} r={on ? 20 : 17} fill={T.surface} stroke={on ? T.accent : T.border} strokeWidth={on ? 4 : 2} /><SvgImg cx={q.x} cy={q.y} size={on ? 34 : 30} src={img || undefined} label={label} /></> : <circle cx={q.x} cy={q.y} r={on ? 11 : 8} fill={on ? T.accent : T.surface} stroke={on ? T.surface : T.accent} strokeWidth={3} />}
              {n != null && <text x={q.x} y={q.y + 4} textAnchor="middle" style={{ fill: T.accentFg, fontWeight: 700, fontSize: 11 }}>{n}</text>}<text x={q.x + (img !== null ? 24 : 14)} y={q.y + 4} style={{ fill: T.text, fontSize: 12, paintOrder: 'stroke', stroke: T.surface, strokeWidth: 3 }}>{label}</text></g>) }
          const c = pts[0] && P(pts[0].lat, pts[0].lng), rp = kmToPx(value.radiusKm ?? 0, b, H)
          const rh = c && s.mode === 'radius' ? bind({ onMove: (p) => onChange({ ...value, radiusKm: Math.round(clamp(pxToKm(Math.hypot(p.x - c.x, p.y - c.y), b, H), 0.5, s.maxRadiusKm) * 10) / 10 }) }) : undefined
          const dm = c && s.mode === 'drop' ? bind({ onMove: (p) => { const q = unproject(p.x, p.y, b, W, H); onChange({ points: [{ lat: q.lat, lng: q.lng }] }) } }) : undefined
          return <g>
            <rect {...tg('map')} width={W} height={H} rx={12} fill={T.bg} stroke={T.border} {...bg} />
            <g pointerEvents="none" stroke={T.border} opacity={0.6}>
              {Array.from({ length: 12 }, (_, i) => Math.floor(b.minLat / step) * step + i * step).filter((l) => l >= b.minLat && l <= b.maxLat).map((l) => <line key={'a' + l} x1={0} x2={W} y1={P(l, 0).y} y2={P(l, 0).y} />)}
              {Array.from({ length: 12 }, (_, i) => Math.floor(b.minLng / step) * step + i * step).filter((l) => l >= b.minLng && l <= b.maxLng).map((l) => <line key={'o' + l} y1={0} y2={H} x1={P(0, l).x} x2={P(0, l).x} />)}</g>
            {s.shapes?.map((ring, i) => <path key={i} pointerEvents="none" d={'M' + ring.map(([ln, la]) => { const q = P(la, ln); return `${q.x.toFixed(1)} ${q.y.toFixed(1)}` }).join('L') + 'Z'} fill={T.surface2} stroke={T.muted} strokeWidth={1} />)}
            {s.mode === 'route' && pts.length > 1 && <polyline pointerEvents="none" points={pts.map((p) => { const q = P(p.lat, p.lng); return `${q.x},${q.y}` }).join(' ')} fill="none" stroke={T.accent} strokeWidth={3} strokeDasharray="8 6" />}
            {c && s.mode === 'radius' && <g {...tg('radius')}><circle cx={c.x} cy={c.y} r={rp} fill={T.accent} fillOpacity={0.15} stroke={T.accent} strokeWidth={2} pointerEvents="none" /><circle cx={c.x + rp} cy={c.y} r={22} fill="transparent" {...rh} /><circle cx={c.x + rp} cy={c.y} r={9} fill={T.accent} stroke={T.surface} strokeWidth={3} pointerEvents="none" /></g>}
            {c && (s.mode === 'drop' || s.mode === 'radius') && <g {...tg('dropped')}><circle cx={c.x} cy={c.y} r={22} fill="transparent" {...(dm ?? {})} /><circle cx={c.x} cy={c.y} r={10} fill={T.danger} stroke={T.surface} strokeWidth={3} pointerEvents="none" /></g>}
            {s.places.map((p) => { const idx = pts.findIndex((x) => x.id === p.id); return pin(p.id, p.lat, p.lng, p.label, idx >= 0, s.mode === 'route' && idx >= 0 ? idx + 1 : undefined, imM(p)) })}
          </g>
        }}</SvgBox>
        <div style={{ position: 'absolute', right: 10, top: 10, display: 'grid', gap: 6 }}>
          <Btn aria-label="Zoom in" style={{ width: 40, padding: 0 }} onClick={() => setView({ ...view, span: Math.max(view.span / 2, 0.005) })}>+</Btn><Btn aria-label="Zoom out" style={{ width: 40, padding: 0 }} onClick={() => setView({ ...view, span: Math.min(view.span * 2, 160) })}>−</Btn></div>
      </div>
      <Row style={{ minHeight: 36 }}>
        <Muted style={{ color: T.text }}>{value.points.length === 0 ? { pick: 'Tap a place.', drop: 'Tap the map to drop a pin. Drag to pan.', radius: 'Tap to set the center, then drag the edge.', route: 'Tap places in order.' }[s.mode] : value.points.map((p, i) => { const pl = p.id ? s.places.find((x) => x.id === p.id) : undefined; return pl ? `${s.mode === 'route' ? i + 1 + '. ' : ''}${pl.label}${pl.address ? ' · ' + pl.address : ''}` : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` }).join('  →  ')}{s.mode === 'radius' && value.radiusKm ? ` · ${value.radiusKm} km` : ''}</Muted>
        {value.points.length > 0 && <Btn tone="ghost" onClick={() => onChange({ points: s.mode === 'route' ? value.points.slice(0, -1) : [] })}>{s.mode === 'route' ? 'Undo' : 'Clear'}</Btn>}
      </Row>
    </div>)
}
export const map: Def<S, V> = {
  Component: MapView, initial: () => ({ points: [] }),
  label: (s, v) => v.points.map((p) => s.places.find((x) => x.id === p.id)?.label ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`).join(' → ') + (s.mode === 'radius' && v.radiusKm ? ` (${v.radiusKm} km)` : ''),
  valid: (_s, v) => v.points.length > 0,
}
