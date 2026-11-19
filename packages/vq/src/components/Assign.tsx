import { useRef, useState } from 'react'
import type { Def } from '../Frame'
import { useDrag, useTarget, useVQ } from '../hooks'
import { Body, Btn, Img, Muted, Row, SvgBox, SvgImg, imgMode } from '../prims'
import { series, T } from '../tokens'
import type { Option, SpecOf } from '../types'

type S = SpecOf<'assign'>; type V = Record<string, string[]>
const DEF: Option[] = [{ id: 'keep', label: 'Keep', color: '#3ecf8e' }, { id: 'drop', label: 'Drop', color: '#ff6b5f' }]
const tgts = (s: S) => s.targets ?? DEF
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t)
/** Link item -> target honoring skin rules: lines are 1:1, otherwise one target per item unless overlap (per facet for grids). */
export function assignTo(s: S, v: V, item: string, target: string, toggle = true): V {
  const n: V = { ...v }; const cur = n[item] ?? []
  if (s.skin === 'lines') { for (const k of Object.keys(n)) n[k] = n[k].filter((t) => t !== target); if (toggle && cur.includes(target)) { n[item] = [] } else n[item] = [target]; return n }
  if (cur.includes(target)) { if (toggle) n[item] = cur.filter((t) => t !== target); return n }
  if (s.overlap) { n[item] = [...cur, target]; return n }
  if (s.skin === 'grid' && s.facets) { const f = target.split(':')[0]; n[item] = [...cur.filter((t) => t.split(':')[0] !== f), target]; return n }
  n[item] = [target]; return n
}
const lab = (s: S, id: string) => { const f = id.includes(':') ? s.facets?.find((x) => x.id === id.split(':')[0])?.label : undefined; const t = tgts(s).find((x) => x.id === id.split(':').pop()!)?.label ?? id; return f ? `${f}/${t}` : t }

function Lines({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const T2 = tgts(s); const im = imgMode(s.items, s.images), imT = imgMode(T2, s.images)
  const [sel, setSel] = useState<string | null>(null); const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null)
  const rh = 52, n = Math.max(s.items.length, T2.length)
  return <SvgBox h={n * rh + 8} svgRef={ref}>{(W) => {
    const nw = Math.min(210, (W - 56) / 2), ly = (i: number) => 4 + i * rh + rh / 2 - 4, by = (id: string) => T2.findIndex((t) => t.id === id)
    const hit = (y: number) => Math.min(T2.length - 1, Math.max(0, Math.floor((y - 4) / rh)))
    return <g>
      {s.items.flatMap((it, i) => (v[it.id] ?? []).map((t) => { const j = by(t); const x0 = nw, x1 = W - nw, y0 = ly(i), y1 = ly(j); return <path key={it.id + t} {...tg(`link:${it.id}>${t}`)} d={`M${x0} ${y0}C${(x0 + x1) / 2} ${y0} ${(x0 + x1) / 2} ${y1} ${x1} ${y1}`} fill="none" stroke={series(i)} strokeWidth={3} strokeLinecap="round" /> }))}
      {live && (() => { const i = s.items.findIndex((x) => x.id === live.id); return <path d={`M${nw} ${ly(i)}L${live.x} ${live.y}`} stroke={T.muted} strokeWidth={3} strokeDasharray="5 5" fill="none" /> })()}
      {s.items.map((it, i) => { const h = bind({ onStart: () => { setSel(it.id); setLive({ id: it.id, x: nw, y: ly(i) }) }, onMove: (p) => setLive({ id: it.id, x: p.x, y: p.y }),
          onEnd: (p) => { setLive(null); if (p.x > W / 2 && Math.hypot(p.dx, p.dy) > 8) { onChange(assignTo(s, v, it.id, T2[hit(p.y)].id, false)); setSel(null) } } })
        return <g key={it.id} {...tg('item:' + it.id)}><rect x={2} y={4 + i * rh} width={nw - 2} height={rh - 8} rx={10} fill={T.surface} stroke={sel === it.id ? T.accent : T.border} strokeWidth={sel === it.id ? 2 : 1} />
          {im(it) !== null && <SvgImg cx={24} cy={ly(i)} size={30} src={im(it) || undefined} label={it.label} />}<text x={im(it) !== null ? 46 : 14} y={ly(i) + 4} style={{ fill: T.text, fontSize: 13 }}>{cut(it.label, Math.floor((nw - (im(it) !== null ? 68 : 36)) / 7))}</text><circle cx={nw} cy={ly(i)} r={24} fill="transparent" {...h} /><circle cx={nw} cy={ly(i)} r={7} fill={(v[it.id] ?? []).length ? series(i) : T.surface} stroke={series(i)} strokeWidth={2} pointerEvents="none" /></g> })}
      {T2.map((t, j) => { const used = s.items.findIndex((it) => (v[it.id] ?? []).includes(t.id))
        return <g key={t.id} {...tg('target:' + t.id)} onClick={() => { if (sel) { onChange(assignTo(s, v, sel, t.id)); setSel(null) } }} style={{ cursor: 'pointer' }}>
          <rect x={W - nw} y={4 + j * rh} width={nw - 2} height={rh - 8} rx={10} fill={T.surface} stroke={used >= 0 ? series(used) : T.border} strokeWidth={used >= 0 ? 2 : 1} />
          {imT(t) !== null && <SvgImg cx={W - nw + 24} cy={ly(j)} size={30} src={imT(t) || undefined} label={t.label} />}<text x={W - nw + (imT(t) !== null ? 46 : 14)} y={ly(j) + 4} style={{ fill: T.text, fontSize: 13 }}>{cut(t.label, Math.floor((nw - (imT(t) !== null ? 68 : 36)) / 7))}</text><circle cx={W - nw} cy={ly(j)} r={7} fill={used >= 0 ? series(used) : T.surface} stroke={used >= 0 ? series(used) : T.border} strokeWidth={2} /></g> })}
    </g>
  }}</SvgBox>
}

function Chipish({ o, color, sel, onTap, onDropAt, img }: { o: Option; color?: string; sel: boolean; onTap: () => void; onDropAt: (bucket: string | null) => void; img: string | null }) {
  const bind = useDrag(); const tg = useTarget(); const [d, setD] = useState<{ x: number; y: number } | null>(null)
  const h = bind({ onStart: () => setD({ x: 0, y: 0 }), onMove: (p) => setD({ x: p.dx, y: p.dy }), onEnd: (p) => {
    setD(null)
    if (Math.hypot(p.dx, p.dy) < 8) return onTap()
    const b = (document.elementsFromPoint(p.cx, p.cy).find((e) => e.closest('[data-bucket]'))?.closest('[data-bucket]') as HTMLElement | undefined)?.dataset.bucket ?? null; onDropAt(b) } })
  return <div {...tg('item:' + o.id)} {...h} role="button" tabIndex={0} aria-pressed={sel} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTap() }}
    style={{ ...h.style, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', minHeight: 40, borderRadius: 10, background: T.surface2, border: `1px solid ${sel ? T.accent : color ?? T.border}`, boxShadow: sel ? `0 0 0 2px ${T.accent}` : d ? '0 8px 20px rgba(0,0,0,.4)' : undefined, transform: d ? `translate(${d.x}px,${d.y}px)` : undefined, zIndex: d ? 20 : undefined, position: 'relative', fontSize: 14 }}>{img !== null && <Img size={26} radius={13} src={img || undefined} label={o.label} />}{o.label}</div>
}
function Buckets({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const [sel, setSel] = useState<string | null>(null); const T2 = tgts(s); const tg = useTarget(); const { compact } = useVQ(); const im = imgMode(s.items, s.images), imT = imgMode(T2, s.images)
  const free = s.items.filter((i) => !(v[i.id] ?? []).length)
  const put = (id: string, b: string | null) => { if (b === '__pool') onChange({ ...v, [id]: [] }); else if (b) onChange(assignTo(s, v, id, b, false)); setSel(null) }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div data-bucket="__pool" style={{ padding: 10, border: `1px dashed ${T.border}`, borderRadius: T.radius, minHeight: 56 }}>
        <Muted style={{ fontSize: 12, marginBottom: 6 }}>{free.length ? 'Drag to a bucket, or tap an item then a bucket' : 'All placed'}</Muted>
        <Row>{free.map((o) => <Chipish key={o.id} img={im(o)} o={o} sel={sel === o.id} onTap={() => setSel(sel === o.id ? null : o.id)} onDropAt={(b) => put(o.id, b)} />)}</Row>
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: `repeat(auto-fit,minmax(${compact ? 140 : 170}px,1fr))` }}>
        {T2.map((t, j) => <div key={t.id} data-bucket={t.id} {...tg('bucket:' + t.id)} onClick={() => sel && put(sel, t.id)} style={{ padding: 10, minHeight: 110, borderRadius: T.radius, background: T.bg, border: `2px solid ${sel ? T.accent : t.color ?? series(j)}`, borderStyle: sel ? 'dashed' : 'solid', cursor: sel ? 'pointer' : undefined }}>
          <div style={{ fontWeight: 650, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>{imT(t) !== null && <Img size={26} radius={8} src={imT(t) || undefined} label={t.label} />}{s.ordered && <span style={{ color: t.color ?? series(j), marginRight: 6 }}>#{j + 1}</span>}{t.label}</div>
          <Row>{s.items.filter((i) => (v[i.id] ?? []).includes(t.id)).map((o) => <Chipish key={o.id} img={im(o)} o={o} color={t.color ?? series(j)} sel={false} onTap={() => onChange({ ...v, [o.id]: (v[o.id] ?? []).filter((x) => x !== t.id) })} onDropAt={(b) => put(o.id, b)} />)}</Row></div>)}
      </div>
    </div>)
}

function Grid({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const T2 = tgts(s); const im = imgMode(s.items, s.images), imT = imgMode(T2, s.images); const facets = s.facets?.length ? s.facets : [undefined]
  const paint = useRef<boolean | null>(null)
  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: facets.length > 1 ? 'repeat(auto-fit,minmax(min(100%,320px),1fr))' : '1fr' }}>
      {facets.map((f) => (
        <div key={f?.id ?? 'x'} className="vq-scroll">
          {f && <div style={{ fontWeight: 650, marginBottom: 6 }}>{f.label}</div>}
          <table style={{ borderCollapse: 'separate', borderSpacing: 4, minWidth: '100%' }}>
            <thead><tr><th />{T2.map((t) => <th key={t.id} {...tg(`col:${f ? f.id + ':' : ''}${t.id}`)} style={{ fontSize: 12, color: T.muted, fontWeight: 600, padding: '0 4px', minWidth: 56 }}>{imT(t) !== null && <Img size={28} radius={14} src={imT(t) || undefined} label={t.label} style={{ margin: '0 auto 4px' }} />}{t.label}</th>)}</tr></thead>
            <tbody>{s.items.map((it) => <tr key={it.id}><th {...tg('row:' + it.id)} style={{ textAlign: 'left', fontWeight: 600, padding: '0 8px 0 0', position: 'sticky', left: 0, background: T.surface, whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{im(it) !== null && <Img size={28} radius={8} src={im(it) || undefined} label={it.label} />}{it.label}</span></th>
              {T2.map((t) => { const id = (f ? f.id + ':' : '') + t.id, on = (v[it.id] ?? []).includes(id)
                return <td key={t.id} style={{ padding: 0, textAlign: 'center' }}><button type="button" aria-pressed={on} aria-label={`${it.label}, ${t.label}`} {...tg(`cell:${it.id}|${id}`)} onClick={() => onChange(assignTo(s, v, it.id, id))}
                  style={{ width: '100%', minWidth: 52, height: 44, borderRadius: 10, cursor: 'pointer', border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.bg, color: T.accentFg, fontWeight: 700 }}>{on ? '✓' : ''}</button></td> })}</tr>)}</tbody>
          </table>
        </div>))}
    </div>)
}

function Deck({ s, v, onChange }: { s: S; v: V; onChange: (v: V) => void }) {
  const T2 = tgts(s); const im = imgMode(s.items, s.images); const bind = useDrag(); const tg = useTarget(); const [d, setD] = useState<{ x: number; y: number } | null>(null); const [hist, setHist] = useState<string[]>([])
  const cur = s.items.find((i) => !(v[i.id] ?? []).length); const done = s.items.length - s.items.filter((i) => !(v[i.id] ?? []).length).length
  const decide = (t: string) => { if (!cur) return; setHist([...hist, cur.id]); onChange({ ...v, [cur.id]: [t] }) }
  const dirs = [['→', 0], ['←', 1], ['↑', 2], ['↓', 3]] as const
  const h = bind({ onStart: () => setD({ x: 0, y: 0 }), onMove: (p) => setD({ x: p.dx, y: p.dy }), onEnd: (p) => { setD(null); const ax = Math.abs(p.dx), ay = Math.abs(p.dy); if (Math.max(ax, ay) < 90) return
    const k = ax >= ay ? (p.dx > 0 ? 0 : 1) : p.dy < 0 ? 2 : 3; if (T2[k]) decide(T2[k].id) } })
  if (!cur) return <div style={{ display: 'grid', gap: 8 }}><Muted>All {s.items.length} decided</Muted><Row>{T2.map((t, j) => <span key={t.id} style={{ padding: '4px 12px', borderRadius: 999, border: `1px solid ${t.color ?? series(j)}` }}>{t.label}: {s.items.filter((i) => (v[i.id] ?? []).includes(t.id)).length}</span>)}</Row>
    <Btn tone="ghost" onClick={() => { const last = hist[hist.length - 1]; if (last) { setHist(hist.slice(0, -1)); onChange({ ...v, [last]: [] }) } }}>Undo last</Btn></div>
  const hint = d && Math.max(Math.abs(d.x), Math.abs(d.y)) > 20 ? T2[Math.abs(d.x) >= Math.abs(d.y) ? (d.x > 0 ? 0 : 1) : d.y < 0 ? 2 : 3] : undefined
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Muted>{done + 1} of {s.items.length} · swipe {T2.slice(0, 4).map((t, k) => `${dirs[k][0]} ${t.label}`).join('  ')}</Muted>
      <div style={{ position: 'relative', minHeight: 170, touchAction: 'pan-y' }}>
        <div style={{ position: 'absolute', inset: '10px 6% 0', borderRadius: 16, background: T.surface2, border: `1px solid ${T.border}`, transform: 'scale(.95)' }} />
        <div {...tg('card:' + cur.id)} {...h} style={{ ...h.style, position: 'relative', minHeight: 160, margin: '0 3%', padding: 18, borderRadius: 16, background: T.surface, border: `2px solid ${hint?.color ?? T.border}`, display: 'grid', gap: 10, alignContent: 'center', textAlign: 'center', transform: d ? `translate(${d.x}px,${d.y}px) rotate(${d.x / 24}deg)` : undefined, boxShadow: '0 6px 18px rgba(0,0,0,.25)' }}>
          {im(cur) !== null && <Img ratio="16/9" src={im(cur) || undefined} label={cur.label} style={{ width: '100%', maxHeight: 190 }} />}<div style={{ fontWeight: 650, fontSize: 18 }}>{cur.label}</div>{cur.detail && <div style={{ textAlign: 'left' }}><Body c={cur.detail} /></div>}
          {hint && <div style={{ position: 'absolute', top: 10, right: 14, fontWeight: 700, color: hint.color }}>{hint.label}</div>}
        </div>
      </div>
      <Row style={{ justifyContent: 'center' }}>{T2.map((t, k) => <Btn key={t.id} {...tg('verdict:' + t.id)} onClick={() => decide(t.id)} style={{ borderColor: t.color ?? series(k) }}>{dirs[k]?.[0]} {t.label}</Btn>)}
        {hist.length > 0 && <Btn tone="ghost" onClick={() => { const last = hist[hist.length - 1]; setHist(hist.slice(0, -1)); onChange({ ...v, [last]: [] }) }}>Undo</Btn>}</Row>
    </div>)
}
function AssignView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  return s.skin === 'lines' ? <Lines s={s} v={value} onChange={onChange} /> : s.skin === 'grid' ? <Grid s={s} v={value} onChange={onChange} /> : s.skin === 'deck' ? <Deck s={s} v={value} onChange={onChange} /> : <Buckets s={s} v={value} onChange={onChange} />
}
export const assign: Def<S, V> = {
  Component: AssignView, initial: (s) => Object.fromEntries(s.items.map((i) => [i.id, []])),
  label: (s, v) => s.items.filter((i) => (v[i.id] ?? []).length).map((i) => `${i.label} → ${(v[i.id] ?? []).map((t) => lab(s, t)).join('+')}`).join('; ') || 'Nothing assigned',
  valid: (s, v) => (s.skin === 'buckets' || s.skin === 'deck') ? s.items.every((i) => (v[i.id] ?? []).length > 0) : s.items.some((i) => (v[i.id] ?? []).length > 0),
}
