import { useRef, useState } from 'react'
import { clamp, fmtT } from '../core'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { Btn, Chip, Muted, Row, SvgBox, imgUri, snap } from '../prims'
import { series, T } from '../tokens'
import type { SpecOf, Values } from '../types'

type S = SpecOf<'timeline'>; type V = Values['timeline']; type Reg = V['regions'][number]
const stepOf = (s: S) => (s.unit === 's' ? (s.duration <= 60 ? 0.1 : s.duration <= 600 ? 0.5 : 1) : 1)
const isImg = (x: string) => /^(https?:|data:|\/|<svg)/.test(x.trimStart())
function TimelineView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const media = useRef<HTMLMediaElement>(null)
  const off = useRef(0); const anchor = useRef(0)
  const [sel, setSel] = useState<string | null>(null); const [now, setNow] = useState(0); const [playing, setPlaying] = useState(false)
  const step = stepOf(s), D = s.duration, lanes = s.mode === 'lanes' ? s.lanes ?? [] : [], R = value.regions, bd = s.backdrop
  const trackH = lanes.length ? lanes.length * 44 : 92, H = trackH + 10 + 36, video = !!s.src && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(s.src)
  const setReg = (id: string, p: Partial<Reg>) => onChange({ ...value, regions: R.map((r) => (r.id === id ? { ...r, ...p } : r)) })
  const seek = (t: number) => { if (media.current) media.current.currentTime = t; setNow(t) }
  const nid = () => 'r' + (R.reduce((a, r) => Math.max(a, Number(r.id.slice(1)) || 0), 0) + 1)
  const selReg = R.find((r) => r.id === sel)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {s.src && (video ? <video ref={media as React.RefObject<HTMLVideoElement>} src={s.src} playsInline preload="metadata" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} style={{ width: '100%', maxHeight: 240, borderRadius: 10, background: '#000' }} />
        : <audio ref={media as React.RefObject<HTMLAudioElement>} src={s.src} preload="metadata" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />)}
      <SvgBox h={H} svgRef={ref}>{(W) => {
        const pad = 16, X = (t: number) => pad + (t / D) * (W - 2 * pad), Tt = (x: number) => clamp(snap(((x - pad) / (W - 2 * pad)) * D, step), 0, D)
        const rb = (r: Reg, y: number, h: number, c: string, handles: boolean) => {
          const body = bind({ onStart: (p) => { off.current = Tt(p.x) - r.start; setSel(r.id) }, onMove: (p) => { const len = r.end - r.start, st = clamp(Tt(p.x) - off.current, 0, D - len); setReg(r.id, { start: st, end: st + len }) } })
          const hs = bind({ onMove: (p) => setReg(r.id, { start: Math.min(Tt(p.x), r.end - step) }) }), he = bind({ onMove: (p) => setReg(r.id, { end: Math.max(Tt(p.x), r.start + step) }) })
          return <g key={r.id} {...tg('region:' + r.id)}><rect x={X(r.start)} y={y} width={Math.max(X(r.end) - X(r.start), 2)} height={h} rx={6} fill={c} fillOpacity={0.28} stroke={c} strokeWidth={sel === r.id ? 3 : 1.5} {...body} />
            {r.label && <text x={X(r.start) + 8} y={y + 16} pointerEvents="none" style={{ fill: T.text, fontSize: 12, fontWeight: 600 }}>{r.label}</text>}
            {handles && <><rect x={X(r.start) - 12} y={y} width={24} height={h} fill="transparent" {...hs} /><rect x={X(r.start) - 3} y={y + h / 2 - 14} width={6} height={28} rx={3} fill={c} pointerEvents="none" /><rect x={X(r.end) - 12} y={y} width={24} height={h} fill="transparent" {...he} /><rect x={X(r.end) - 3} y={y + h / 2 - 14} width={6} height={28} rx={3} fill={c} pointerEvents="none" /></>}</g>
        }
        const track = lanes.length ? null : bind({
          onStart: (p) => { const t = Tt(p.x); if (s.mode === 'markers') onChange({ ...value, markers: [...value.markers, { t }].sort((a, b) => a.t - b.t) }); if (s.mode === 'regions') { anchor.current = t; const id = nid(); setSel(id); onChange({ ...value, regions: [...R, { id, start: t, end: t }] }) } },
          onMove: (p) => { if (s.mode !== 'regions') return; const t = Tt(p.x), id = sel ?? R[R.length - 1]?.id; if (id) setReg(id, { start: Math.min(anchor.current, t), end: Math.max(anchor.current, t) }) },
          onEnd: () => { if (s.mode === 'regions') { const last = R[R.length - 1]; if (last && last.end - last.start < step * 2) { onChange({ ...value, regions: R.slice(0, -1) }); setSel(null) } } } })
        const scrub = bind({ onStart: (p) => seek(Tt(p.x)), onMove: (p) => seek(Tt(p.x)) })
        const n = bd?.kind === 'wave' ? bd.peaks.length : 0, mx = bd?.kind === 'wave' ? Math.max(...bd.peaks, 0.0001) : 1, tk = 5
        return <g>
          <rect {...tg('track')} x={pad} y={10} width={W - 2 * pad} height={trackH} rx={10} fill={T.bg} stroke={T.border} {...(track ?? {})} />
          {bd?.kind === 'wave' && bd.peaks.map((p, i) => { const bw = (W - 2 * pad) / n, h = Math.max(2, (p / mx) * (trackH - 16)); return <rect key={i} pointerEvents="none" x={pad + i * bw + bw * 0.15} y={10 + trackH / 2 - h / 2} width={Math.max(bw * 0.7, 1)} height={h} rx={1.5} fill={T.muted} opacity={0.55} /> })}
          {bd?.kind === 'events' && bd.events.map((e, i) => <g key={i} {...tg('event:' + e.t)} pointerEvents="none"><line x1={X(e.t)} x2={X(e.t)} y1={10} y2={10 + trackH} stroke={T.border} strokeWidth={2} /><text x={X(e.t) + 4} y={26} style={{ fontSize: 11 }}>{e.label}</text></g>)}
          {bd?.kind === 'frames' && Array.from({ length: bd.count }, (_, i) => { const fw = (W - 2 * pad) / bd.count, lb = bd.labels?.[i]; return <g key={i} {...tg('frame:' + i)} pointerEvents="none">{lb && isImg(lb) ? <image href={imgUri(lb)} x={pad + i * fw + 1} y={11} width={fw - 2} height={trackH - 2} preserveAspectRatio="xMidYMid slice" /> : <><rect x={pad + i * fw + 1} y={11} width={fw - 2} height={trackH - 2} fill={T.surface2} /><text x={pad + i * fw + fw / 2} y={10 + trackH / 2 + 4} textAnchor="middle">{lb ?? i + 1}</text></>}</g> })}
          {lanes.map((l, i) => <g key={l.id}><line x1={pad} x2={W - pad} y1={10 + (i + 1) * 44} y2={10 + (i + 1) * 44} stroke={T.border} opacity={i === lanes.length - 1 ? 0 : 1} /><text x={pad + 8} y={10 + i * 44 + 13}>{l.label}</text></g>)}
          {s.mode === 'range' && R[0] && rb(R[0], 10, trackH, T.accent, true)}
          {s.mode === 'regions' && R.map((r, i) => rb(r, 18, trackH - 16, series(i), sel === r.id))}
          {s.mode === 'lanes' && R.map((r, i) => { const li = lanes.findIndex((l) => l.id === r.lane); return li < 0 ? null : rb(r, 10 + li * 44 + 18, 22, series(i), true) })}
          {value.markers.map((m, i) => <g key={i} {...tg('marker:' + m.t)}><line x1={X(m.t)} x2={X(m.t)} y1={6} y2={10 + trackH} stroke={T.warn} strokeWidth={3} /><circle cx={X(m.t)} cy={6} r={6} fill={T.warn} /></g>)}
          {Array.from({ length: tk + 1 }, (_, i) => { const t = (D * i) / tk; return <text key={i} x={X(t)} y={trackH + 30} textAnchor={i === 0 ? 'start' : i === tk ? 'end' : 'middle'}>{fmtT(t, s.unit)}</text> })}
          {s.src && <g><rect x={pad} y={trackH + 14} width={W - 2 * pad} height={14} fill="transparent" {...scrub} /><line x1={X(now)} x2={X(now)} y1={6} y2={trackH + 24} stroke={T.danger} strokeWidth={2} pointerEvents="none" /><circle cx={X(now)} cy={trackH + 21} r={5} fill={T.danger} pointerEvents="none" /></g>}
        </g>
      }}</SvgBox>
      <Row>
        {s.src && <><Btn tone="primary" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { const m = media.current; if (m) (m.paused ? m.play() : m.pause()) }} style={{ minWidth: 72 }}>{playing ? 'Pause' : 'Play'}</Btn><Muted style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtT(now, s.unit)}</Muted>
          {s.mode === 'markers' && <Btn onClick={() => onChange({ ...value, markers: [...value.markers, { t: Math.round(now * 10) / 10 }].sort((a, b) => a.t - b.t) })}>Mark here</Btn>}
          {s.mode === 'range' && R[0] && <><Btn onClick={() => setReg('range', { start: Math.min(snap(now, step), R[0].end - step) })}>Start here</Btn><Btn onClick={() => setReg('range', { end: Math.max(snap(now, step), R[0].start + step) })}>End here</Btn></>}</>}
        {s.mode === 'range' && R[0] && <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtT(R[0].start, s.unit)} – {fmtT(R[0].end, s.unit)}</b>}
        {s.mode === 'markers' && value.markers.map((m, i) => <Chip key={i} on {...tg('marker:' + m.t)} onClick={() => onChange({ ...value, markers: value.markers.filter((_, j) => j !== i) })} aria-label={`Remove marker at ${fmtT(m.t, s.unit)}`}>{fmtT(m.t, s.unit)} ×</Chip>)}
        {s.mode === 'markers' && !value.markers.length && <Muted>Tap the track to drop a marker.</Muted>}
        {s.mode === 'regions' && !R.length && <Muted>Drag across the track to select a segment.</Muted>}
      </Row>
      {s.mode === 'regions' && selReg && <Row><Muted>{fmtT(selReg.start, s.unit)} – {fmtT(selReg.end, s.unit)}</Muted>{s.labels?.map((l) => <Chip key={l.id} on={selReg.label === l.label} onClick={() => setReg(selReg.id, { label: l.label })}>{l.label}</Chip>)}<Btn tone="ghost" onClick={() => { onChange({ ...value, regions: R.filter((r) => r.id !== selReg.id) }); setSel(null) }}>Delete</Btn></Row>}
    </div>)
}
export const timeline: Def<S, V> = {
  Component: TimelineView,
  initial: (s) => ({ markers: [], regions: s.mode === 'range' ? [{ id: 'range', start: snap(s.duration * 0.3, stepOf(s)), end: snap(s.duration * 0.6, stepOf(s)) }] : s.mode === 'lanes' ? (s.items ?? []).map((i) => ({ id: i.id, start: i.start, end: i.end, label: i.label, lane: i.lane })) : [] }),
  label: (s, v) => s.mode === 'markers' ? 'Markers: ' + v.markers.map((m) => fmtT(m.t, s.unit)).join(', ') : v.regions.map((r) => `${r.label ? r.label + ' ' : ''}${fmtT(r.start, s.unit)}–${fmtT(r.end, s.unit)}${r.lane ? ' [' + r.lane + ']' : ''}`).join('; '),
  valid: (s, v) => s.mode === 'markers' ? v.markers.length > 0 : s.mode === 'regions' ? v.regions.length > 0 : true,
}
