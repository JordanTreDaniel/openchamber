# Vendored `vq-react`

This directory is a **hand-synced vendor copy** — not a fork, not a published
dependency, not a submodule. `src/` is a copy of an upstream checkout's `src/`,
and nothing here is generated. A re-sync is a plain file copy, so the copy can
drift from upstream only when someone runs the script.

## Upstream

| Field | Value |
|---|---|
| Package name | `vq-react` |
| Version | `0.1.0` |
| Description | "Visual-first question components for AI agents. Data in, structured data out." |
| Repository URL | **none published.** The upstream checkout has no `.git` directory, no `repository` field, and no repository link in its README — so there is no remote to name and no commit SHA to record. |
| `author` / `license` fields | **absent** from the upstream `package.json` |
| `LICENSE` / `LICENSE.md` | **absent** from the upstream checkout |
| Size copied | 32 files, 2,613 lines of TypeScript |

The license is therefore **unknown**, and no `LICENSE` was added here because
inventing one would be a false grant. With no license, the default is all rights
reserved: this copy must not be published or distributed outside this
repository until the upstream author's terms are obtained and a real `LICENSE`
lands in this directory. Treat that as an open blocker, not a formality.

The copy was verified against the checkout it came from with a recursive
`diff`: identical, except the checkout's `.DS_Store`, which the sync script
skips.

## Why it is vendored

An out-of-tree path in `packages/web/vite.config.ts` broke
`git clone` → `bun install` → `bun run build:web` on every machine except the
one that made the branch. A `file:` dependency does not solve it either: the
checkout's directory name contains a space, and a `file:` specifier pointing at
it fails with `package.json not found`. Vendoring the sources and resolving them
through a Vite alias is the only shape that survives a clean clone.

## How it is wired

- `packages/web/vite.config.ts` — alias `vq-react` → `packages/vq/src/index.ts`,
  and `packages/vq/src` on `server.fs.allow`.
- `packages/ui/src/types/vq-react.d.ts` — a 97-line ambient
  `declare module 'vq-react'`, the only type contract the app checks against.
- `packages/vq/package.json` — `private`, `main: ./src/index.ts`, no build step.
  The host consumes raw TypeScript.

## Deliberate choices — do not undo these

- **The package is named `@openchamber/vq-react`, not `vq-react`.** A workspace
  package literally named `vq-react` makes bun create a `node_modules/vq-react`
  symlink, and TypeScript prefers a real module on disk over the ambient
  `declare module 'vq-react'`. That drags the whole library into the UI
  project's type-check under a different config, which is exactly what the
  ambient declaration exists to prevent.
- **`resolve.dedupe: ['react', 'react-dom']` is load-bearing.** These sources
  import `react` and `react/jsx-runtime` 22 times; dedupe pins every one of
  those imports to the host app's single copy. Without it the bundle gets a
  second React and fails with "Invalid hook call". `react` / `react-dom` are
  deliberately **not** declared in this `package.json` for the same reason.
- **`zod` stays on v3, nested.** The library was written against zod 3
  (`src/types.ts` is its only zod import). The rest of the monorepo is on zod 4.
  Declaring `^3.23.8` here makes bun install zod 3 into
  `packages/vq/node_modules/zod` instead of floating the import up to the root
  zod 4. Bumping this range ships a library that will not parse its own specs.
- **`sideEffects: false` is kept from upstream.** Every import in the library is
  side-effect free.

## Known limitation: bundled, but never type-checked

`packages/vq` appears in **no** tsconfig. `packages/web/tsconfig.json` includes
`src` plus `../ui/src/**/*.d.ts`; `packages/ui/tsconfig.build.json` includes
`src` and `../sdk/src`. Neither includes `packages/vq/src`.

So the 2,613 lines are transpiled into the web bundle but no `tsc` run ever
checks them — only the 97-line ambient declaration is checked, and that
declaration is a hand-written contract, not the library's own types. A type
error in the vendored sources surfaces at runtime, in the browser, not at build
time.

Closing the gap means adding a project that includes `packages/vq/src` with zod
3 and React types resolved the way the bundle resolves them. Until then, treat
"the build passes" as no evidence about this directory.

## Re-syncing from upstream

```bash
VQ_SRC="/path/to/vq-react" bun run --cwd packages/vq sync
```

- `VQ_SRC` is the checkout root — the directory that holds `src/`. Quote it; a
  space in the path is fine.
- The script copies `*.ts` and `*.tsx` recursively, skips `.DS_Store`, and
  prints how many files it copied.
- It validates the source before copying anything, changes nothing, and exits
  non-zero when `VQ_SRC` is unset or unreadable.
- It overwrites `src/` in place. Review `git diff packages/vq/src` and run
  `bun run build:web` before committing — a sync is a code change to this
  repository and its blast radius is the web bundle.

Verify a sync with a recursive diff:

```bash
diff -r "$VQ_SRC/src" packages/vq/src   # only .DS_Store may differ
```

## Do not

- Do not write a machine-local path into this file, `scripts/sync.mjs`, or any
  build config. Pass the checkout in through `VQ_SRC` at run time; a home
  directory in a committed file is what broke the build for everyone else.
- Do not rename this package back to `vq-react`, drop `resolve.dedupe`, or move
  the zod range to v4.
- Do not add `react` / `react-dom` as dependencies here.
