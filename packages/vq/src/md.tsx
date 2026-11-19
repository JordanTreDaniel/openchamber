import { useState, type ReactNode } from 'react'
import { Img } from './prims'
import { T } from './tokens'

// ---------- safe markdown: no HTML injection, http(s) links only ----------
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g
export function inline(src: string): ReactNode[] {
  const out: ReactNode[] = []; let last = 0, m: RegExpExecArray | null, k = 0; INLINE.lastIndex = 0
  while ((m = INLINE.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index)); const t = m[0]
    if (m[1]) out.push(<code key={k++} style={{ fontFamily: T.mono, fontSize: '0.9em', background: T.bg, padding: '1px 5px', borderRadius: 5 }}>{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else if (m[3]) out.push(<em key={k++}>{t.slice(1, -1)}</em>)
    else { const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!; out.push(<a key={k++} href={lm[2]} target="_blank" rel="noopener noreferrer" style={{ color: T.accent }}>{lm[1]}</a>) }
    last = m.index + t.length
  }
  if (last < src.length) out.push(src.slice(last)); return out
}
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
export function Md({ src }: { src: string }) {
  const L = src.replace(/\r/g, '').split('\n'), out: ReactNode[] = []; let i = 0, k = 0, para: string[] = []
  const flush = () => { if (para.length) { out.push(<p key={k++} style={{ margin: '0 0 8px' }}>{inline(para.join(' '))}</p>); para = [] } }
  while (i < L.length) {
    const l = L[i]
    if (/^```/.test(l)) { flush(); const buf: string[] = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; out.push(<pre key={k++} style={{ margin: '0 0 8px', padding: 8, borderRadius: 8, background: T.bg, font: `12px ${T.mono}`, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{buf.join('\n')}</pre>); continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(l); if (h) { flush(); out.push(<div key={k++} role="heading" aria-level={h[1].length} style={{ fontWeight: 650, fontSize: [20, 17, 15, 14][h[1].length - 1], margin: '10px 0 6px' }}>{inline(h[2])}</div>); i++; continue }
    if (/^---+\s*$/.test(l)) { flush(); out.push(<hr key={k++} style={{ border: 0, borderTop: `1px solid ${T.border}`, margin: '10px 0' }} />); i++; continue }
    if (/^\s*\|/.test(l) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
      flush(); const head = cells(l); i += 2; const rows: string[][] = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(cells(L[i++]))
      out.push(<div key={k++} className="vq-scroll" style={{ margin: '0 0 8px' }}><table style={{ borderCollapse: 'collapse', fontSize: 13 }}><thead><tr>{head.map((c, j) => <th key={j} style={{ textAlign: 'left', padding: '4px 10px', borderBottom: `1px solid ${T.border}`, color: T.muted }}>{inline(c)}</th>)}</tr></thead><tbody>{rows.map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j} style={{ padding: '4px 10px', borderBottom: `1px solid ${T.border}` }}>{inline(c)}</td>)}</tr>)}</tbody></table></div>); continue
    }
    if (/^>\s?/.test(l)) { flush(); const buf: string[] = []; while (i < L.length && /^>\s?/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, '')); out.push(<blockquote key={k++} style={{ margin: '0 0 8px', padding: '2px 12px', borderLeft: `3px solid ${T.border}`, color: T.muted }}>{inline(buf.join(' '))}</blockquote>); continue }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      flush(); const ord = /^\s*\d+\./.test(l), items: ReactNode[] = []
      while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) { const t = L[i].replace(/^\s*([-*]|\d+\.)\s+/, ''), task = /^\[([ xX])\]\s+(.*)$/.exec(t); items.push(<li key={i} style={{ margin: '2px 0', listStyle: task ? 'none' : undefined }}>{task ? <><span aria-hidden style={{ marginRight: 6 }}>{task[1] === ' ' ? '☐' : '☑'}</span>{inline(task[2])}</> : inline(t)}</li>); i++ }
      out.push(ord ? <ol key={k++} style={{ margin: '0 0 8px', paddingLeft: 22 }}>{items}</ol> : <ul key={k++} style={{ margin: '0 0 8px', paddingLeft: 22 }}>{items}</ul>); continue
    }
    if (!l.trim()) flush(); else para.push(l.trim()); i++
  }
  flush(); return <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>{out}</div>
}

// ---------- JSON viewer ----------
export function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null) return <span style={{ color: T.muted }}>null</span>
  if (typeof value === 'string') return <span style={{ color: T.ok }}>"{value}"</span>
  if (typeof value === 'number') return <span style={{ color: T.warn }}>{String(value)}</span>
  if (typeof value === 'boolean') return <span style={{ color: T.accent }}>{String(value)}</span>
  if (typeof value !== 'object' || depth > 8) return <span>{String(value)}</span>
  const arr = Array.isArray(value), entries: [string, unknown][] = (arr ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown]) : Object.entries(value as object)).slice(0, 200)
  if (!entries.length) return <span style={{ color: T.muted }}>{arr ? '[]' : '{}'}</span>
  return (
    <details open={depth < 2} style={{ marginLeft: depth ? 14 : 0 }}>
      <summary style={{ cursor: 'pointer', color: T.muted, listStyle: 'revert' }}>{arr ? `[ ${entries.length} ]` : `{ ${entries.length} }`}</summary>
      {entries.map(([k, v]) => <div key={k} style={{ marginLeft: 14 }}><span style={{ color: T.text }}>{arr ? '' : k + ': '}</span><JsonView value={v} depth={depth + 1} /></div>)}
    </details>)
}

// ---------- context blocks: any data the agent wants on screen while talking ----------
export interface CtxBlock { kind: 'markdown' | 'json' | 'table' | 'kv' | 'checklist' | 'image' | 'text' | 'code'; title?: string; value?: unknown }
const S = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
export function Block({ b, id, checks, onCheck }: { b: CtxBlock; id: string; checks: string[]; onCheck: (key: string) => void }) {
  const v = b.value
  switch (b.kind) {
    case 'markdown': return <Md src={S(v)} />
    case 'json': return <div style={{ font: `12px/1.6 ${T.mono}`, overflowX: 'auto' }}><JsonView value={v} /></div>
    case 'text': return <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{S(v)}</div>
    case 'code': return <pre style={{ margin: 0, padding: 8, borderRadius: 8, background: T.bg, font: `12px ${T.mono}`, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{S(v)}</pre>
    case 'image': return <Img src={S(v)} label={b.title ?? 'image'} radius={10} fit="contain" style={{ maxHeight: 260 }} />
    case 'kv': { const e = Array.isArray(v) ? (v as [unknown, unknown][]).map(([a, c]) => [S(a), c] as [string, unknown]) : Object.entries((v ?? {}) as object); return <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(90px,max-content) 1fr', gap: '4px 14px', fontSize: 14 }}>{e.map(([a, c]) => [<dt key={a + 'k'} style={{ color: T.muted }}>{a}</dt>, <dd key={a + 'v'} style={{ margin: 0, overflowWrap: 'anywhere' }}>{S(c)}</dd>])}</dl> }
    case 'table': {
      const raw = (Array.isArray(v) ? v : (v as { rows?: unknown[] })?.rows ?? []) as unknown[], first = raw[0]
      const cols = (!Array.isArray(v) && (v as { columns?: string[] })?.columns) || (first && !Array.isArray(first) && typeof first === 'object' ? Object.keys(first as object) : undefined)
      const rows = raw.map((r) => (Array.isArray(r) ? r : cols ? cols.map((c) => (r as Record<string, unknown>)[c]) : [r]))
      return <div className="vq-scroll"><table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: '100%' }}>{cols && <thead><tr>{cols.map((c) => <th key={c} style={{ textAlign: 'left', padding: '4px 10px', color: T.muted, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead>}<tbody>{rows.map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j} style={{ padding: '4px 10px', borderBottom: `1px solid ${T.border}` }}>{S(c)}</td>)}</tr>)}</tbody></table></div>
    }
    case 'checklist': { const items = ((v as unknown[]) ?? []).map((x) => (typeof x === 'string' ? x : S((x as { label?: string }).label ?? x)))
      return <div style={{ display: 'grid', gap: 4 }}>{items.map((it) => { const key = `${id}::${it}`, on = checks.includes(key); return <button key={key} type="button" role="checkbox" aria-checked={on} onClick={() => onCheck(key)} style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', minHeight: 40, padding: '4px 8px', background: 'transparent', border: 0, color: T.text, font: 'inherit', cursor: 'pointer', textDecoration: on ? 'line-through' : undefined, opacity: on ? 0.6 : 1 }}><span aria-hidden style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${on ? T.ok : T.border}`, background: on ? T.ok : 'transparent', flex: 'none', display: 'grid', placeItems: 'center', color: '#06140d', fontSize: 13 }}>{on ? '✓' : ''}</span>{it}</button> })}</div> }
    default: return null
  }
}
export function ContextView({ blocks, id, checks, onCheck }: { blocks: CtxBlock[]; id: string; checks: string[]; onCheck: (key: string) => void }) {
  const [i, setI] = useState(0); const cur = blocks[Math.min(i, blocks.length - 1)]
  if (!blocks.length) return null
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, background: T.bg }}>
      {blocks.length > 1 && <div role="tablist" style={{ display: 'flex', gap: 6, padding: 8, overflowX: 'auto', borderBottom: `1px solid ${T.border}` }}>{blocks.map((b, j) => <button key={j} role="tab" aria-selected={j === i} type="button" className="vq-chip" aria-pressed={j === i} onClick={() => setI(j)} style={{ whiteSpace: 'nowrap', minHeight: 34, padding: '4px 12px' }}>{b.title ?? b.kind}</button>)}</div>}
      <div data-vq={`context:${Math.min(i, blocks.length - 1)}`} style={{ padding: 12, maxHeight: 320, overflowY: 'auto' }}>
        {blocks.length === 1 && cur.title && <div style={{ fontWeight: 650, marginBottom: 6 }}>{cur.title}</div>}
        <Block b={cur} id={`${id}:${Math.min(i, blocks.length - 1)}`} checks={checks} onCheck={onCheck} />
      </div>
    </div>)
}
