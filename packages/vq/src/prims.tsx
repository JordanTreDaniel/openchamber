import { useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useSize } from './hooks'
import { T } from './tokens'
import type { Content } from './types'

export function Btn({ tone, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'ok' | 'danger' | 'ghost' }) {
  return <button type="button" className="vq-btn" data-tone={tone} {...p} />
}
export function Chip({ on, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return <button type="button" className="vq-chip" aria-pressed={!!on} {...p}>{children}</button>
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const snap = (v: number, step: number, min = 0) => Math.round((v - min) / step) * step + min
export const pct = (n: number) => Math.round(n * 100)

// ---------- images (first-class): url | data URI | inline <svg> markup | generated glyph ----------
/** Inline <svg> markup becomes a data URI so it renders as an image: scripts and external loads never run. */
export const imgUri = (src: string) => (src.trimStart().startsWith('<svg') ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src.trim()) : src)
const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }
/** Deterministic SVG placeholder: gradient from the label, with its initial. The default when an item has no image. */
export function glyphUri(label: string): string {
  const h = hash(label) % 360, ch = (label.match(/[A-Za-z0-9\u00C0-\uFFFF]/)?.[0] ?? '?').toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},60%,52%)"/><stop offset="1" stop-color="hsl(${(h + 45) % 360},62%,36%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="43" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="#fff" fill-opacity=".92">${ch.replace(/[<>&]/g, '')}</text></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
/** Decide per item: null = no image slot, '' = generated glyph, otherwise the image source. */
export function imgMode(items: { image?: string }[], mode: 'auto' | 'always' | 'never') {
  const any = items.some((i) => i.image)
  return (o: { image?: string }): string | null => (mode === 'never' ? null : o.image ? o.image : mode === 'always' || any ? '' : null)
}
export function Img({ src, label, size, ratio, fit = 'cover', radius = 8, style }: { src?: string; label: string; size?: number; ratio?: string; fit?: 'cover' | 'contain'; radius?: number | string; style?: CSSProperties }) {
  const [bad, setBad] = useState(false)
  const s = !src || bad ? glyphUri(label) : imgUri(src)
  return <img src={s} alt={label} loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)}
    style={{ display: 'block', width: size ?? '100%', height: size ?? (ratio ? '100%' : 'auto'), aspectRatio: size ? undefined : ratio, objectFit: fit, borderRadius: radius, flex: 'none', background: T.surface2, ...style }} />
}
/** Image inside SVG, clipped to a circle or rounded square centred on (cx, cy). */
export function SvgImg({ cx, cy, size, src, label, round = true }: { cx: number; cy: number; size: number; src?: string; label: string; round?: boolean }) {
  const id = 'c' + useId().replace(/:/g, ''); const r = size / 2
  return (
    <g pointerEvents="none"><clipPath id={id}>{round ? <circle cx={cx} cy={cy} r={r} /> : <rect x={cx - r} y={cy - r} width={size} height={size} rx={size * 0.2} />}</clipPath>
      <image href={src ? imgUri(src) : glyphUri(label)} x={cx - r} y={cy - r} width={size} height={size} clipPath={`url(#${id})`} preserveAspectRatio="xMidYMid slice" /></g>)
}

/** Renders a content block. Plain strings are text. */
export function Body({ c, style }: { c?: Content; style?: CSSProperties }) {
  if (c == null) return null
  const o = typeof c === 'string' ? { kind: 'text' as const, value: c } : c
  switch (o.kind) {
    case 'image': case 'svg': return <Img src={o.value} label={o.alt ?? ''} radius={8} style={{ maxWidth: '100%', ...style }} />
    case 'swatch': return <span style={{ display: 'inline-block', width: 28, height: 28, borderRadius: 8, background: o.value, border: `1px solid ${T.border}`, ...style }} />
    case 'audio': return <audio controls src={o.value} style={{ width: '100%', ...style }} />
    case 'code': return <pre style={{ margin: 0, padding: 8, borderRadius: 8, background: T.bg, font: `12px ${T.mono}`, whiteSpace: 'pre-wrap', overflowX: 'auto', ...style }}>{o.value}</pre>
    case 'diff': return (
      <pre style={{ margin: 0, padding: 8, borderRadius: 8, background: T.bg, font: `12px ${T.mono}`, whiteSpace: 'pre-wrap', overflowX: 'auto', ...style }}>
        {o.value.split('\n').map((l, i) => <div key={i} style={{ color: l.startsWith('+') ? T.ok : l.startsWith('-') ? T.danger : T.muted }}>{l || ' '}</div>)}
      </pre>)
    default: return <span style={{ color: T.muted, ...style }}>{o.value}</span>
  }
}

/** Responsive SVG: the viewBox tracks the container width, so 1 unit = 1 CSS px. Layout reflows instead of shrinking, which keeps text and touch targets a constant size on phones. */
export function SvgBox({ h, svgRef, children, max, style, minW = 0 }: { h: number | ((w: number) => number); svgRef?: RefObject<SVGSVGElement | null>; max?: number; minW?: number; style?: CSSProperties; children: (w: number) => ReactNode }) {
  const [box, width] = useSize<HTMLDivElement>(640)
  const own = useRef<SVGSVGElement>(null)
  const ref = (svgRef ?? own) as RefObject<SVGSVGElement>
  const W = Math.max(Math.round(max ? Math.min(width, max) : width), minW, 120)
  const H = typeof h === 'function' ? h(W) : h
  return (
    <div ref={box} style={{ width: '100%', ...style }}>
      <svg ref={ref} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" style={{ display: 'block', margin: max ? '0 auto' : undefined, userSelect: 'none', WebkitUserSelect: 'none', maxWidth: '100%' }}>{children(W)}</svg>
    </div>
  )
}
export const Row = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', ...style }}>{children}</div>
export const Muted = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <div style={{ color: T.muted, fontSize: 13, ...style }}>{children}</div>
export const Big = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 22, fontWeight: 650, lineHeight: 1.2 }}>{children}</div>
export const cn = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(' ')
