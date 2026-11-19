import type { Mark, Pt } from '../types'
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

// ---------- ranking: binary insertion (assisted rank) and single elimination (bracket) ----------
export interface Ins { sorted: string[]; queue: string[]; lo: number; hi: number }
export const insStart = (ids: string[]): Ins => ({ sorted: ids.slice(0, 1), queue: ids.slice(1), lo: 0, hi: ids.length ? 1 : 0 })
export const insProbe = (s: Ins) => (s.queue.length ? { item: s.queue[0], against: s.sorted[Math.floor((s.lo + s.hi) / 2)] } : null)
/** sorted is best-first. itemWins: the queued item beat the probed one. */
export function insAnswer(s: Ins, itemWins: boolean): Ins {
  const mid = Math.floor((s.lo + s.hi) / 2)
  let { lo, hi } = s
  if (itemWins) hi = mid; else lo = mid + 1
  if (lo < hi) return { ...s, lo, hi }
  const sorted = s.sorted.slice(); sorted.splice(lo, 0, s.queue[0])
  return { sorted, queue: s.queue.slice(1), lo: 0, hi: sorted.length }
}
/** Worst case comparisons for n items with binary insertion. */
export const insMaxSteps = (n: number) => { let t = 0; for (let k = 1; k < n; k++) t += Math.ceil(Math.log2(k + 1)); return t }

export interface Bracket { pending: string[]; winners: string[]; round: number; champion?: string }
export function brStart(ids: string[]): Bracket { return brNorm({ pending: ids.slice(), winners: [], round: 1 }) }
function brNorm(b: Bracket): Bracket {
  let { pending, winners, round } = b
  for (;;) {
    if (pending.length === 1) { winners = [...winners, pending[0]]; pending = [] }
    if (pending.length === 0) {
      if (winners.length === 1) return { pending, winners, round, champion: winners[0] }
      pending = winners; winners = []; round++; continue
    }
    return { pending, winners, round }
  }
}
export const brMatch = (b: Bracket) => (b.pending.length >= 2 ? ([b.pending[0], b.pending[1]] as [string, string]) : null)
export const brPick = (b: Bracket, winner: string) => brNorm({ ...b, pending: b.pending.slice(2), winners: [...b.winners, winner] })

// ---------- split ----------
/** Round to a step so the parts sum exactly to total (largest remainder). */
export function roundToSum(vals: number[], total: number, step = 1): number[] {
  const s = vals.reduce((a, b) => a + b, 0) || 1
  const raw = vals.map((v) => (v / s) * (total / step))
  const fl = raw.map(Math.floor)
  let rem = Math.round(total / step) - fl.reduce((a, b) => a + b, 0)
  raw.map((r, i) => [r - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rem > 0) { fl[i]++; rem-- } })
  return fl.map((n) => n * step)
}
export const equalSplit = (n: number, total: number, step = 1) => roundToSum(Array(n).fill(1), total, step)
/** Move the boundary between part i and i+1 to cumulative position c (value units). Only the two neighbours change. */
export function moveBoundary(vals: number[], i: number, c: number, step = 1, mins: number[] = [], maxs: number[] = []): number[] {
  const before = vals.slice(0, i).reduce((a, b) => a + b, 0)
  const pair = vals[i] + vals[i + 1]
  const lo = Math.max(mins[i] ?? 0, pair - (maxs[i + 1] ?? pair))
  const hi = Math.min(maxs[i] ?? pair, pair - (mins[i + 1] ?? 0))
  const a = clamp(Math.round((c - before) / step) * step, lo, Math.max(lo, hi))
  const out = vals.slice(); out[i] = a; out[i + 1] = pair - a
  return out
}
/** Set part i to v and spread the difference across the others in proportion to their size. */
export function setPart(vals: number[], i: number, v: number, total: number, step = 1): number[] {
  const nv = clamp(Math.round(v / step) * step, 0, total)
  const others = vals.filter((_, j) => j !== i); const so = others.reduce((a, b) => a + b, 0)
  const r = roundToSum(so > 0 ? others : others.map(() => 1), total - nv, step)
  let k = 0
  return vals.map((_, j) => (j === i ? nv : r[k++]))
}
/** Barycentric weights of point p in triangle (a,b,c), clamped into the triangle. */
export function barycentric(p: Pt, a: Pt, b: Pt, c: Pt): [number, number, number] {
  const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
  let w1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / d
  let w2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / d
  w1 = Math.max(0, w1); w2 = Math.max(0, w2); const w3 = Math.max(0, 1 - w1 - w2)
  const s = w1 + w2 + w3 || 1
  return [w1 / s, w2 / s, w3 / s]
}
export const outcomeValue = (o: { base: number; weights: Record<string, number> }, amounts: Record<string, number>) =>
  o.base + Object.entries(o.weights).reduce((s, [k, w]) => s + w * (amounts[k] ?? 0), 0)

// ---------- scale ----------
export function nearestKey<T>(table: Record<string, T> | undefined, v: number): T | undefined {
  if (!table) return undefined
  let best: string | undefined, bd = Infinity
  for (const k of Object.keys(table)) { const d = Math.abs(Number(k) - v); if (d < bd) { bd = d; best = k } }
  return best === undefined ? undefined : table[best]
}

// ---------- layout ----------
export interface TNode { id: string; parent: string | null }
export function childrenMap(nodes: TNode[], parents: Record<string, string | null> = {}) {
  const kids: Record<string, string[]> = {}; const roots: string[] = []
  nodes.forEach((n) => { const p = n.id in parents ? parents[n.id] : n.parent; if (p == null) roots.push(n.id); else (kids[p] ||= []).push(n.id) })
  return { kids, roots }
}
/** True when `maybe` is `id` itself or sits below it. */
export const isDescendant = (nodes: TNode[], parents: Record<string, string | null>, id: string, maybe: string): boolean => {
  const { kids } = childrenMap(nodes, parents); const st = [id]
  while (st.length) { const c = st.pop()!; if (c === maybe) return true; (kids[c] || []).forEach((k) => st.push(k)) }
  return false
}
/** Tidy tree: x = depth, y = leaf order with parents centred. Both normalized to 0..1. */
export function treeLayout(nodes: TNode[], parents: Record<string, string | null> = {}) {
  const { kids, roots } = childrenMap(nodes, parents); const pos: Record<string, Pt> = {}; let leaf = 0, maxD = 0
  const walk = (id: string, d: number): number => {
    maxD = Math.max(maxD, d); const ks = kids[id] || []
    const y = ks.length ? ks.map((k) => walk(k, d + 1)).reduce((a, b) => a + b, 0) / ks.length : leaf++
    pos[id] = { x: d, y }; return y
  }
  roots.forEach((r) => walk(r, 0))
  const nl = Math.max(leaf - 1, 1)
  Object.values(pos).forEach((p) => { p.x = maxD ? p.x / maxD : 0; p.y = leaf > 1 ? p.y / nl : 0.5 })
  return pos
}
/** Deterministic spring layout for graphs without coordinates. Output normalized to 0..1. */
export function forceLayout(ids: string[], edges: [string, string][], iters = 200): Record<string, Pt> {
  const n = ids.length, P = ids.map((_, i) => ({ x: 0.5 + 0.35 * Math.cos((2 * Math.PI * i) / n), y: 0.5 + 0.35 * Math.sin((2 * Math.PI * i) / n) }))
  const ix = Object.fromEntries(ids.map((id, i) => [id, i])); const k = 0.9 / Math.sqrt(Math.max(n, 1))
  for (let t = 0; t < iters; t++) {
    const f = P.map(() => ({ x: 0, y: 0 })), cool = 0.05 * (1 - t / iters)
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d = Math.hypot(dx, dy) || 0.01, r = (k * k) / d
      f[i].x += (dx / d) * r; f[i].y += (dy / d) * r; f[j].x -= (dx / d) * r; f[j].y -= (dy / d) * r
    }
    edges.forEach(([a, b]) => {
      const i = ix[a], j = ix[b]; if (i == null || j == null) return
      const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d = Math.hypot(dx, dy) || 0.01, r = (d * d) / k
      f[i].x -= (dx / d) * r; f[i].y -= (dy / d) * r; f[j].x += (dx / d) * r; f[j].y += (dy / d) * r
    })
    P.forEach((p, i) => { const m = Math.hypot(f[i].x, f[i].y) || 1; p.x += (f[i].x / m) * Math.min(m, cool); p.y += (f[i].y / m) * Math.min(m, cool) })
  }
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return Object.fromEntries(ids.map((id, i) => [id, { x: x1 > x0 ? (P[i].x - x0) / (x1 - x0) : 0.5, y: y1 > y0 ? (P[i].y - y0) / (y1 - y0) : 0.5 }]))
}

// ---------- geo ----------
export interface Bounds { minLat: number; maxLat: number; minLng: number; maxLng: number }
export const project = (lat: number, lng: number, b: Bounds, w: number, h: number): Pt => ({ x: ((lng - b.minLng) / (b.maxLng - b.minLng)) * w, y: ((b.maxLat - lat) / (b.maxLat - b.minLat)) * h })
export const unproject = (x: number, y: number, b: Bounds, w: number, h: number) => ({ lat: b.maxLat - (y / h) * (b.maxLat - b.minLat), lng: b.minLng + (x / w) * (b.maxLng - b.minLng) })
export const kmToPx = (km: number, b: Bounds, h: number) => (km / 111.32 / (b.maxLat - b.minLat)) * h
export const pxToKm = (px: number, b: Bounds, h: number) => (px / h) * (b.maxLat - b.minLat) * 111.32
/** Bounds that fit the points with padding, matching the viewport aspect ratio (w/h). */
export function boundsFor(pts: { lat: number; lng: number }[], aspect: number): Bounds {
  if (!pts.length) return { minLat: -50, maxLat: 70, minLng: -180, maxLng: 180 }
  const la = pts.map((p) => p.lat), ln = pts.map((p) => p.lng)
  let minLat = Math.min(...la), maxLat = Math.max(...la), minLng = Math.min(...ln), maxLng = Math.max(...ln)
  const pad = Math.max(maxLat - minLat, (maxLng - minLng) / aspect, 0.02) * 0.25
  minLat -= pad; maxLat += pad; minLng -= pad * aspect; maxLng += pad * aspect
  const h = maxLat - minLat, w = maxLng - minLng
  if (w / h < aspect) { const e = (h * aspect - w) / 2; minLng -= e; maxLng += e } else { const e = (w / aspect - h) / 2; minLat -= e; maxLat += e }
  return { minLat, maxLat, minLng, maxLng }
}

// ---------- time ----------
export const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0')
export function fmtT(t: number, unit: 's' | 'min' | 'day' = 's') {
  if (unit === 'day') return `day ${Math.round(t)}`
  if (unit === 'min') return `${Math.floor(t / 60)}:${pad2(t % 60)}`
  const m = Math.floor(t / 60), s = t - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}
export const toHHMM = (mins: number) => `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`
export const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
export const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

// ---------- Excalidraw export (best-effort scene JSON; open in Excalidraw to verify) ----------
export function toExcalidraw(marks: Mark[], w: number, h: number) {
  let n = 0
  const common = () => ({ angle: 0, strokeColor: '#e03131', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1000 + ++n, version: 1, versionNonce: 2000 + n, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false })
  const els: any[] = []
  marks.forEach((m) => {
    const id = `vq-${m.id}`
    if (m.kind === 'point') els.push({ ...common(), id, type: 'ellipse', x: m.x * w - 10, y: m.y * h - 10, width: 20, height: 20 })
    else if (m.kind === 'box') els.push({ ...common(), id, type: 'rectangle', x: m.x * w, y: m.y * h, width: m.w * w, height: m.h * h })
    else if (m.kind === 'arrow') els.push({ ...common(), id, type: 'arrow', x: m.x * w, y: m.y * h, width: (m.x2 - m.x) * w, height: (m.y2 - m.y) * h, points: [[0, 0], [(m.x2 - m.x) * w, (m.y2 - m.y) * h]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow' })
    else if (m.kind === 'ink') { const [x0, y0] = m.points[0] ?? [0, 0]; els.push({ ...common(), id, type: 'freedraw', x: x0 * w, y: y0 * h, width: 1, height: 1, points: m.points.map(([x, y]) => [(x - x0) * w, (y - y0) * h]), pressures: [], simulatePressure: true, lastCommittedPoint: null }) }
  })
  return { type: 'excalidraw', version: 2, source: 'vq-react', elements: els, appState: { viewBackgroundColor: '#ffffff' }, files: {} }
}
