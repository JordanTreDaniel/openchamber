import { useId, useMemo, useState } from 'react'
import { clamp, forceLayout } from '../core'
import type { Def } from '../Frame'
import { useTarget } from '../hooks'
import { Btn, Muted, Row, SvgBox, SvgImg, imgMode } from '../prims'
import { T } from '../tokens'
import type { SpecOf, Values } from '../types'

type S = SpecOf<'graph'>; type V = Values['graph']
export const edgeKey = (e: { id?: string; from: string; to: string }) => e.id ?? `${e.from}>${e.to}`
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
function GraphView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const im = imgMode(s.nodes, s.images); const mk = useId().replace(/:/g, ''); const [selE, setSelE] = useState<string | null>(null); const [selN, setSelN] = useState<string | null>(null)
  const pos = useMemo(() => { const f = forceLayout(s.nodes.map((n) => n.id), s.edges.map((e) => [e.from, e.to] as [string, string])); return Object.fromEntries(s.nodes.map((n) => [n.id, n.x != null && n.y != null ? { x: n.x, y: n.y } : f[n.id]])) }, [s])
  const all = [...s.edges.map((e) => ({ ...e, k: edgeKey(e), added: false })), ...value.added.map((e) => ({ ...e, id: undefined, label: undefined, directed: true, k: `${e.from}>${e.to}`, added: true }))]
  const sel = all.find((e) => e.k === selE)
  const tapNode = (id: string) => {
    if (s.mode === 'select') return onChange({ ...value, selected: value.selected.includes(id) ? value.selected.filter((x) => x !== id) : [...value.selected, id] })
    if (s.mode === 'edit') { if (!selN) return setSelN(id); if (selN !== id && !all.some((e) => e.from === selN && e.to === id)) onChange({ ...value, added: [...value.added, { from: selN, to: id }] }); setSelN(null) }
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <SvgBox h={(w) => clamp(w * 0.7, 300, 520)}>{(W) => {
        const H = clamp(W * 0.7, 300, 520), mx = 64, my = 34, P = (id: string) => ({ x: mx + pos[id].x * (W - 2 * mx), y: my + pos[id].y * (H - 2 * my) })
        return <g>
          <defs>{['m', 'y', 'n'].map((c) => <marker key={c} id={`${mk}${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={c === 'y' ? T.ok : c === 'n' ? T.danger : T.muted} /></marker>)}</defs>
          {all.map((e) => { const a = P(e.from), b = P(e.to), d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, ax = a.x + ux * 26, ay = a.y + uy * 14, bx = b.x - ux * 30, by = b.y - uy * 18
            const v = e.added ? 'yes' : value.verdicts[e.k], c = v === 'yes' ? T.ok : v === 'no' ? T.danger : T.muted, m = v === 'yes' ? 'y' : v === 'no' ? 'n' : 'm', on = selE === e.k
            return <g key={e.k} {...tg('edge:' + e.k)} onClick={() => setSelE(on ? null : e.k)} style={{ cursor: 'pointer' }}>
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth={28} />
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke={c} strokeWidth={on ? 4 : 2.5} strokeDasharray={v === 'yes' ? undefined : '6 5'} opacity={v === 'no' ? 0.7 : 1} markerEnd={e.directed ? `url(#${mk}${m})` : undefined} />
              {e.label && <text x={(ax + bx) / 2} y={(ay + by) / 2 - 6} textAnchor="middle" style={{ fontSize: 11 }}>{e.label}</text>}
              {v === 'no' && <text x={(ax + bx) / 2} y={(ay + by) / 2 + 5} textAnchor="middle" style={{ fill: T.danger, fontSize: 16, fontWeight: 700 }}>×</text>}
            </g> })}
          {s.nodes.map((n) => { const p = P(n.id), w = Math.min(170, (im(n) !== null ? 48 : 22) + n.label.length * 7), on = value.selected.includes(n.id) || selN === n.id
            return <g key={n.id} {...tg('node:' + n.id)} onClick={() => tapNode(n.id)} style={{ cursor: s.mode === 'verdict' ? 'default' : 'pointer' }}>
              <rect x={p.x - w / 2} y={p.y - 17} width={w} height={34} rx={17} fill={n.color ?? T.surface2} stroke={on ? T.accent : T.border} strokeWidth={on ? 3 : 1.5} />
              {im(n) !== null && <SvgImg cx={p.x - w / 2 + 19} cy={p.y} size={26} src={im(n) || undefined} label={n.label} />}<text x={p.x + (im(n) !== null ? 14 : 0)} y={p.y + 4} textAnchor="middle" style={{ fill: n.color ? '#0b0b0c' : T.text, fontSize: 12, fontWeight: 600 }}>{cut(n.label, im(n) !== null ? 16 : 20)}</text></g> })}
        </g>
      }}</SvgBox>
      <Row style={{ minHeight: 40 }}>
        {sel ? <><Muted style={{ color: T.text }}>{s.nodes.find((n) => n.id === sel.from)?.label} → {s.nodes.find((n) => n.id === sel.to)?.label}</Muted>
          {sel.added ? <Btn tone="danger" onClick={() => { onChange({ ...value, added: value.added.filter((a) => `${a.from}>${a.to}` !== sel.k) }); setSelE(null) }}>Remove link</Btn> :
            <><Btn tone="ok" onClick={() => onChange({ ...value, verdicts: { ...value.verdicts, [sel.k]: 'yes' } })}>Confirm</Btn><Btn tone="danger" onClick={() => onChange({ ...value, verdicts: { ...value.verdicts, [sel.k]: 'no' } })}>Reject</Btn><Btn tone="ghost" onClick={() => { const v = { ...value.verdicts }; delete v[sel.k]; onChange({ ...value, verdicts: v }) }}>Reset</Btn></>}</> :
          <Muted>{s.mode === 'verdict' ? 'Tap a link to confirm or reject it.' : s.mode === 'edit' ? (selN ? 'Now tap the node to link to.' : 'Tap a link to judge it, or tap two nodes to add a link.') : 'Tap nodes to select them.'}</Muted>}
      </Row>
    </div>)
}
export const graph: Def<S, V> = {
  Component: GraphView, initial: () => ({ verdicts: {}, added: [], selected: [] }),
  label: (s, v) => s.mode === 'select' ? `Selected: ${v.selected.map((id) => s.nodes.find((n) => n.id === id)?.label).join(', ')}` : `${Object.values(v.verdicts).filter((x) => x === 'yes').length} confirmed, ${Object.values(v.verdicts).filter((x) => x === 'no').length} rejected${v.added.length ? `, ${v.added.length} added` : ''}`,
  valid: (s, v) => s.mode === 'select' ? v.selected.length > 0 : s.mode === 'edit' ? true : s.edges.every((e) => !!v.verdicts[edgeKey(e)]),
}
