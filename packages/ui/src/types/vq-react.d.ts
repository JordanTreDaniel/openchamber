// Types for the vq-react component library.
//
// The library ships raw TypeScript, vendored into this workspace at
// packages/vq/src (see packages/vq/SYNC.md) and consumed at build time through
// the Vite alias in packages/web/vite.config.ts. It is declared here rather
// than imported directly because packages/ui/tsconfig.build.json is a composite
// project with `rootDir: ".."`, which rejects any source file outside
// `packages/` (TS6059/TS6307, ~64 errors for three imported symbols) — and
// because the vendored package is named @openchamber/vq-react, so the `vq-react`
// specifier stays resolvable from this ambient declaration.
//
// Declaring the surface here keeps the project reference build whole and keeps
// the panel type-checked against a contract, instead of silencing the import.
// The runtime shape is defined by the library itself:
// VQ.tsx, tokens.ts, types.ts and output.ts in packages/vq/src.
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

  /** One artifact of an answer: text (JSON, markdown) or a Blob (audio). */
  export interface OutputFile {
    name: string;
    data: string | Blob;
    mime: string;
  }

  /** What a writer is given: the per-answer folder is already part of `path`. */
  export interface Destination {
    kind: string;
    path?: string;
    remote?: string;
    prefix?: string;
  }

  /** Where a write ended: the folder, and one reason per file that failed. */
  export interface WriteResult {
    ok: boolean;
    location: string;
    errors?: string[];
  }

  /** A destination implementation, keyed by the `kind` a spec names. */
  export interface Writer {
    write(files: OutputFile[], dest: Destination): Promise<WriteResult>;
  }

  export function registerWriter(kind: string, writer: Writer): void;
}
