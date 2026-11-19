/** Every visual value comes from a CSS variable so hosts can retheme without touching components. */
export interface Theme {
  bg: string; surface: string; surface2: string; text: string; muted: string; border: string
  accent: string; accentFg: string; ok: string; warn: string; danger: string; info: string; violet: string
  radius: string; font: string; mono: string; shadow: string
}
export const dark: Theme = {
  bg: '#0b0b0c', surface: '#151517', surface2: '#1d1d20', text: '#ececea', muted: '#8c8c86', border: '#2a2a2d',
  accent: '#6b9bff', accentFg: '#0b0b0c', ok: '#3ecf8e', warn: '#f0b429', danger: '#ff6b5f', info: '#4cc9f0', violet: '#a98bff',
  radius: '12px', font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  shadow: '0 1px 2px rgba(0,0,0,.4)',
}
export const light: Theme = {
  bg: '#fafaf8', surface: '#ffffff', surface2: '#f1f1ed', text: '#1c1c1a', muted: '#74746c', border: '#e2e2dc',
  accent: '#2f6fed', accentFg: '#ffffff', ok: '#1f9d63', warn: '#d98e04', danger: '#d6473d', info: '#0e8fb8', violet: '#8a5cf5',
  radius: '12px', font: dark.font, mono: dark.mono, shadow: '0 1px 2px rgba(0,0,0,.06)',
}
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
/** Reference tokens used in styles: T.accent === 'var(--vq-accent)'. */
export const T = Object.fromEntries(Object.keys(dark).map((k) => [k, `var(--vq-${kebab(k)})`])) as unknown as Theme
export const themeVars = (t: Partial<Theme>): Record<string, string> =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [`--vq-${kebab(k)}`, v as string]))
/** Map host CSS variables onto tokens, e.g. hostTheme({ bg: '--background', text: '--foreground' }). */
export const hostTheme = (map: Partial<Record<keyof Theme, string>>): Partial<Theme> =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [k, `var(${v})`])) as Partial<Theme>
export const series = (i: number) => [T.accent, T.ok, T.violet, T.warn, T.danger, T.info][i % 6]
