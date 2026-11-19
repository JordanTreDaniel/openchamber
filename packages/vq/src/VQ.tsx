import { useMemo } from 'react'
import { Frame, type Def } from './Frame'
import type { ThemeProviderProps } from './theme'
import { Spec, type Answer } from './types'
import { assign } from './components/Assign'
import { canvas } from './components/Canvas'
import { duel } from './components/Duel'
import { field } from './components/Field'
import { graph } from './components/Graph'
import { map } from './components/Map'
import { pick } from './components/Pick'
import { plane } from './components/Plane'
import { random } from './components/Random'
import { rank } from './components/Rank'
import { recorder } from './components/Recorder'
import { scale } from './components/Scale'
import { split } from './components/Split'
import { table } from './components/Table'
import { timeline } from './components/Timeline'
import { tree } from './components/Tree'
import { when } from './components/When'

/** The registry: one definition per component type. Add a type here and it is available everywhere. */
export const registry = { pick, duel, random, scale, split, plane, rank, assign, table, graph, tree, map, canvas, when, timeline, field, recorder } as unknown as Record<Spec['type'], Def<any, any>>

export interface VQProps extends Pick<ThemeProviderProps, 'theme' | 'scheme'> {
  /** A question spec as plain JSON (validated at runtime). */
  spec: unknown
  onAnswer: (answer: Answer) => void
  defaultValue?: unknown
  className?: string
  /** Rendered when the spec is invalid. Defaults to a short message listing the problems. */
  onInvalid?: (issues: string[]) => void
}
/** Data in, data out: <VQ spec={json} onAnswer={(a) => send(a)} /> */
export function VQ({ spec, onAnswer, defaultValue, theme, scheme, className, onInvalid }: VQProps) {
  const parsed = useMemo(() => Spec.safeParse(spec), [spec])
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'spec'}: ${i.message}`)
    onInvalid?.(issues)
    return <div role="alert" style={{ padding: 12, border: '1px solid #d6473d', borderRadius: 10, font: '13px system-ui' }}>Invalid question spec<ul>{issues.slice(0, 5).map((m, i) => <li key={i}>{m}</li>)}</ul></div>
  }
  const s = parsed.data
  return <Frame key={s.id} spec={s} def={registry[s.type]} defaultValue={defaultValue as never} onAnswer={onAnswer as never} theme={theme} scheme={scheme} className={className} />
}
