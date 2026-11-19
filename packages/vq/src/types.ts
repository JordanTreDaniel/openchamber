import { z } from 'zod'

/** Content blocks: anything an option can show. Plain strings are text. */
export const Content = z.union([
  z.string(),
  z.object({ kind: z.enum(['text', 'code', 'image', 'svg', 'swatch', 'audio', 'diff']), value: z.string(), alt: z.string().optional() }),
])
export type Content = z.infer<typeof Content>

export const Option = z.object({
  id: z.string(),
  label: z.string(),
  detail: Content.optional(),
  /** Image: URL (png/jpg/webp/gif/svg), data URI, or inline <svg> markup. Missing images get a generated SVG glyph. */
  image: z.string().optional(),
  color: z.string().optional(),
  recommended: z.boolean().optional(),
  x: z.number().optional(), // initial placement (plane), 0..1
  y: z.number().optional(),
})
export type Option = z.infer<typeof Option>

/**
 * Where a question's artifacts should land. `kind` is an open string: the writer that implements it is
 * registered by the host (functions cannot travel in JSON — same rule as engines). `dir` ships here.
 * Nothing here is program-specific: the host decides the path or the remote.
 */
export const OutputSpec = z.object({
  kind: z.string().default('dir'),
  /** kind:'dir' — output root. Each answer lands in its own `<path>/<id>/` folder. */
  path: z.string().optional(),
  /** kind:'r2' — an rclone remote name (eg 'r2'). A name, never a key: the copy is the host's job. */
  remote: z.string().optional(),
  /** kind:'r2' — key prefix under the remote. Each answer lands under `<prefix>/<id>/`. */
  prefix: z.string().optional(),
  /** Include the recording when audio was captured. This replaces the old saveAudio flag. */
  audio: z.boolean().default(true),
  /** Include the transcript and notes as markdown. */
  markdown: z.boolean().default(true),
})
export type OutputSpec = z.infer<typeof OutputSpec>

const base = {
  v: z.literal(1).default(1),
  id: z.string(),
  title: z.string().optional(),
  prompt: z.string().optional(),
  /** Agent-supplied "why am I asking / what do options do" text. */
  explain: z.string().optional(),
  allowText: z.boolean().default(true),
  allowSkip: z.boolean().default(true),
  allowConfidence: z.boolean().default(false),
  allowComments: z.boolean().default(true),
  /** auto: show images where any exist (glyph for the rest). always: glyph everywhere. never: hide. */
  images: z.enum(['auto', 'always', 'never']).default('auto'),
  /** Destination for the artifacts (files, transcript, recording). Absent: nothing is written; only the answer comes back. */
  output: OutputSpec.optional(),
}
const num = z.number()
const Rec = z.record(z.string(), z.union([z.string(), z.number()]))

export const PickSpec = z.object({ ...base, type: z.literal('pick'),
  options: z.array(Option).min(1), skin: z.enum(['cards', 'list', 'chips']).default('cards'),
  multiple: z.boolean().default(false), min: num.optional(), max: num.optional(),
  mode: z.enum(['include', 'exclude']).default('include'),
  friction: z.enum(['none', 'hold', 'type']).default('none'), confirmText: z.string().optional() })

export const DuelSpec = z.object({ ...base, type: z.literal('duel'),
  options: z.array(Option).min(2), mode: z.enum(['pair', 'bracket', 'assisted', 'slider']).default('pair') })

export const RandomSpec = z.object({ ...base, type: z.literal('random'),
  options: z.array(Option).min(2), skin: z.enum(['wheel', 'reel']).default('wheel') })

export const ScaleSpec = z.object({ ...base, type: z.literal('scale'),
  skin: z.enum(['slider', 'chips', 'stars', 'radar']).default('slider'),
  min: num.default(0), max: num.default(10), step: num.default(1), handles: z.union([z.literal(1), z.literal(2)]).default(1),
  default: z.union([num, z.array(num)]).optional(), unit: z.string().optional(),
  lowLabel: z.string().optional(), highLabel: z.string().optional(), recommended: num.optional(),
  /** Histogram behind the track: bins[i] is the count at value min + i*step. */
  backdrop: z.object({ bins: z.array(num) }).optional(),
  /** Lookup: scale value -> metrics shown live. Snaps to the nearest listed key. */
  consequence: z.record(z.string(), Rec).optional(),
  axes: z.array(z.object({ id: z.string(), label: z.string(), min: num.optional(), max: num.optional() })).optional() })

export const SplitSpec = z.object({ ...base, type: z.literal('split'),
  skin: z.enum(['bar', 'pie', 'ternary']).default('bar'),
  parts: z.array(z.object({ id: z.string(), label: z.string(), image: z.string().optional(), color: z.string().optional(), min: num.optional(), max: num.optional() })).min(2),
  total: num.default(100), step: num.default(1), unit: z.string().default('%'),
  /** Linear outcome model: value = base + sum(weights[part] * amount). Declarative, no code. */
  outcomes: z.array(z.object({ id: z.string(), label: z.string(), base: num.default(0), weights: z.record(z.string(), num), unit: z.string().optional() })).optional() })

export const PlaneSpec = z.object({ ...base, type: z.literal('plane'),
  items: z.array(Option).min(1), mode: z.enum(['axes', 'free']).default('axes'),
  xAxis: z.object({ label: z.string(), low: z.string().optional(), high: z.string().optional() }).default({ label: 'x' }),
  yAxis: z.object({ label: z.string(), low: z.string().optional(), high: z.string().optional() }).default({ label: 'y' }),
  /** [top-left, top-right, bottom-left, bottom-right] */
  quadrants: z.array(z.string()).length(4).optional() })

export const RankSpec = z.object({ ...base, type: z.literal('rank'),
  items: z.array(Option).min(2), lowLabel: z.string().optional(), highLabel: z.string().optional() })

export const AssignSpec = z.object({ ...base, type: z.literal('assign'),
  skin: z.enum(['lines', 'buckets', 'grid', 'deck']).default('buckets'),
  items: z.array(Option).min(1), targets: z.array(Option).min(1).optional(),
  /** lines: each target used once. buckets/deck: one target per item unless overlap. grid: many. */
  overlap: z.boolean().default(false), ordered: z.boolean().default(false),
  /** Third dimension for grid: one grid per facet. */
  facets: z.array(Option).optional() })

export const TableSpec = z.object({ ...base, type: z.literal('table'),
  columns: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(['text', 'number', 'money', 'badge', 'image']).default('text'), editable: z.boolean().default(false) })).min(1),
  rows: z.array(z.object({ id: z.string(), cells: Rec })).min(1),
  verdicts: z.array(Option).optional(), verdictLabel: z.string().default('Verdict') })

export const GraphSpec = z.object({ ...base, type: z.literal('graph'),
  nodes: z.array(z.object({ id: z.string(), label: z.string(), image: z.string().optional(), x: num.optional(), y: num.optional(), color: z.string().optional() })).min(1),
  edges: z.array(z.object({ id: z.string().optional(), from: z.string(), to: z.string(), label: z.string().optional(), directed: z.boolean().default(true) })),
  /** verdict: confirm/reject proposed edges. edit: also add/remove. select: pick nodes. */
  mode: z.enum(['verdict', 'edit', 'select']).default('verdict') })

export const TreeSpec = z.object({ ...base, type: z.literal('tree'),
  nodes: z.array(z.object({ id: z.string(), label: z.string(), parent: z.string().nullable(), image: z.string().optional(), detail: Content.optional(), color: z.string().optional() })).min(1),
  skin: z.enum(['outline', 'chart']).default('outline'), mode: z.enum(['select', 'edit']).default('select') })

export const MapSpec = z.object({ ...base, type: z.literal('map'),
  bounds: z.object({ minLat: num, maxLat: num, minLng: num, maxLng: num }).optional(),
  /** Optional basemap polygons as [lng, lat] rings. Without them a graticule is drawn. */
  shapes: z.array(z.array(z.tuple([num, num]))).optional(),
  places: z.array(z.object({ id: z.string(), label: z.string(), image: z.string().optional(), lat: num, lng: num, address: z.string().optional() })).default([]),
  mode: z.enum(['pick', 'drop', 'radius', 'route']).default('pick'), multiple: z.boolean().default(false), maxRadiusKm: num.default(50) })

export const CanvasSpec = z.object({ ...base, type: z.literal('canvas'),
  src: z.string().optional(), aspect: num.default(1.6),
  tools: z.array(z.enum(['point', 'box', 'arrow', 'ink'])).default(['point', 'box', 'arrow', 'ink']),
  /** Clickable regions (normalized 0..1) for "pick an element" questions. */
  targets: z.array(z.object({ id: z.string(), label: z.string(), x: num, y: num, w: num, h: num })).optional() })

export const WhenSpec = z.object({ ...base, type: z.literal('when'),
  mode: z.enum(['clock', 'calendar', 'availability', 'repeat']).default('clock'),
  clockSkin: z.enum(['digital', 'analog']).default('digital'), stepMinutes: num.default(5),
  days: z.array(z.string()).default(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
  fromHour: num.default(8), toHour: num.default(20), min: z.string().optional(), max: z.string().optional() })

export const TimelineSpec = z.object({ ...base, type: z.literal('timeline'),
  duration: num.positive(), unit: z.enum(['s', 'min', 'day']).default('s'),
  mode: z.enum(['range', 'markers', 'regions', 'lanes']).default('range'),
  backdrop: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('wave'), peaks: z.array(num) }),
    z.object({ kind: z.literal('events'), events: z.array(z.object({ t: num, label: z.string() })) }),
    z.object({ kind: z.literal('frames'), count: num, labels: z.array(z.string()).optional() }),
  ]).optional(),
  src: z.string().optional(),
  labels: z.array(Option).optional(), lanes: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  items: z.array(z.object({ id: z.string(), lane: z.string(), start: num, end: num, label: z.string().optional() })).optional() })

export const FieldSpec = z.object({ ...base, type: z.literal('field'),
  kind: z.enum(['text', 'long', 'number', 'money', 'color', 'path', 'url']).default('text'),
  suggestions: z.array(z.string()).optional(), placeholder: z.string().optional(),
  currency: z.string().default('$'), unit: z.string().optional(), min: num.optional(), max: num.optional(), default: z.union([z.string(), num]).optional() })

export const ContextBlock = z.object({ kind: z.enum(['markdown', 'json', 'table', 'kv', 'checklist', 'image', 'text', 'code']), title: z.string().optional(), value: z.unknown() })
export type ContextBlock = z.infer<typeof ContextBlock>

export const RecorderSpec = z.object({ ...base, type: z.literal('recorder'),
  /** Anything worth showing while talking: script, property facts, a JSON record, a checklist. */
  context: z.array(ContextBlock).optional(),
  /** A call list or batch: one recording session per item, each with its own context. Omit for a single recording. */
  items: z.array(z.object({ id: z.string(), label: z.string(), subtitle: z.string().optional(), image: z.string().optional(), phone: z.string().optional(), context: z.array(ContextBlock).optional() })).optional(),
  outcomes: z.array(Option).optional(),
  /** One-tap tagged notes, stamped with the recording time. */
  quickNotes: z.array(z.object({ id: z.string(), label: z.string(), color: z.string().optional() })).optional(),
  engine: z.object({
    /** Registered engine id: openchamber (Parakeet etc.), browser, openai-compatible, mock, or your own. */
    id: z.string().default('openchamber'), provider: z.enum(['local', 'openai-compatible']).optional(),
    /** e.g. parakeet-tdt-0.6b-v2-int8 (a model id from OpenChamber's dictation catalog). */
    model: z.string().optional(), language: z.string().default('auto'), correct: z.boolean().default(false),
    openaiCompatible: z.object({ baseUrl: z.string().optional(), model: z.string().optional(), apiKey: z.string().optional(), endpointPath: z.string().optional() }).optional(),
  }).default({}),
  processing: z.object({
    preset: z.enum(['speech', 'phone', 'room', 'raw']).default('speech'),
    /** mic: your voice. tab: audio of a shared browser tab (the other side of a web call). both: two labeled channels, Me and Them. */
    source: z.enum(['mic', 'tab', 'both']).default('mic'),
    echoCancellation: z.boolean().optional(), noiseSuppression: z.boolean().optional(), autoGainControl: z.boolean().optional(), deviceId: z.string().optional(),
    mode: z.enum(['toggle', 'hold']).default('toggle'),
    /** utterance: cut at pauses, one timed segment each. stream: one continuous stream, segment times are approximate. */
    segmenting: z.enum(['utterance', 'stream']).default('utterance'),
    vad: z.object({ threshold: z.number().optional(), silenceMs: z.number().default(700), minSpeechMs: z.number().default(250), maxSegmentSec: z.number().default(25) }).default({}),
  }).default({}),
  /** live: show text as it arrives. after: hide it until you stop. */
  transcript: z.enum(['live', 'after']).default('live'),
  /** @deprecated Kept so existing specs keep working. Use output.audio. Still calls env.onAudio when set. */
  saveAudio: z.boolean().default(false), autoAdvance: z.boolean().default(false),
  /** Shown above the record button, e.g. a recording-consent reminder. */
  disclosure: z.string().optional() })

export const Spec = z.discriminatedUnion('type', [PickSpec, DuelSpec, RandomSpec, ScaleSpec, SplitSpec, PlaneSpec, RankSpec, AssignSpec, TableSpec, GraphSpec, TreeSpec, MapSpec, CanvasSpec, WhenSpec, TimelineSpec, FieldSpec, RecorderSpec])

export type SpecInput = z.input<typeof Spec>
export type Spec = z.infer<typeof Spec>
export type SpecOf<T extends Spec['type']> = Extract<Spec, { type: T }>
export type SpecType = Spec['type']

// ---------- values (the structured data each component returns) ----------
export type Pt = { x: number; y: number }
export type Mark =
  | { id: string; kind: 'point'; x: number; y: number; note?: string }
  | { id: string; kind: 'box'; x: number; y: number; w: number; h: number; note?: string }
  | { id: string; kind: 'arrow'; x: number; y: number; x2: number; y2: number; note?: string }
  | { id: string; kind: 'ink'; points: number[][]; note?: string }
  | { id: string; kind: 'target'; target: string }
export type Values = {
  pick: string[]
  duel: { winner?: string; ranking?: string[] }
  random: { picked: string | null }
  scale: number[] | Record<string, number>
  split: Record<string, number>
  plane: Record<string, Pt>
  rank: string[]
  assign: Record<string, string[]>
  table: { verdicts: Record<string, string>; edits: Record<string, Record<string, string | number>> }
  graph: { verdicts: Record<string, 'yes' | 'no'>; added: { from: string; to: string }[]; selected: string[] }
  tree: { parents: Record<string, string | null>; selected: string | null }
  map: { points: { id?: string; lat: number; lng: number }[]; radiusKm?: number }
  canvas: { marks: Mark[] }
  when: { time?: string; date?: string; cells?: string[]; repeat?: { days: string[]; time: string } }
  timeline: { regions: { id: string; start: number; end: number; label?: string; lane?: string }[]; markers: { t: number; label?: string }[] }
  field: string | number
  recorder: { sessions: import('./core/recorder').RecSession[] }
}
export type ValueOf<T extends SpecType> = Values[T]

export interface Comment { target: string; text: string }
/** Where the artifacts ended up, echoed back on the envelope. `ok:false` never blocks the answer. */
export interface OutputRef { location: string; ok: boolean; errors?: string[] }
/** The one envelope every component answers with. */
export interface Answer<T extends SpecType = SpecType> {
  v: 1; id: string; type: T; value: Values[T]; label: string
  confidence: number | null; skipped: boolean; comments: Comment[]; text: string | null
  /** Present only when the spec asked for an output destination. */
  output?: OutputRef
}
/** Reply format for transports that only carry strings: human label first, JSON second. */
export const serializeAnswer = (a: Answer): [string, string] => [a.label, 'vq:' + JSON.stringify(a)]

/** Pull a spec out of a question prompt: a fenced block tagged vq. Returns null when absent or invalid. */
export function parseSpecFromPrompt(prompt: string): { spec: Spec; rest: string } | null {
  const m = prompt.match(/```vq\s*([\s\S]*?)```/)
  if (!m) return null
  try {
    const r = Spec.safeParse(JSON.parse(m[1]))
    return r.success ? { spec: r.data, rest: prompt.replace(m[0], '').trim() } : null
  } catch { return null }
}
