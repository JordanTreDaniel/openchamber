import { useRef, useState } from 'react'
import { clamp, fromHHMM, pad2, toHHMM, ymd } from '../core'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { Btn, Chip, Muted, Row, SvgBox, snap } from '../prims'
import { T } from '../tokens'
import type { SpecOf, Values } from '../types'

type S = SpecOf<'when'>; type V = Values['when']
const SEG: Record<string, string> = { a: '5,0,30,7', b: '33,5,7,29', c: '33,38,7,29', d: '5,65,30,7', e: '0,38,7,29', f: '0,5,7,29', g: '5,32.5,30,7' }
const DIG = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg']
/** Seven-segment digit: the classic digital-clock face, drawn as SVG so it needs no font. */
function Digit({ d, x }: { d: number; x: number }) {
  return <g transform={`translate(${x} 0)`}>{Object.entries(SEG).map(([k, r]) => { const [rx, ry, w, h] = r.split(',').map(Number); const on = DIG[d].includes(k); return <rect key={k} x={rx} y={ry} width={w} height={h} rx={2.5} fill={on ? T.accent : T.border} opacity={on ? 1 : 0.35} /> })}</g>
}
function Digital({ s, t, set }: { s: S; t: number; set: (m: number) => void }) {
  const tg = useTarget(); const h = Math.floor(t / 60), m = t % 60; const adj = (dh: number, dm: number) => set((((h + dh + 24) % 24) * 60 + ((m + dm + 60) % 60)) % 1440)
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
      <SvgBox h={120} max={380}>{(W) => { const sc = Math.min(1.2, (W - 20) / 224); return <g transform={`translate(${(W - 224 * sc) / 2} ${(120 - 72 * sc) / 2}) scale(${sc})`} {...tg('display')}><Digit d={Math.floor(h / 10)} x={0} /><Digit d={h % 10} x={50} /><circle cx={112} cy={22} r={4.5} fill={T.accent} /><circle cx={112} cy={50} r={4.5} fill={T.accent} /><Digit d={Math.floor(m / 10)} x={134} /><Digit d={m % 10} x={184} /></g> }}</SvgBox>
      <Row style={{ gap: 28, justifyContent: 'center' }}>
        {[['Hour', 1, 0], ['Minute', 0, s.stepMinutes]].map(([l, dh, dm]) => <div key={l as string} style={{ display: 'grid', gap: 6, justifyItems: 'center' }}><Btn aria-label={`${l} up`} {...tg(`${l}+`)} onClick={() => adj(dh as number, dm as number)} style={{ width: 84 }}>▲</Btn><Muted>{l}</Muted><Btn aria-label={`${l} down`} {...tg(`${l}-`)} onClick={() => adj(-(dh as number), -(dm as number))} style={{ width: 84 }}>▼</Btn></div>)}
      </Row>
    </div>)
}
function Analog({ s, t, set }: { s: S; t: number; set: (m: number) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const [hand, setHand] = useState<'h' | 'm'>('h')
  const h = Math.floor(t / 60), m = t % 60, pm = h >= 12
  const put = (x: number, y: number, c: number) => { let deg = (Math.atan2(y - c, x - c) * 180) / Math.PI + 90; deg = (deg + 360) % 360
    if (hand === 'h') set((((Math.round(deg / 30) % 12) + (pm ? 12 : 0)) * 60) + m); else set(h * 60 + (Math.round(snap(deg / 6, s.stepMinutes)) % 60)) }
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
      <SvgBox h={(w) => Math.min(w, 300)} max={300} svgRef={ref}>{(W) => { const c = W / 2, r = c - 10, pt = (deg: number, len: number) => [c + len * Math.sin((deg * Math.PI) / 180), c - len * Math.cos((deg * Math.PI) / 180)]
        const bg = bind({ onStart: (p) => put(p.x, p.y, c), onMove: (p) => put(p.x, p.y, c) }); const ha = ((h % 12) + m / 60) * 30, ma = m * 6, [hx, hy] = pt(ha, r * 0.5), [mx, my] = pt(ma, r * 0.78)
        return <g><circle {...tg('face')} cx={c} cy={c} r={r} fill={T.bg} stroke={T.border} strokeWidth={2} {...bg} />
          {Array.from({ length: 12 }, (_, i) => { const [x, y] = pt(i * 30, r * 0.86); return <text key={i} x={x} y={y + 4} textAnchor="middle" pointerEvents="none" style={{ fill: T.text, fontSize: 13, fontWeight: 600 }}>{i || 12}</text> })}
          <line x1={c} y1={c} x2={hx} y2={hy} stroke={hand === 'h' ? T.accent : T.muted} strokeWidth={6} strokeLinecap="round" pointerEvents="none" /><line x1={c} y1={c} x2={mx} y2={my} stroke={hand === 'm' ? T.accent : T.muted} strokeWidth={4} strokeLinecap="round" pointerEvents="none" /><circle cx={c} cy={c} r={6} fill={T.text} pointerEvents="none" /></g> }}</SvgBox>
      <Row><Chip on={hand === 'h'} onClick={() => setHand('h')}>Hour</Chip><Chip on={hand === 'm'} onClick={() => setHand('m')}>Minute</Chip><Chip on={!pm} onClick={() => pm && set(t - 720)}>AM</Chip><Chip on={pm} onClick={() => !pm && set(t + 720)}>PM</Chip><b style={{ fontVariantNumeric: 'tabular-nums' }}>{toHHMM(t)}</b></Row>
    </div>)
}
function Calendar({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const base = v.date ? new Date(v.date + 'T00:00:00') : s.min ? new Date(s.min + 'T00:00:00') : new Date(); const [ym, setYm] = useState({ y: base.getFullYear(), m: base.getMonth() })
  const first = new Date(ym.y, ym.m, 1).getDay(), days = new Date(ym.y, ym.m + 1, 0).getDate(), today = ymd(new Date())
  const go = (d: number) => setYm((p) => { const n = new Date(p.y, p.m + d, 1); return { y: n.getFullYear(), m: n.getMonth() } })
  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
      <Row style={{ justifyContent: 'space-between' }}><Btn aria-label="Previous month" onClick={() => go(-1)}>‹</Btn><b>{new Date(ym.y, ym.m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</b><Btn aria-label="Next month" onClick={() => go(1)}>›</Btn></Row>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Muted key={i} style={{ fontSize: 11 }}>{d}</Muted>)}
        {Array.from({ length: first }, (_, i) => <span key={'b' + i} />)}
        {Array.from({ length: days }, (_, i) => { const id = `${ym.y}-${pad2(ym.m + 1)}-${pad2(i + 1)}`, on = v.date === id, off = (s.min && id < s.min) || (s.max && id > s.max)
          return <button key={id} type="button" disabled={!!off} aria-pressed={on} {...tg('day:' + id)} onClick={() => onChange({ date: id })} style={{ height: 44, borderRadius: 10, font: 'inherit', cursor: off ? 'not-allowed' : 'pointer', border: `1px solid ${on ? T.accent : id === today ? T.muted : T.border}`, background: on ? T.accent : 'transparent', color: on ? T.accentFg : off ? T.muted : T.text, opacity: off ? 0.4 : 1 }}>{i + 1}</button> })}
      </div>
    </div>)
}
function Availability({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const bind = useDrag(); const paint = useRef<boolean>(true); const cur = useRef<string[]>([]); const cells = v.cells ?? []
  const hours = Array.from({ length: s.toHour - s.fromHour }, (_, i) => s.fromHour + i)
  const at = (cx: number, cy: number) => (document.elementsFromPoint(cx, cy).find((e) => (e as HTMLElement).dataset?.cell) as HTMLElement | undefined)?.dataset.cell
  const apply = (id?: string) => { if (!id) return; const has = cur.current.includes(id); if (paint.current && !has) cur.current = [...cur.current, id]; else if (!paint.current && has) cur.current = cur.current.filter((x) => x !== id); else return; onChange({ cells: cur.current }) }
  const h = bind({ onStart: (p) => { cur.current = cells; const id = at(p.cx, p.cy); paint.current = id ? !cells.includes(id) : true; apply(id) }, onMove: (p) => apply(at(p.cx, p.cy)) })
  return (
    <div className="vq-scroll"><div {...h} style={{ ...h.style, cursor: 'crosshair', display: 'grid', gridTemplateColumns: `44px repeat(${s.days.length},minmax(40px,1fr))`, gap: 3, minWidth: 44 + s.days.length * 43 }}>
      <span />{s.days.map((d) => <Muted key={d} style={{ textAlign: 'center', fontSize: 12 }}>{d}</Muted>)}
      {hours.map((hr) => [<Muted key={'h' + hr} style={{ fontSize: 11, textAlign: 'right', paddingRight: 6, alignSelf: 'center' }}>{hr % 12 || 12}{hr < 12 ? 'a' : 'p'}</Muted>, ...s.days.map((d) => { const id = `${d}-${hr}`, on = cells.includes(id); return <div key={id} data-cell={id} {...tg('cell:' + id)} role="checkbox" aria-checked={on} aria-label={`${d} ${hr}:00`} style={{ height: 34, borderRadius: 6, background: on ? T.ok : T.bg, border: `1px solid ${on ? T.ok : T.border}` }} /> })])}
    </div><Muted style={{ marginTop: 6 }}>Press and drag to paint. Drag across painted cells to erase.</Muted></div>)
}
function Repeat({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const r = v.repeat ?? { days: [], time: '09:00' }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Row>{s.days.map((d) => <Chip key={d} on={r.days.includes(d)} {...tg('day:' + d)} onClick={() => onChange({ repeat: { ...r, days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] } })}>{d}</Chip>)}</Row>
      <Row><input className="vq-input" type="time" step={s.stepMinutes * 60} value={r.time} aria-label="Time of day" style={{ width: 150 }} onChange={(e) => onChange({ repeat: { ...r, time: e.target.value } })} /><Btn tone="ghost" onClick={() => onChange({ repeat: { ...r, days: s.days.slice(0, 5) } })}>Weekdays</Btn><Btn tone="ghost" onClick={() => onChange({ repeat: { ...r, days: s.days } })}>Every day</Btn></Row>
    </div>)
}
function WhenView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  if (s.mode === 'calendar') return <Calendar s={s} v={value} onChange={onChange} />
  if (s.mode === 'availability') return <Availability s={s} v={value} onChange={onChange} />
  if (s.mode === 'repeat') return <Repeat s={s} v={value} onChange={onChange} />
  const t = fromHHMM(value.time ?? '09:00'), set = (m: number) => onChange({ time: toHHMM(clamp(Math.round(m), 0, 1439)) })
  return s.clockSkin === 'analog' ? <Analog s={s} t={t} set={set} /> : <Digital s={s} t={t} set={set} />
}
export const when: Def<S, V> = {
  Component: WhenView, initial: (s) => (s.mode === 'clock' ? { time: '09:00' } : s.mode === 'availability' ? { cells: [] } : s.mode === 'repeat' ? { repeat: { days: [], time: '09:00' } } : {}),
  label: (s, v) => s.mode === 'clock' ? v.time ?? '' : s.mode === 'calendar' ? v.date ?? '' : s.mode === 'availability' ? `${v.cells?.length ?? 0} slots` : `${v.repeat?.days.join(', ')} at ${v.repeat?.time}`,
  valid: (s, v) => s.mode === 'clock' ? !!v.time : s.mode === 'calendar' ? !!v.date : s.mode === 'availability' ? (v.cells?.length ?? 0) > 0 : (v.repeat?.days.length ?? 0) > 0 && !!v.repeat?.time,
}
