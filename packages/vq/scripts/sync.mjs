#!/usr/bin/env node
// Re-sync the vendored vq-react sources from a local checkout of the upstream
// library. See ../SYNC.md.
//
// Usage:
//   VQ_SRC="/path/to/vq-react" bun run --cwd packages/vq sync
//   bun packages/vq/scripts/sync.mjs "/path/to/vq-react"
//
// The source directory is never hardcoded: a machine-local path must not enter
// the repository. Refuse to run when it is missing.

import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEST_SRC = path.resolve(HERE, '..', 'src');

const SOURCE_HINT = 'VQ_SRC="/path/to/vq-react" bun run --cwd packages/vq sync';

const raw = (process.argv[2] ?? process.env.VQ_SRC ?? '').trim();

if (!raw) {
  console.error(
    [
      'sync: VQ_SRC is not set.',
      '',
      'Point it at the upstream vq-react checkout (the directory that holds src/).',
      'Example:',
      `  ${SOURCE_HINT}`,
      '',
      'Nothing was changed.',
    ].join('\n'),
  );
  process.exit(1);
}

const sourceRoot = path.resolve(raw.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
const sourceSrc = path.join(sourceRoot, 'src');

try {
  const info = await stat(sourceSrc);
  if (!info.isDirectory()) {
    throw new Error('not a directory');
  }
} catch {
  console.error(`sync: ${sourceSrc} is not a readable directory. Nothing was changed.`);
  process.exit(1);
}

const SKIP = new Set(['.DS_Store']);
const KEEP = /\.(ts|tsx)$/;

async function collect(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    const rel = path.posix.join(prefix, entry.name);
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(abs, rel)));
    } else if (entry.isFile() && KEEP.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

const files = (await collect(sourceSrc)).sort();

let copied = 0;
for (const rel of files) {
  const target = path.join(DEST_SRC, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(sourceSrc, rel), target);
  copied += 1;
}

console.log(`sync: copied ${copied} file${copied === 1 ? '' : 's'} from ${sourceSrc}`);
console.log('sync: now review `git diff packages/vq/src` and commit the result.');
