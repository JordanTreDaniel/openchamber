import { clock, hasContent, toText, wordCount, type RecSession } from './core/recorder'
import type { Answer, Spec, SpecOf } from './types'

/**
 * Output destinations.
 *
 * A question's artifacts (answer, transcript, recording) can be written to a folder or handed to a remote
 * sink. Functions cannot travel in JSON, so the spec names a `kind` and the host registers the writer that
 * implements it — exactly how speech engines work. Nothing in this file knows about any program's folder:
 * the host decides the path or the remote name.
 *
 * Layout, one folder per answer, is the bulk-transcribe shape (original + transcript + log):
 *
 *   <out>/<id>/answer.json  session.json  recording.webm  transcript-en.md  notes.md  meta.json
 */

/** One artifact. `data` is text (JSON, markdown) or a Blob (audio). */
export interface OutputFile { name: string; data: string | Blob; mime: string }

/**
 * What a writer needs to know. `dir` uses `path`; `r2` uses `remote` + `prefix`. Any other kind gets the
 * same record and may read whatever it wants — that is why this is open rather than a closed union.
 * The per-answer folder is already part of `path` / `prefix` (see destinationFor), never part of the names.
 */
export interface Destination { kind: string; path?: string; remote?: string; prefix?: string }

export interface WriteResult { ok: boolean; location: string; errors?: string[] }

/** A destination implementation. A finished write reports where the files landed, or why they did not. */
export interface Writer { write(files: OutputFile[], dest: Destination): Promise<WriteResult> }

/** A host that persists files itself: a server upload, an Electron/Node bridge, a test. */
export type FileSink = (files: OutputFile[], dest: Destination) => Promise<{ location: string } | string | void> | { location: string } | string | void

// ---------- registry ----------
const writers = new Map<string, Writer>()

/** Register a destination implementation under the kind a spec names. Later calls replace earlier ones. */
export const registerWriter = (kind: string, w: Writer) => { writers.set(kind, w) }

/**
 * Resolve a writer. `dir` falls back to the built-in writer instead of being registered at import time,
 * because a module-level side effect would be dropped by bundlers that honour `sideEffects: false`.
 */
export function getWriter(kind: string): Writer | undefined {
  return writers.get(kind) ?? (kind === 'dir' ? defaultDir : undefined)
}

/** Drop every registered writer. Tests only. */
export const clearWriters = () => { writers.clear() }

// ---------- built-in: a folder ----------
export interface DirWriterOpts {
  /** Defaults to window.showDirectoryPicker. Pass null to force the sink (a host that stores files itself). */
  picker?: (() => Promise<any>) | null
  /** Called when the browser cannot write a folder itself, and when the picker is disabled. */
  onFiles?: FileSink
}

const segments = (p: string) => p.split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..' && !/^[a-zA-Z]:$/.test(s))

/**
 * A folder writer that is honest about what a browser can do.
 *
 * - File System Access API (Chromium): the user picks a root folder once, the writer descends into the path
 *   and writes real files. An absolute path cannot be honoured — the picked folder is the root — so the
 *   returned location is relative to it.
 * - No such API (Firefox, Safari, jsdom, a server): the files go to `onFiles`, which the host implements.
 * - Neither: `ok:false` with a reason. It never pretends the write happened.
 */
export function dirWriter(opts: DirWriterOpts = {}): Writer {
  return { write: async (files, dest) => {
    const where = dest.path ?? ''
    const pick = opts.picker === undefined
      ? (typeof window !== 'undefined' ? (window as any).showDirectoryPicker : undefined)
      : opts.picker
    if (typeof pick === 'function') {
      try {
        const root = await pick()
        let dir = root
        for (const seg of segments(where)) dir = await dir.getDirectoryHandle(seg, { create: true })
        const errors: string[] = []
        for (const f of files) {
          try {
            const h = await dir.getFileHandle(f.name, { create: true })
            const w = await h.createWritable(); await w.write(f.data as never); await w.close()
          } catch (e) { errors.push(`${f.name}: ${(e as Error).message}`) }
        }
        const location = [root?.name, ...segments(where)].filter(Boolean).join('/')
        return errors.length ? { ok: false, location, errors } : { ok: true, location }
      } catch (e) {
        return { ok: false, location: where, errors: [`Folder not selected: ${(e as Error).message}`] }
      }
    }
    if (!opts.onFiles) return { ok: false, location: where, errors: [`This browser cannot write to "${where}". Register a writer for kind "dir" with an onFiles sink, or use a server.`] }
    try {
      const r = await opts.onFiles(files, dest)
      return { ok: true, location: typeof r === 'string' ? r : r?.location ?? where }
    } catch (e) { return { ok: false, location: where, errors: [(e as Error).message] } }
  } }
}

const defaultDir = dirWriter()

// ---------- capture audio without touching the envelope ----------
/** A Blob is not JSON, so the recording is stashed here by session id and drained when files are written. */
const audio = new Map<string, Blob>()
const AUDIO_CAP = 16

export function putAudio(sessionId: string, blob: Blob) {
  if (audio.size >= AUDIO_CAP && !audio.has(sessionId)) audio.delete(audio.keys().next().value as string)
  audio.set(sessionId, blob)
}
/** Read without consuming: a failed write must not lose the take. */
export function audioFor(ids: string[]) {
  const out: Record<string, Blob> = {}
  for (const id of ids) { const b = audio.get(id); if (b) out[id] = b }
  return out
}
export const dropAudio = (ids: string[]) => { for (const id of ids) audio.delete(id) }

// ---------- destination ----------
const join = (a: string, b: string) => (a ? a.replace(/[\\/]+$/, '') + '/' + b : b)

/** Turn the spec's output block into a destination whose folder is already the per-answer one. */
export function destinationFor(output: NonNullable<Spec['output']>, id: string): Destination {
  if (output.kind === 'r2') return { kind: 'r2', remote: output.remote ?? 'r2', prefix: join(output.prefix ?? '', id) }
  // dir, and anything else that looks path-shaped: the folder carries the answer id so two answers never collide.
  return { kind: output.kind, path: join(output.path ?? '', id) }
}

const DEFAULT_TIMEOUT_MS = 20000

/** Resolve the writer and run it. Never throws, never hangs: a bad destination must not cost the answer. */
export async function writeOutput(files: OutputFile[], dest: Destination, opts: { timeoutMs?: number } = {}): Promise<WriteResult> {
  const where = dest.kind === 'r2' ? `${dest.remote ?? 'r2'}:${dest.prefix ?? ''}` : (dest.path ?? '')
  const w = getWriter(dest.kind)
  if (!w) return { ok: false, location: where, errors: [`No output writer registered for kind "${dest.kind}". Register one with registerWriter(kind, writer).`] }
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const result = await Promise.race([
      w.write(files, dest),
      new Promise<WriteResult>((r) => setTimeout(() => r({ ok: false, location: where, errors: [`Writer "${dest.kind}" did not finish within ${ms} ms.`] }), ms)),
    ])
    return result && typeof result === 'object' ? result : { ok: false, location: where, errors: ['The writer returned no result.'] }
  } catch (e) { return { ok: false, location: where, errors: [(e as Error).message] } }
}

// ---------- files ----------
/** Keep in step with package.json. Written into every folder so a reader knows which build made it. */
export const VQ_VERSION = '0.1.0'

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
const stamp = () => new Date().toISOString()

export interface SessionMeta {
  /** The envelope handed to the agent, verbatim, so the folder explains itself. */
  answer?: Answer
  /** Captured recordings by session id (see putAudio). */
  audio?: Record<string, Blob>
  startedAt?: string
  endedAt?: string
  /** Where the question came from: the agent message, the page, whatever locates it later. */
  source?: Record<string, unknown>
  version?: string
}

type RecSpec = SpecOf<'recorder'>
const langTag = (s: RecSpec) => { const l = s.engine.language; return !l || l === 'auto' ? 'en' : l.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'en' }
const extFor = (mime: string) => (mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm')

const answerFile = (spec: Spec, sessions: RecSession[], a?: Answer): OutputFile => ({
  name: 'answer.json', mime: 'application/json',
  data: json({ id: spec.id, type: spec.type, answers: a ? [a] : [], sessions }),
})
const sessionFile = (spec: Spec, meta: SessionMeta): OutputFile => ({
  name: 'session.json', mime: 'application/json',
  data: json({ vq: meta.version ?? VQ_VERSION, id: spec.id, type: spec.type, spec, source: meta.source ?? { kind: 'question', id: spec.id, type: spec.type }, startedAt: meta.startedAt ?? null, endedAt: meta.endedAt ?? stamp() }),
})

/** Notes and element comments, keyed by the target id the UI uses (`option:a`, `seg:s1`, ...). */
function notesFile(spec: Spec, answer: Answer | undefined, sessions: RecSession[]): OutputFile {
  const out: string[] = [`# ${spec.title ?? spec.id}`, '']
  if (answer?.text) out.push(answer.text, '')
  if (answer?.comments.length) { out.push('## Comments', ''); for (const c of answer.comments) out.push(`- \`${c.target}\` — ${c.text}`); out.push('') }
  for (const s of sessions.filter((x) => x.notes.length)) {
    out.push(`## ${s.label ?? s.id}`, '')
    for (const n of s.notes) out.push(`- [${clock(n.t)}]${n.tag ? ` #${n.tag.replace(/\s+/g, '-').toLowerCase()}` : ''} ${n.text}`)
    out.push('')
  }
  if (answer?.label) out.push(`Answer: ${answer.label}`, '')
  return { name: 'notes.md', mime: 'text/markdown', data: out.join('\n').trimEnd() + '\n' }
}

function metaFile(answer: Answer | undefined, sessions: RecSession[], spec: Spec, meta: SessionMeta): OutputFile {
  const d = sessions.filter(hasContent), r = (spec.type === 'recorder' ? spec : undefined) as RecSpec | undefined
  return {
    name: 'meta.json', mime: 'application/json',
    data: json({
      vq: meta.version ?? VQ_VERSION,
      question: { id: spec.id, type: spec.type, title: spec.title ?? null },
      engine: r ? { id: r.engine.id, model: r.engine.model ?? null, provider: r.engine.provider ?? null, language: r.engine.language } : null,
      preset: r?.processing.preset ?? null,
      source: r?.processing.source ?? null,
      startedAt: meta.startedAt ?? null,
      endedAt: meta.endedAt ?? stamp(),
      counts: {
        sessions: sessions.length, recorded: d.length,
        segments: d.reduce((a, x) => a + x.segments.length, 0),
        words: d.reduce((a, x) => a + wordCount(x), 0),
        notes: d.reduce((a, x) => a + x.notes.length, 0),
        comments: answer?.comments.length ?? 0,
      },
    }),
  }
}

/**
 * Pure, DOM-free, filesystem-free: the whole recorder folder as data. Testable with plain objects.
 * One recording with content uses the plain names; several get a `-<session id>` suffix so nothing collides.
 */
export function toSessionFiles(sessions: RecSession[], spec: RecSpec, meta: SessionMeta = {}): OutputFile[] {
  const live = sessions.filter(hasContent), many = live.length > 1
  const suffix = (id: string) => (many ? `-${id}` : '')
  const out: OutputFile[] = [answerFile(spec, sessions, meta.answer)]
  out.push(sessionFile(spec, meta))
  const wantAudio = spec.output?.audio !== false, wantMd = spec.output?.markdown !== false
  if (wantAudio) for (const s of live) {
    const b = meta.audio?.[s.id]
    if (!b || !b.size) continue
    const mime = b.type || 'audio/webm'
    out.push({ name: `recording${suffix(s.id)}.${extFor(mime)}`, mime, data: b })
  }
  if (wantMd) {
    const lang = langTag(spec)
    for (const s of live) {
      const body = [s.label ? `# ${s.label}` : null, s.outcome ? `Outcome: ${s.outcome}` : null, '', toText(s)].filter((x) => x !== null).join('\n')
      out.push({ name: `transcript-${lang}${suffix(s.id)}.md`, mime: 'text/markdown', data: body.trimEnd() + '\n' })
    }
    out.push(notesFile(spec, meta.answer, sessions))
  }
  out.push(metaFile(meta.answer, sessions, spec, meta))
  return out
}

/** Every other component: the answer, the spec, the notes. No transcript, no recording. */
export function toQuestionFiles(answer: Answer, spec: Spec, meta: SessionMeta = {}): OutputFile[] {
  const out: OutputFile[] = [answerFile(spec, [], answer), sessionFile(spec, meta)]
  if (spec.output?.markdown !== false) out.push(notesFile(spec, answer, []))
  out.push(metaFile(answer, [], spec, meta))
  return out
}

/**
 * Build the files and write them, then echo the destination onto the envelope. Never throws: a missing
 * writer, a full disk or a dead remote must still return the answer. A Blob is drained only after success.
 */
export async function attachOutput<S extends Spec>(spec: S, a: Answer<S['type']>, opts: { timeoutMs?: number } = {}): Promise<Answer<S['type']>> {
  const o = spec.output
  if (!o) return a
  try {
    const sessions = spec.type === 'recorder' ? (a.value as { sessions?: RecSession[] }).sessions ?? [] : []
    const ids = sessions.map((s) => s.id)
    const meta: SessionMeta = {
      answer: a as Answer, audio: audioFor(ids), endedAt: stamp(),
      startedAt: sessions.find((s) => s.startedAt)?.startedAt,
      source: { kind: 'question', id: spec.id, type: spec.type, url: typeof location !== 'undefined' ? location.href : undefined },
    }
    const files = spec.type === 'recorder'
      ? toSessionFiles(sessions, spec as unknown as RecSpec, meta)
      : toQuestionFiles(a as Answer, spec as Spec, meta)
    const res = await writeOutput(files, destinationFor(o, spec.id), opts)
    if (res.ok) dropAudio(ids)
    return { ...a, output: res }
  } catch (e) {
    return { ...a, output: { ok: false, location: '', errors: [(e as Error).message] } }
  }
}
