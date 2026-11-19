import { useRef, useState } from 'react'
import { brMatch, brPick, brStart, insAnswer, insMaxSteps, insProbe, insStart } from '../core'
import type { Def } from '../Frame'
import { useDrag, useTarget } from '../hooks'
import { Body, Btn, Img, Muted, Row, clamp, glyphUri, imgMode, imgUri } from '../prims'
import { T } from '../tokens'
import type { Option, SpecOf, Values } from '../types'

type S = SpecOf<'duel'>; type V = Values['duel']
function Card({ o, onPick, label, img }: { o: Option; onPick: () => void; label?: string; img?: string | null }) {
  const tg = useTarget()
  return (
    <button type="button" className="vq-opt" {...tg('option:' + o.id)} onClick={onPick} style={{ flex: '1 1 200px', display: 'grid', gap: 8, alignContent: 'start', minHeight: 120 }}>
      {label && <span style={{ fontSize: 11, color: T.muted, letterSpacing: 1 }}>{label}</span>}
      {img != null && <Img ratio="16/10" src={img || undefined} label={o.label} style={{ width: '100%' }} />}
      <span style={{ fontWeight: 650 }}>{o.label}</span>{o.detail && <Body c={o.detail} />}
    </button>
  )
}
function Slider({ a, b, onPick }: { a: Option; b: Option; onPick: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null); const [x, setX] = useState(0.5); const bind = useDrag()
  const d = bind({ onMove: (p) => { const r = box.current!.getBoundingClientRect(); setX(clamp((p.cx - r.left) / r.width, 0, 1)) }, onStart: (p) => { const r = box.current!.getBoundingClientRect(); setX(clamp((p.cx - r.left) / r.width, 0, 1)) } })
  const img = (o: Option) => imgUri(o.image ?? (typeof o.detail === 'object' && (o.detail.kind === 'image' || o.detail.kind === 'svg') ? o.detail.value : '') ) || glyphUri(o.label)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div ref={box} {...d} style={{ ...d.style, position: 'relative', aspectRatio: '16/10', borderRadius: 12, overflow: 'hidden', background: T.bg, cursor: 'ew-resize' }}>
        <img src={img(b)} alt={b.label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
        <img src={img(a)} alt={a.label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', clipPath: `inset(0 ${(1 - x) * 100}% 0 0)` }} draggable={false} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${x * 100}%`, width: 3, background: '#fff', boxShadow: '0 0 6px rgba(0,0,0,.5)' }} />
        <div style={{ position: 'absolute', top: '50%', left: `${x * 100}%`, width: 36, height: 36, margin: '-18px 0 0 -18px', borderRadius: 18, background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,.4)' }} />
      </div>
      <Row style={{ justifyContent: 'space-between' }}><Btn onClick={() => onPick(a.id)}>Prefer {a.label}</Btn><Btn onClick={() => onPick(b.id)}>Prefer {b.label}</Btn></Row>
    </div>)
}
function DuelView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const im = imgMode(s.options, s.images); const ids = s.options.map((o) => o.id); const by = (id: string) => s.options.find((o) => o.id === id)!
  const [ins, setIns] = useState(() => insStart(ids)); const [insH, setInsH] = useState<typeof ins[]>([])
  const [br, setBr] = useState(() => brStart(ids)); const [brH, setBrH] = useState<typeof br[]>([])
  if (s.mode === 'pair') {
    const [a, b] = s.options
    return <Row style={{ alignItems: 'stretch' }}><Card img={im(a)} o={a} label="A" onPick={() => onChange({ winner: a.id })} /><span style={{ alignSelf: 'center', color: T.muted }}>vs</span><Card img={im(b)} o={b} label="B" onPick={() => onChange({ winner: b.id })} /></Row>
  }
  if (s.mode === 'slider') return <Slider a={s.options[0]} b={s.options[1]} onPick={(id) => onChange({ winner: id })} />
  if (s.mode === 'bracket') {
    const m = brMatch(br)
    if (br.champion) return <div style={{ display: 'grid', gap: 8 }}><Muted>Winner</Muted><Card img={im(by(br.champion))} o={by(br.champion)} onPick={() => {}} /><Btn onClick={() => { setBr(brHistoryBack(brH, setBrH, br)); onChange({}) }} tone="ghost">Undo last</Btn></div>
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <Muted>Round {br.round} · {br.pending.length / 2 | 0} match{(br.pending.length / 2 | 0) === 1 ? '' : 'es'} left</Muted>
        <Row style={{ alignItems: 'stretch' }}>{m!.map((id, i) => <Card key={id} img={im(by(id))} o={by(id)} label={i ? 'B' : 'A'} onPick={() => { const n = brPick(br, id); setBrH([...brH, br]); setBr(n); if (n.champion) onChange({ winner: n.champion }) }} />)}</Row>
        {brH.length > 0 && <Btn tone="ghost" onClick={() => setBr(brHistoryBack(brH, setBrH, br))}>Undo last</Btn>}
      </div>)
  }
  const probe = insProbe(ins)
  if (!probe) return <div style={{ display: 'grid', gap: 6 }}><Muted>Your ranking, best first</Muted>{ins.sorted.map((id, i) => <div key={id} className="vq-opt" style={{ cursor: 'default' }}><b>{i + 1}.</b> {by(id).label}</div>)}<Btn tone="ghost" onClick={() => { const p = insH[insH.length - 1]; if (p) { setInsH(insH.slice(0, -1)); setIns(p); onChange({}) } }}>Undo last</Btn></div>
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Muted>Which is better? About {Math.max(0, insMaxSteps(ids.length) - insH.length)} comparisons at most</Muted>
      <Row style={{ alignItems: 'stretch' }}>{[probe.item, probe.against].map((id, i) => <Card key={id} img={im(by(id))} o={by(id)} label={i ? 'B' : 'A'} onPick={() => { const n = insAnswer(ins, i === 0); setInsH([...insH, ins]); setIns(n); if (!insProbe(n)) onChange({ ranking: n.sorted }) }} />)}</Row>
      {insH.length > 0 && <Btn tone="ghost" onClick={() => { setIns(insH[insH.length - 1]); setInsH(insH.slice(0, -1)) }}>Undo last</Btn>}
    </div>)
}
function brHistoryBack<T>(h: T[], set: (h: T[]) => void, cur: T): T { const p = h[h.length - 1]; if (!p) return cur; set(h.slice(0, -1)); return p }
export const duel: Def<S, V> = {
  Component: DuelView, initial: () => ({}),
  label: (s, v) => v.ranking ? v.ranking.map((id, i) => `${i + 1}. ${s.options.find((o) => o.id === id)?.label}`).join('  ') : `Winner: ${s.options.find((o) => o.id === v.winner)?.label ?? '?'}`,
  valid: (_s, v) => !!v.winner || !!v.ranking,
}
