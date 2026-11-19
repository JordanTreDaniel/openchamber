import type { Def } from '../Frame'
import { useTarget } from '../hooks'
import { Chip, Muted, Row } from '../prims'
import { T } from '../tokens'
import type { SpecOf } from '../types'

type S = SpecOf<'field'>; type V = string | number
const HEX = /^#[0-9a-fA-F]{6}$/
const ok = (s: S, v: V) => {
  if (s.kind === 'number' || s.kind === 'money') return typeof v === 'number' && Number.isFinite(v) && (s.min == null || v >= s.min) && (s.max == null || v <= s.max)
  if (s.kind === 'color') return HEX.test(String(v)); if (s.kind === 'url') return /^https?:\/\/\S+\.\S+/.test(String(v))
  return String(v).trim().length > 0
}
function FieldView({ spec: s, value, onChange }: { spec: S; value: V; onChange: (v: V) => void }) {
  const tg = useTarget(); const str = String(value ?? '')
  const num = (e: string) => (e === '' ? ('' as unknown as number) : Number(e))
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {s.kind === 'long' ? <textarea {...tg('input')} className="vq-input" rows={5} value={str} placeholder={s.placeholder} aria-label={s.title ?? 'Answer'} onChange={(e) => onChange(e.target.value)} />
        : s.kind === 'color' ? <Row><input {...tg('picker')} type="color" aria-label="Pick a color" value={HEX.test(str) ? str : '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 56, height: 44, padding: 2, border: `1px solid ${T.border}`, borderRadius: 10, background: T.bg }} /><input {...tg('input')} className="vq-input" style={{ width: 130, fontFamily: T.mono }} value={str} placeholder="#rrggbb" aria-label="Hex color" onChange={(e) => onChange(e.target.value)} /></Row>
        : <div style={{ position: 'relative' }}>
            {s.kind === 'money' && <span style={{ position: 'absolute', left: 12, top: 11, color: T.muted }}>{s.currency}</span>}
            <input {...tg('input')} className="vq-input" style={{ paddingLeft: s.kind === 'money' ? 26 : undefined, paddingRight: s.unit ? 56 : undefined, fontFamily: s.kind === 'path' ? T.mono : undefined }} type={s.kind === 'number' || s.kind === 'money' ? 'number' : s.kind === 'url' ? 'url' : 'text'} inputMode={s.kind === 'number' || s.kind === 'money' ? 'decimal' : undefined} min={s.min} max={s.max} value={str} placeholder={s.placeholder} aria-label={s.title ?? 'Answer'} onChange={(e) => onChange(s.kind === 'number' || s.kind === 'money' ? num(e.target.value) : e.target.value)} />
            {s.unit && <span style={{ position: 'absolute', right: 12, top: 11, color: T.muted }}>{s.unit}</span>}</div>}
      {s.suggestions && <Row>{s.suggestions.map((x) => <Chip key={x} on={str === x} {...tg('suggestion:' + x)} onClick={() => onChange(s.kind === 'number' || s.kind === 'money' ? Number(x) : x)}>{x}</Chip>)}</Row>}
      {str !== '' && !ok(s, value) && <Muted style={{ color: T.danger }}>{s.kind === 'url' ? 'Enter a full URL starting with http' : s.kind === 'color' ? 'Use a hex color like #3366ff' : 'Value is out of range'}</Muted>}
    </div>)
}
export const field: Def<S, V> = {
  Component: FieldView, initial: (s) => s.default ?? '',
  label: (s, v) => (s.kind === 'money' ? s.currency + v : s.unit ? `${v} ${s.unit}` : s.kind === 'long' && String(v).length > 80 ? String(v).slice(0, 77) + '…' : String(v)), valid: ok,
}
