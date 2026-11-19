/** Recorder session model, reducers and exporters. Pure data in, pure data out. */
export type Speaker = 'me' | 'them' | 'unknown'
export interface RecSegment { id: string; start: number; end: number; text: string; speaker: Speaker; edited?: boolean; flag?: boolean }
export interface RecNote { id: string; t: number; text: string; tag?: string }
export interface RecSession { id: string; label?: string; startedAt?: string; durationSec: number; segments: RecSegment[]; notes: RecNote[]; outcome?: string; checks: string[]; audioBytes?: number }

export const newSession = (id: string, label?: string): RecSession => ({ id, label, durationSec: 0, segments: [], notes: [], checks: [] })
export const clock = (sec: number) => { const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s % 60).padStart(2, '0') }
const nextId = (p: string, xs: { id: string }[]) => p + (xs.reduce((a, x) => Math.max(a, Number(x.id.slice(p.length)) || 0), 0) + 1)
export const addSegment = (s: RecSession, seg: Omit<RecSegment, 'id'>): RecSession => ({ ...s, segments: [...s.segments, { ...seg, id: nextId('s', s.segments) }].sort((a, b) => a.start - b.start) })
export const patchSegment = (s: RecSession, id: string, p: Partial<RecSegment>): RecSession => ({ ...s, segments: s.segments.map((x) => (x.id === id ? { ...x, ...p } : x)) })
export const removeSegment = (s: RecSession, id: string): RecSession => ({ ...s, segments: s.segments.filter((x) => x.id !== id) })
export const addNote = (s: RecSession, n: Omit<RecNote, 'id'>): RecSession => ({ ...s, notes: [...s.notes, { ...n, id: nextId('n', s.notes) }].sort((a, b) => a.t - b.t) })
export const removeNote = (s: RecSession, id: string): RecSession => ({ ...s, notes: s.notes.filter((x) => x.id !== id) })
export const toggleCheck = (s: RecSession, key: string): RecSession => ({ ...s, checks: s.checks.includes(key) ? s.checks.filter((k) => k !== key) : [...s.checks, key] })
export const hasContent = (s: RecSession) => s.segments.length > 0 || s.notes.length > 0 || !!s.outcome
export const wordCount = (s: RecSession) => s.segments.reduce((a, x) => a + (x.text.trim() ? x.text.trim().split(/\s+/).length : 0), 0)
const who = (sp: Speaker) => (sp === 'me' ? 'Me' : sp === 'them' ? 'Them' : 'Speaker')

/** Plain transcript, one line per segment. Good for pasting into a chat with an agent. */
export const toText = (s: RecSession) => s.segments.map((x) => `[${clock(x.start)}] ${who(x.speaker)}: ${x.text}`).join('\n')

export function toMarkdown(sessions: RecSession[], title = 'Recording'): string {
  const out: string[] = []
  for (const s of sessions.filter(hasContent)) {
    out.push(`# ${s.label ?? title}${s.outcome ? ` — ${s.outcome}` : ''}`)
    out.push(`*${[s.startedAt, s.durationSec ? clock(s.durationSec) : '', `${wordCount(s)} words`].filter(Boolean).join(' · ')}*`, '')
    if (s.segments.length) { out.push('## Transcript', ''); for (const x of s.segments) out.push(`**[${clock(x.start)}] ${who(x.speaker)}:** ${x.flag ? '⚑ ' : ''}${x.text}`, '') }
    if (s.notes.length) { out.push('## Notes', ''); for (const n of s.notes) out.push(`- [${clock(n.t)}]${n.tag ? ` #${n.tag.replace(/\s+/g, '-').toLowerCase()}` : ''} ${n.text}`); out.push('') }
    if (s.checks.length) { out.push('## Covered', ''); for (const c of s.checks) out.push(`- [x] ${c.split('::').pop()}`); out.push('') }
  }
  return out.join('\n').trim() + '\n'
}
const ts = (t: number, sep: string) => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}` }
/** SubRip subtitles. */
export const toSRT = (s: RecSession) => s.segments.map((x, i) => `${i + 1}\n${ts(x.start, ',')} --> ${ts(Math.max(x.end, x.start + 0.5), ',')}\n${who(x.speaker)}: ${x.text}\n`).join('\n')
export const toVTT = (s: RecSession) => 'WEBVTT\n\n' + s.segments.map((x) => `${ts(x.start, '.')} --> ${ts(Math.max(x.end, x.start + 0.5), '.')}\n${who(x.speaker)}: ${x.text}\n`).join('\n')
