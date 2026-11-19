# Vendored `vq-react`

This directory is a **hand-synced vendor copy, not a fork**. Upstream is the
`vq-react` library at **v0.1.0** ("Visual-first question components for AI
agents. Data in, structured data out."). The copy was taken from a local
checkout on the machine that produced the branch. That checkout's path is
deliberately **not** recorded in this repository: it does not exist on any other
machine, and an absolute home path in a build config is what broke the build
everywhere else in the first place.

The source is vendored rather than linked because an out-of-tree path in
`packages/web/vite.config.ts` made `git clone` + `bun install` + `bun run
build:web` fail everywhere except that one machine. A `file:` dependency does
not solve it either: the checkout's directory name contains a space, and a
`file:` specifier pointing at it fails with `error: package.json not found`.

## What is here

- `src/` — verbatim copy of upstream `src/` (32 files, ~2600 lines of raw
  TypeScript). No build step, no build output: the host consumes the sources
  directly through the Vite alias in `packages/web/vite.config.ts`.
- `package.json` — declares only `zod@^3`.
- `scripts/sync.mjs` — the re-sync script.

## Deliberate choices

- **The package is named `@openchamber/vq-react`, not `vq-react`.** A workspace
  package called `vq-react` would make bun create a `node_modules/vq-react`
  symlink, and TypeScript prefers a real module on disk over the ambient
  `declare module 'vq-react'` in `packages/ui/src/types/vq-react.d.ts`. That
  would drag the whole library into the UI project's type-check under a
  different tsconfig, which is exactly what the ambient declaration exists to
  prevent (`packages/ui/tsconfig.build.json` is composite with `rootDir: ".."`
  and rejects sources outside `packages/`). Keeping the different name keeps
  the ambient declaration authoritative, exactly as before vendoring.
- **`react` / `react-dom` are deliberately NOT declared here.** They must
  resolve to the host app's single copies. `resolve.dedupe: ['react',
  'react-dom']` in `packages/web/vite.config.ts` is load-bearing: it pins every
  `react` import from these sources (including `react/jsx-runtime`) to the host
  copy, so there is never a second React ("Invalid hook call").
- **`zod` is pinned to `^3.23.8`** because the library was written against zod
  3 (`src/types.ts`). The rest of the monorepo runs zod 4, so declaring the
  range here makes bun nest a zod 3 for this package instead of letting the
  import float up to the root zod 4.
- **`sideEffects: false` is kept from upstream.** The library's imports are
  side-effect free.
- **`src/types.ts` is the only file with a non-React dependency.** Total
  external imports across the whole library: `react` (22×) and `zod` (1×).
  Nothing else needs to be vendored.

## Re-syncing from upstream

```bash
VQ_SRC="/path/to/vq-react" bun run --cwd packages/vq sync
```

`VQ_SRC` must point at the checkout's root (the directory containing `src/`).
Quote it, and it may contain spaces. The script copies `*.ts` and `*.tsx`
recursively, skips `.DS_Store`, and prints how many files it copied. It refuses
to run — with a clear message, changing nothing — when `VQ_SRC` is unset.
Review `git diff packages/vq/src` before committing: a sync is a code change to
this repository, and its blast radius is the web bundle.
