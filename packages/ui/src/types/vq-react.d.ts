// Types for the out-of-tree vq-react component library.
//
// The library ships raw TypeScript from a directory beside this checkout and is
// consumed at build time through the Vite alias in packages/web/vite.config.ts,
// so `tsc -b` can see it — but packages/ui/tsconfig.build.json is a composite
// project with `rootDir: ".."`, which rejects any source file outside
// `packages/` (TS6059/TS6307, ~64 errors for three imported symbols).
//
// Declaring the surface here keeps the project reference build whole and keeps
// the panel type-checked against a contract, instead of silencing the import.
// The runtime shape is defined by the library itself:
// VQ.tsx, tokens.ts and types.ts in the library's own src/ directory.
declare module 'vq-react' {
  import type * as React from 'react';
  /** Every visual value is a CSS variable reference so hosts can retheme. */
  export interface Theme {
    bg: string;
    surface: string;
    surface2: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentFg: string;
    ok: string;
    warn: string;
    danger: string;
    info: string;
    violet: string;
    radius: string;
    font: string;
    mono: string;
    shadow: string;
  }

  /** Map host CSS variables onto tokens: hostTheme({ accent: '--primary' }). */
  export function hostTheme(map: Partial<Record<keyof Theme, string>>): Partial<Theme>;

  /** The structured value a question resolves to. */
  export interface Answer {
    v: number;
    id: string;
    type: string;
    value: unknown;
    label: string;
    confidence: number | null;
    skipped: boolean;
    comments: unknown[];
    text: string | null;
  }

  export interface VQProps {
    /** A question spec as plain JSON; validated against the schema at runtime. */
    spec: unknown;
    onAnswer: (answer: Answer) => void;
    defaultValue?: unknown;
    className?: string;
    /** Rendered when the spec is invalid. Defaults to a short message. */
    onInvalid?: (issues: string[]) => void;
    theme?: Partial<Theme>;
    scheme?: 'dark' | 'light' | 'auto';
  }

  export const VQ: (props: VQProps) => React.JSX.Element;
}
