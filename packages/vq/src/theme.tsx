import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { dark, light, themeVars, type Theme } from './tokens'

const css = (t: Theme) => Object.entries(themeVars(t)).map(([k, v]) => `${k}:${v}`).join(';')
export const BASE_CSS = `
.vq-root{font:15px/1.45 var(--vq-font);color:var(--vq-text);box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.vq-root *,.vq-root *::before,.vq-root *::after{box-sizing:border-box}
.vq-root svg text{fill:var(--vq-muted);font:11px var(--vq-font);user-select:none}
.vq-btn{font:inherit;color:var(--vq-text);background:var(--vq-surface2);border:1px solid var(--vq-border);border-radius:10px;padding:9px 14px;min-height:40px;cursor:pointer;transition:background .12s,transform .06s}
.vq-btn:hover{background:var(--vq-border)}.vq-btn:active{transform:scale(.97)}
.vq-btn[data-tone=primary]{background:var(--vq-accent);color:var(--vq-accentFg,#fff);border-color:transparent;font-weight:600}
.vq-btn[data-tone=ok]{background:var(--vq-ok);color:#06140d;border-color:transparent;font-weight:600}
.vq-btn[data-tone=danger]{background:var(--vq-danger);color:#1b0604;border-color:transparent;font-weight:600}
.vq-btn[data-tone=ghost]{background:transparent;border-color:transparent;color:var(--vq-muted)}
.vq-btn[disabled]{opacity:.45;cursor:not-allowed}
.vq-chip{font:inherit;color:var(--vq-text);background:var(--vq-surface2);border:1px solid var(--vq-border);border-radius:999px;padding:7px 14px;min-height:38px;cursor:pointer}
.vq-chip[aria-pressed=true],.vq-opt[aria-pressed=true]{background:color-mix(in srgb,var(--vq-accent) 18%,transparent);border-color:var(--vq-accent)}
.vq-opt{font:inherit;color:var(--vq-text);text-align:left;background:var(--vq-surface);border:1px solid var(--vq-border);border-radius:var(--vq-radius);padding:12px 14px;cursor:pointer;min-height:48px}
.vq-opt:hover{border-color:var(--vq-muted)}
.vq-input{font:inherit;color:var(--vq-text);background:var(--vq-bg);border:1px solid var(--vq-border);border-radius:10px;padding:10px 12px;min-height:42px;width:100%}
.vq-btn:focus-visible,.vq-chip:focus-visible,.vq-opt:focus-visible,.vq-input:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--vq-accent);outline-offset:2px}
.vq-cm [data-vq]{cursor:crosshair!important}.vq-cm [data-vq]:hover{outline:2px dashed var(--vq-warn);outline-offset:1px}
[data-vq-sel]{outline:2px solid var(--vq-warn);outline-offset:1px}
.vq-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
@media(prefers-reduced-motion:reduce){.vq-root *{transition:none!important;animation:none!important}}
`
const ThemeCtx = createContext(false)
export const useInTheme = () => useContext(ThemeCtx)

export interface ThemeProviderProps { theme?: Partial<Theme>; scheme?: 'dark' | 'light' | 'auto'; className?: string; style?: CSSProperties; children?: ReactNode }
/** Sets the token CSS variables. Override any subset, or map host variables with hostTheme(). */
export function ThemeProvider({ theme, scheme = 'dark', className, style, children }: ThemeProviderProps) {
  const base = scheme === 'light' ? light : dark
  const auto = scheme === 'auto'
  const vars = { ...themeVars({ ...(auto ? light : base), ...theme }) } as CSSProperties
  return (
    <ThemeCtx.Provider value={true}>
      <div className={'vq-root ' + (className ?? '')} data-vq-auto={auto ? '' : undefined} style={{ ...vars, ...style }}>
        <style dangerouslySetInnerHTML={{ __html: BASE_CSS + (auto ? `@media(prefers-color-scheme:dark){.vq-root[data-vq-auto]{${css({ ...dark, ...theme } as Theme)}}}` : '') }} />
        {children}
      </div>
    </ThemeCtx.Provider>
  )
}
