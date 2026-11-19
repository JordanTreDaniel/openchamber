import { createContext, useContext, useEffect, useRef, useState, type RefObject, type PointerEvent as RPE, type MouseEvent as RME } from 'react'

export interface VQCtx { commentMode: boolean; selected: string | null; select: (id: string) => void; compact: boolean; width: number }
export const VQContext = createContext<VQCtx>({ commentMode: false, selected: null, select: () => {}, compact: false, width: 640 })
export const useVQ = () => useContext(VQContext)

/** Spread onto any element to make it addressable for feedback: <rect {...target('bin:3')} /> */
export function useTarget() {
  const { commentMode, selected, select } = useVQ()
  return (id: string) => ({
    'data-vq': id,
    ...(selected === id ? { 'data-vq-sel': '' } : {}),
    onClickCapture: (e: RME) => { if (!commentMode) return; e.stopPropagation(); e.preventDefault(); select(id) },
  })
}

export function useSize<T extends Element>(initial = 640): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el); setW(Math.round(el.getBoundingClientRect().width) || initial)
    return () => ro.disconnect()
  }, [])
  return [ref as RefObject<T>, w]
}

export interface DragPt { x: number; y: number; cx: number; cy: number; dx: number; dy: number }
export interface DragHandlers { onStart?: (p: DragPt) => void; onMove: (p: DragPt) => void; onEnd?: (p: DragPt) => void }
/** Pointer-based drag (mouse, touch, pen). With svgRef, x/y are in SVG user units; otherwise client px. */
export function useDrag(svgRef?: RefObject<SVGSVGElement | null>) {
  const { commentMode } = useVQ()
  const st = useRef<{ id: number; x0: number; y0: number } | null>(null)
  return (h: DragHandlers) => {
    const pos = (e: RPE): DragPt => {
      let x = e.clientX, y = e.clientY
      const svg = svgRef?.current, m = svg?.getScreenCTM()
      if (m) { const q = new DOMPoint(x, y).matrixTransform(m.inverse()); x = q.x; y = q.y }
      return { x, y, cx: e.clientX, cy: e.clientY, dx: e.clientX - (st.current?.x0 ?? e.clientX), dy: e.clientY - (st.current?.y0 ?? e.clientY) }
    }
    const end = (e: RPE) => { if (st.current?.id !== e.pointerId) return; const p = pos(e); st.current = null; h.onEnd?.(p) }
    return {
      onPointerDown: (e: RPE) => {
        if (commentMode || e.button > 0) return
        e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId)
        st.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY }; h.onStart?.(pos(e))
      },
      onPointerMove: (e: RPE) => { if (st.current?.id === e.pointerId) h.onMove(pos(e)) },
      onPointerUp: end, onPointerCancel: end,
      style: { touchAction: 'none' as const, cursor: 'grab' },
    }
  }
}
