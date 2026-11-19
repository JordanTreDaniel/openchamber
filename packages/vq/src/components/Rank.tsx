import { useRef, useState } from 'react'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { Body, Btn, Img, Muted, imgMode } from '../prims'
import { T } from '../tokens'
import type { SpecOf } from '../types'

type S = SpecOf<'rank'>
const move = (a: string[], from: number, to: number) => { const n = a.slice(); const [x] = n.splice(from, 1); n.splice(to, 0, x); return n }
function RankView({ spec: s, value, onChange }: { spec: S; value: string[]; onChange: (v: string[]) => void }) {
  const tg = useTarget(); const bind = useDrag(); const rows = useRef<(HTMLDivElement | null)[]>([]); const [drag, setDrag] = useState<string | null>(null)
  const by = (id: string) => s.items.find((o) => o.id === id)!; const im = imgMode(s.items, s.images)
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {s.highLabel && <Muted style={{ fontSize: 12 }}>▲ {s.highLabel}</Muted>}
      {value.map((id, i) => { const o = by(id); const h = bind({
        onStart: () => setDrag(id), onEnd: () => setDrag(null),
        onMove: (p) => { const idx = value.indexOf(id); let t = 0; value.forEach((_, j) => { const r = rows.current[j]?.getBoundingClientRect(); if (j !== idx && r && r.top + r.height / 2 < p.cy) t++ }); if (t !== idx) onChange(move(value, idx, t)) } })
        return (
          <div key={id} ref={(el) => { rows.current[i] = el }} {...tg('item:' + id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: T.surface, border: `1px solid ${drag === id ? T.accent : T.border}`, borderRadius: T.radius, boxShadow: drag === id ? '0 6px 18px rgba(0,0,0,.35)' : undefined }}>
            <span {...h} aria-label={`Drag ${o.label}`} role="button" tabIndex={0} style={{ ...h.style, width: 36, height: 36, display: 'grid', placeItems: 'center', color: T.muted, fontSize: 20, flex: 'none' }}>⠿</span>
            <span style={{ width: 24, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            {im(o) !== null && <Img size={40} src={im(o) || undefined} label={o.label} />}
            <span style={{ flex: 1, display: 'grid', gap: 2 }}><b>{o.label}</b>{o.detail && <Body c={o.detail} />}</span>
            <Btn tone="ghost" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(value, i, i - 1))} style={{ padding: '4px 10px' }}>▲</Btn>
            <Btn tone="ghost" aria-label="Move down" disabled={i === value.length - 1} onClick={() => onChange(move(value, i, i + 1))} style={{ padding: '4px 10px' }}>▼</Btn>
          </div>) })}
      {s.lowLabel && <Muted style={{ fontSize: 12 }}>▼ {s.lowLabel}</Muted>}
    </div>)
}
export const rank: Def<S, string[]> = { Component: RankView, initial: (s) => s.items.map((o) => o.id), label: (s, v) => v.map((id, i) => `${i + 1}. ${s.items.find((o) => o.id === id)?.label}`).join('  '), valid: () => true }
