import { useMemo, useState } from 'react'
import { childrenMap, isDescendant, treeLayout } from '../core'
import type { Def } from '../Frame'
import { useTarget } from '../hooks'
import { Body, Btn, Img, Muted, Row, SvgBox, SvgImg, imgMode } from '../prims'
import { T } from '../tokens'
import type { SpecOf, Values } from '../types'

type S = SpecOf<'tree'>; type V = Values['tree']
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
function TreeView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const [moving, setMoving] = useState(false); const [shut, setShut] = useState<string[]>([])
  const by = (id: string) => s.nodes.find((n) => n.id === id)!; const im = imgMode(s.nodes, s.images)
  const { kids, roots } = useMemo(() => childrenMap(s.nodes, value.parents), [s, value.parents])
  const tap = (id: string) => {
    if (moving && value.selected && id !== value.selected && !isDescendant(s.nodes, value.parents, value.selected, id)) { onChange({ ...value, parents: { ...value.parents, [value.selected]: id } }); return setMoving(false) }
    setMoving(false); onChange({ ...value, selected: value.selected === id ? null : id })
  }
  const bar = value.selected && (
    <Row style={{ minHeight: 40 }}><Muted style={{ color: T.text }}>{by(value.selected).label}</Muted>
      {s.mode === 'edit' && <><Btn onClick={() => setMoving(!moving)} tone={moving ? 'primary' : undefined}>{moving ? 'Tap the new parent…' : 'Move under…'}</Btn><Btn onClick={() => { onChange({ ...value, parents: { ...value.parents, [value.selected!]: null } }); setMoving(false) }}>Make top level</Btn></>}</Row>)
  if (s.skin === 'chart') {
    const pos = treeLayout(s.nodes, value.parents)
    const levels = (() => { let m = 0; const d = (id: string, k: number): void => { m = Math.max(m, k); (kids[id] || []).forEach((c) => d(c, k + 1)) }; roots.forEach((r) => d(r, 0)); return m + 1 })()
    const leaves = Math.max(1, s.nodes.filter((n) => !(kids[n.id] || []).length).length)
    return (
      <div style={{ display: 'grid', gap: 10 }}><div className="vq-scroll">
        <SvgBox minW={levels * 150} h={Math.max(160, leaves * 54 + 16)}>{(W) => { const H = Math.max(160, leaves * 54 + 16), nw = Math.min(150, W / levels - 20), X = (id: string) => 8 + pos[id].x * (W - 16 - nw), Y = (id: string) => 24 + pos[id].y * (H - 48)
          return <g>{s.nodes.filter((n) => pos[n.id]).map((n) => { const p = (n.id in value.parents ? value.parents[n.id] : n.parent); return p && pos[p] ? <path key={'e' + n.id} d={`M${X(p) + nw} ${Y(p)}C${(X(p) + nw + X(n.id)) / 2} ${Y(p)} ${(X(p) + nw + X(n.id)) / 2} ${Y(n.id)} ${X(n.id)} ${Y(n.id)}`} fill="none" stroke={T.border} strokeWidth={2} /> : null })}
            {s.nodes.filter((n) => pos[n.id]).map((n) => { const on = value.selected === n.id; return <g key={n.id} {...tg('node:' + n.id)} onClick={() => tap(n.id)} style={{ cursor: 'pointer' }}><rect x={X(n.id)} y={Y(n.id) - 19} width={nw} height={38} rx={10} fill={n.color ?? T.surface2} stroke={on ? T.accent : moving ? T.warn : T.border} strokeWidth={on ? 3 : 1.5} />{im(n) !== null && <SvgImg cx={X(n.id) + 22} cy={Y(n.id)} size={26} src={im(n) || undefined} label={n.label} />}<text x={X(n.id) + (im(n) !== null ? 40 : nw / 2)} y={Y(n.id) + 4} textAnchor={im(n) !== null ? 'start' : 'middle'} style={{ fill: n.color ? '#0b0b0c' : T.text, fontSize: 12, fontWeight: 600 }}>{cut(n.label, Math.floor((nw - (im(n) !== null ? 46 : 0)) / 7.5))}</text></g> })}</g> }}</SvgBox>
      </div>{bar}</div>)
  }
  const row = (id: string, d: number): any => {
    const n = by(id), k = kids[id] || [], open = !shut.includes(id), on = value.selected === id
    return <div key={id}>
      <div {...tg('node:' + id)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: d * 18 }}>
        <button type="button" aria-label={open ? 'Collapse' : 'Expand'} disabled={!k.length} onClick={() => setShut(open ? [...shut, id] : shut.filter((x) => x !== id))} style={{ width: 32, height: 40, background: 'none', border: 0, color: T.muted, cursor: k.length ? 'pointer' : 'default', font: 'inherit' }}>{k.length ? (open ? '▾' : '▸') : '·'}</button>
        <button type="button" className="vq-opt" aria-pressed={on} onClick={() => tap(id)} style={{ flex: 1, minHeight: 40, padding: '6px 12px', borderColor: moving && !on ? T.warn : undefined }}><span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{im(n) !== null && <Img size={32} radius={8} src={im(n) || undefined} label={n.label} />}<span><b>{n.label}</b>{n.detail && <div><Body c={n.detail} /></div>}</span></span></button></div>
      {open && k.map((c) => row(c, d + 1))}</div>
  }
  return <div style={{ display: 'grid', gap: 6 }}>{roots.map((r) => row(r, 0))}{bar}</div>
}
export const tree: Def<S, V> = {
  Component: TreeView, initial: (s) => ({ parents: Object.fromEntries(s.nodes.map((n) => [n.id, n.parent])), selected: null }),
  label: (s, v) => { const moved = s.nodes.filter((n) => v.parents[n.id] !== n.parent); return [v.selected && `Selected ${s.nodes.find((n) => n.id === v.selected)?.label}`, moved.length && `moved: ${moved.map((n) => `${n.label} → ${v.parents[n.id] ? s.nodes.find((x) => x.id === v.parents[n.id])?.label : 'top level'}`).join(', ')}`].filter(Boolean).join('; ') || 'No change' },
  valid: (s, v) => s.mode === 'edit' || v.selected != null,
}
