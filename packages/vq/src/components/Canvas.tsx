import { useRef, useState } from 'react'
import { clamp, toExcalidraw } from '../core'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { Btn, Chip, Muted, Row, SvgBox, imgUri } from '../prims'
import { T } from '../tokens'
import type { Mark, SpecOf, Values } from '../types'

type S = SpecOf<'canvas'>; type V = Values['canvas']; type Tool = 'point' | 'box' | 'arrow' | 'ink' | 'pick'
const nid = (m: Mark[]) => 'm' + (m.reduce((a, x) => Math.max(a, Number(x.id.slice(1)) || 0), 0) + 1)
function CanvasView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const ref = useRef<SVGSVGElement>(null); const bind = useDrag(ref); const tg = useTarget(); const dims = useRef({ w: 1, h: 1 }); const [copied, setCopied] = useState(false)
  const tools: Tool[] = [...(s.targets ? (['pick'] as Tool[]) : []), ...s.tools]; const [tool, setTool] = useState<Tool>(tools[0]); const M = value.marks; const cur = useRef<Mark[]>(M)
  cur.current = M
  const names: Record<Tool, string> = { point: 'Point', box: 'Box', arrow: 'Arrow', ink: 'Draw', pick: 'Pick' }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Row>{tools.map((t) => <Chip key={t} on={tool === t} onClick={() => setTool(t)}>{names[t]}</Chip>)}<span style={{ flex: 1 }} />
        <Btn tone="ghost" disabled={!M.length} onClick={() => onChange({ marks: M.slice(0, -1) })}>Undo</Btn><Btn tone="ghost" disabled={!M.length} onClick={() => onChange({ marks: [] })}>Clear</Btn>
        <Btn tone="ghost" disabled={!M.length} onClick={() => { navigator.clipboard?.writeText(JSON.stringify(toExcalidraw(M, dims.current.w, dims.current.h))); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy Excalidraw'}</Btn></Row>
      <SvgBox h={(w) => Math.round(w / s.aspect)} svgRef={ref}>{(W) => {
        const H = Math.round(W / s.aspect); dims.current = { w: W, h: H }; const nx = (x: number) => clamp(x / W, 0, 1), ny = (y: number) => clamp(y / H, 0, 1)
        const upd = (f: (m: Mark) => Mark) => { const a = cur.current.slice(); a[a.length - 1] = f(a[a.length - 1]); cur.current = a; onChange({ marks: a }) }
        const draw = tool === 'pick' ? undefined : bind({
          onStart: (p) => { const id = nid(cur.current), x = nx(p.x), y = ny(p.y); const m: Mark = tool === 'point' ? { id, kind: 'point', x, y } : tool === 'box' ? { id, kind: 'box', x, y, w: 0, h: 0 } : tool === 'arrow' ? { id, kind: 'arrow', x, y, x2: x, y2: y } : { id, kind: 'ink', points: [[x, y]] }; cur.current = [...cur.current, m]; onChange({ marks: cur.current }) },
          onMove: (p) => upd((m) => m.kind === 'box' ? { ...m, w: nx(p.x) - m.x, h: ny(p.y) - m.y } : m.kind === 'arrow' ? { ...m, x2: nx(p.x), y2: ny(p.y) } : m.kind === 'ink' ? (Math.hypot((nx(p.x) - m.points[m.points.length - 1][0]) * W, (ny(p.y) - m.points[m.points.length - 1][1]) * H) > 3 ? { ...m, points: [...m.points, [nx(p.x), ny(p.y)]] } : m) : m),
          onEnd: () => upd((m) => m.kind === 'box' ? { ...m, x: m.w < 0 ? m.x + m.w : m.x, y: m.h < 0 ? m.y + m.h : m.y, w: Math.abs(m.w), h: Math.abs(m.h) } : m) })
        return <g>
          <defs><marker id="vqarr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill={T.danger} /></marker></defs>
          <rect {...tg('canvas')} width={W} height={H} rx={12} fill={T.bg} stroke={T.border} />{s.src && <image href={imgUri(s.src)} width={W} height={H} preserveAspectRatio="xMidYMid slice" pointerEvents="none" style={{ clipPath: 'inset(0 round 12px)' }} />}
          {s.targets?.map((t) => { const on = M.some((m) => m.kind === 'target' && m.target === t.id); return <g key={t.id} {...tg('target:' + t.id)} onClick={() => { if (tool !== 'pick') return; onChange({ marks: on ? M.filter((m) => !(m.kind === 'target' && m.target === t.id)) : [...M, { id: nid(M), kind: 'target', target: t.id }] }) }} style={{ cursor: tool === 'pick' ? 'pointer' : 'default' }}>
            <rect x={t.x * W} y={t.y * H} width={t.w * W} height={t.h * H} rx={6} fill={on ? T.accent : 'transparent'} fillOpacity={0.25} stroke={on ? T.accent : T.muted} strokeWidth={on ? 3 : 1.5} strokeDasharray={on ? undefined : '5 4'} /><text x={t.x * W + 6} y={t.y * H + 16} style={{ fill: T.text, fontSize: 12, paintOrder: 'stroke', stroke: T.surface, strokeWidth: 3 }}>{t.label}</text></g> })}
          <rect width={W} height={H} fill="transparent" {...(draw ?? {})} style={{ ...(draw?.style ?? {}), cursor: tool === 'pick' ? 'default' : 'crosshair' }} pointerEvents={tool === 'pick' ? 'none' : 'all'} />
          {M.map((m) => m.kind === 'point' ? <g key={m.id} {...tg('mark:' + m.id)}><circle cx={m.x * W} cy={m.y * H} r={11} fill={T.danger} fillOpacity={0.25} stroke={T.danger} strokeWidth={3} /></g>
            : m.kind === 'box' ? <rect key={m.id} {...tg('mark:' + m.id)} x={m.x * W} y={m.y * H} width={m.w * W} height={m.h * H} fill={T.danger} fillOpacity={0.08} stroke={T.danger} strokeWidth={3} rx={4} />
            : m.kind === 'arrow' ? <line key={m.id} {...tg('mark:' + m.id)} x1={m.x * W} y1={m.y * H} x2={m.x2 * W} y2={m.y2 * H} stroke={T.danger} strokeWidth={3} markerEnd="url(#vqarr)" />
            : m.kind === 'ink' ? <polyline key={m.id} {...tg('mark:' + m.id)} points={m.points.map(([x, y]) => `${x * W},${y * H}`).join(' ')} fill="none" stroke={T.danger} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /> : null)}
        </g>
      }}</SvgBox>
      <Muted>{M.length ? `${M.filter((m) => m.kind !== 'target').length} mark${M.length === 1 ? '' : 's'}${M.some((m) => m.kind === 'target') ? ', ' + M.filter((m) => m.kind === 'target').length + ' picked' : ''}` : s.targets ? 'Pick the element(s) in question, or mark up the image.' : 'Mark what you mean: point, box, arrow or draw.'}</Muted>
    </div>)
}
export const canvas: Def<S, V> = {
  Component: CanvasView, initial: () => ({ marks: [] }),
  label: (s, v) => { const t = v.marks.filter((m) => m.kind === 'target').map((m) => s.targets?.find((x) => x.id === (m as any).target)?.label ?? (m as any).target); const o = v.marks.filter((m) => m.kind !== 'target'); return [t.length && `Picked: ${t.join(', ')}`, o.length && `${o.length} mark${o.length === 1 ? '' : 's'} (${[...new Set(o.map((m) => m.kind))].join(', ')})`].filter(Boolean).join('; ') },
  valid: (_s, v) => v.marks.length > 0,
}
