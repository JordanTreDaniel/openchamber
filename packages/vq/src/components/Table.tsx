import { useState } from 'react'
import type { Def } from '../Frame'
import { useTarget, useVQ } from '../hooks'
import { Btn, Img, Muted, Row } from '../prims'
import { series, T } from '../tokens'
import type { Option, SpecOf, Values } from '../types'

type S = SpecOf<'table'>; type V = Values['table']
const VERD: Option[] = [{ id: 'yes', label: 'Approve', color: '#3ecf8e' }, { id: 'no', label: 'Reject', color: '#ff6b5f' }]
const fmt = (k: string, v: string | number | undefined) => (v == null ? '' : k === 'money' && typeof v === 'number' ? '$' + v.toLocaleString('en-US') : k === 'number' && typeof v === 'number' ? v.toLocaleString('en-US') : String(v))
function TableView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const { compact } = useVQ(); const verd = s.verdicts === undefined ? undefined : s.verdicts.length ? s.verdicts : VERD
  const [sort, setSort] = useState<{ c: string; d: 1 | -1 } | null>(null)
  const get = (rid: string, cid: string) => value.edits[rid]?.[cid] ?? s.rows.find((r) => r.id === rid)!.cells[cid]
  const rows = sort ? [...s.rows].sort((a, b) => { const x = get(a.id, sort.c), y = get(b.id, sort.c); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.d }) : s.rows
  const setV = (rid: string, vid: string) => onChange({ ...value, verdicts: { ...value.verdicts, [rid]: value.verdicts[rid] === vid ? '' : vid } })
  const edit = (rid: string, cid: string, raw: string, kind: string) => onChange({ ...value, edits: { ...value.edits, [rid]: { ...value.edits[rid], [cid]: kind === 'number' || kind === 'money' ? (raw === '' ? '' : Number(raw)) : raw } } })
  const cell = (rid: string, c: S['columns'][number]) => {
    const v = get(rid, c.id)
    if (c.editable) return <input className="vq-input" style={{ minHeight: 36, padding: '4px 8px', minWidth: 90 }} aria-label={c.label} type={c.kind === 'number' || c.kind === 'money' ? 'number' : 'text'} inputMode={c.kind === 'text' ? undefined : 'decimal'} value={v ?? ''} onChange={(e) => edit(rid, c.id, e.target.value, c.kind)} />
    if (c.kind === 'image') return <Img size={40} src={String(v ?? '') || undefined} label={String(get(rid, s.columns.find((x) => x.kind !== 'image')?.id ?? c.id) ?? '')} />
    if (c.kind === 'badge') return <span style={{ padding: '2px 10px', borderRadius: 999, border: `1px solid ${series(String(v).length)}`, fontSize: 12 }}>{String(v)}</span>
    return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.kind, v)}</span>
  }
  const vbtn = (rid: string) => verd && <Row style={{ gap: 6, flexWrap: 'nowrap' }}>{verd.map((o, k) => { const on = value.verdicts[rid] === o.id; return <button key={o.id} type="button" aria-pressed={on} {...tg(`verdict:${rid}:${o.id}`)} onClick={() => setV(rid, o.id)} style={{ minHeight: 36, padding: '4px 12px', borderRadius: 10, cursor: 'pointer', font: 'inherit', fontSize: 13, whiteSpace: 'nowrap', border: `1px solid ${on ? o.color ?? series(k) : T.border}`, background: on ? o.color ?? series(k) : 'transparent', color: on ? '#0b0b0c' : T.text, fontWeight: on ? 700 : 400 }}>{o.label}</button> })}</Row>
  const bulk = verd && <Row style={{ gap: 6 }}><Muted>All rows:</Muted>{verd.map((o) => <Btn key={o.id} tone="ghost" style={{ padding: '4px 10px', minHeight: 32 }} onClick={() => onChange({ ...value, verdicts: Object.fromEntries(s.rows.map((r) => [r.id, o.id])) })}>{o.label}</Btn>)}</Row>
  if (compact) return (
    <div style={{ display: 'grid', gap: 10 }}>{bulk}{rows.map((r) => <div key={r.id} {...tg('row:' + r.id)} style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 12, display: 'grid', gap: 6, background: T.bg }}>
      {s.columns.map((c, i) => <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><span style={{ color: T.muted, fontSize: 12 }}>{c.label}</span><span style={{ fontWeight: i === 0 ? 650 : 400, textAlign: 'right' }}>{cell(r.id, c)}</span></div>)}{vbtn(r.id)}</div>)}</div>)
  return (
    <div style={{ display: 'grid', gap: 8 }}>{bulk}
      <div className="vq-scroll" style={{ border: `1px solid ${T.border}`, borderRadius: T.radius }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr>{s.columns.map((c) => <th key={c.id} {...tg('col:' + c.id)} onClick={() => setSort(sort?.c === c.id ? { c: c.id, d: (-sort.d) as 1 | -1 } : { c: c.id, d: 1 })} style={{ textAlign: c.kind === 'number' || c.kind === 'money' ? 'right' : 'left', padding: '10px 12px', color: T.muted, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', background: T.surface2 }}>{c.label}{sort?.c === c.id ? (sort.d > 0 ? ' ↑' : ' ↓') : ''}</th>)}{verd && <th style={{ padding: '10px 12px', textAlign: 'left', background: T.surface2, color: T.muted, fontSize: 12 }}>{s.verdictLabel}</th>}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} {...tg('row:' + r.id)} style={{ borderTop: `1px solid ${T.border}` }}>{s.columns.map((c, i) => <td key={c.id} style={{ padding: '8px 12px', textAlign: c.kind === 'number' || c.kind === 'money' ? 'right' : 'left', fontWeight: i === 0 ? 600 : 400 }}>{cell(r.id, c)}</td>)}{verd && <td style={{ padding: '6px 12px' }}>{vbtn(r.id)}</td>}</tr>)}</tbody>
        </table>
      </div>
    </div>)
}
export const table: Def<S, V> = {
  Component: TableView, initial: () => ({ verdicts: {}, edits: {} }),
  label: (s, v) => { const n = Object.values(v.verdicts).filter(Boolean).length, e = Object.values(v.edits).reduce((a, r) => a + Object.keys(r).length, 0); return [s.verdicts !== undefined && `${n}/${s.rows.length} rows decided`, e && `${e} cells edited`].filter(Boolean).join(', ') || 'No changes' },
  valid: (s, v) => s.verdicts === undefined || s.rows.every((r) => !!v.verdicts[r.id]),
}
