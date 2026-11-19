/**
 * Where the files of a `vq` answer go: the fence's `output` names a folder, and
 * this writer puts one file per artifact in it through the app's own file
 * route, so an answer outlives the tab it was given in.
 *
 * The library's own folder writer asks the browser for a directory
 * (`showDirectoryPicker`), which a server has nothing to answer with, and its
 * host sink reports one thrown message for the whole answer. A writer of our
 * own keeps one failure per file instead, so a recording that cannot be
 * written still leaves the answer's JSON on the disk — the library's
 * `attachOutput` returns the answer either way, and this never throws.
 */

import { normalizePath } from '@/lib/pathNormalization';
import { opencodeClient } from '@/lib/opencode/client';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import type { Destination, OutputFile, WriteResult, Writer } from 'vq-react';

/** The destination kind this writer answers: the library's folder spec. */
export const VQ_OUTPUT_KIND = 'dir';

/** What the library module offers us; typed here so no value is imported from it. */
interface VqOutputModule {
  registerWriter: (kind: string, writer: Writer) => void;
}

const JSON_TYPE = 'application/json';
const BYTES_TYPE = 'application/octet-stream';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isAbsolutePath = (value: string): boolean => /^(?:[a-zA-Z]:[\\/]|[/\\])/.test(value);

/**
 * The folder the answer's files go in. An absolute spec path is taken as it is;
 * a relative one is joined onto the workspace, so a spec's `"vq-out"` lands in
 * the open project rather than in whatever folder the server started in. With
 * no workspace known the path is left alone and the route answers with the
 * reason it cannot be written.
 */
export function resolveVqOutputPath(destination: string, workspace: string | null | undefined): string {
  const target = normalizePath(destination) ?? destination.trim();
  if (!target) return '';
  const root = workspace ? normalizePath(workspace) : null;
  if (!root || isAbsolutePath(target)) return target;
  return `${root}/${target.replace(/^(?:\.\/)+/, '').replace(/^[/\\]+/, '')}`;
}

/** The folder the app has open: what a relative output path resolves against. */
const workspaceDirectory = (): string | null => {
  try {
    const current = useDirectoryStore.getState().currentDirectory;
    if (typeof current === 'string' && current.trim()) return current.trim();
    // Chat drafts run with no project open; the client still knows the folder.
    const client = opencodeClient.getDirectory();
    return typeof client === 'string' && client.trim() ? client.trim() : null;
  } catch {
    return null;
  }
};

/**
 * The headers one write carries. The directory travels as the usual
 * `x-opencode-directory` header — a plain object, not a `Headers` instance, so
 * `runtimeFetch` can encode a path outside Latin-1 and mark it for the server.
 */
const requestHeaders = (contentType: string, workspace: string | null): Record<string, string> => ({
  'Content-Type': contentType,
  ...(workspace ? { 'x-opencode-directory': workspace } : {}),
});

/** The route's own reason for a refusal, or the status when the body carries none. */
const refusalReason = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  const reason = body && typeof body.error === 'string' ? body.error.trim() : '';
  return reason || `HTTP ${response.status}`;
};

/**
 * The reason a 2xx is not a write, or the null answer when it is one.
 *
 * `response.ok` alone is not proof: a proxy, an auth page or the SPA fallback
 * answers 200 with HTML, and the old check recorded that as a clean write that
 * never happened. Every route this writer uses ends on the same receipt —
 * `res.json({ success: true, path })` at routes.js:1563 and :1578 (fs/write),
 * :865 (fs/mkdir) and :1690 (fs/upload) — so success is that field, and
 * nothing in front of the route can invent it.
 */
const unexpectedResponse = async (response: Response): Promise<string | null> => {
  const parsed = await response.json().then(
    (body: unknown) => ({ json: true, body }),
    () => ({ json: false, body: null }),
  );
  if (!parsed.json) return `unexpected response (HTTP ${response.status}, non-JSON body)`;
  const body = parsed.body;
  const confirmed = typeof body === 'object' && body !== null && (body as { success?: unknown }).success === true;
  return confirmed ? null : `unexpected response (HTTP ${response.status}, success not confirmed)`;
};

/** One text file; the null answer means it is on the disk. */
async function writeTextFile(path: string, content: string, workspace: string | null): Promise<string | null> {
  try {
    const response = await runtimeFetch('/api/fs/write', {
      method: 'POST',
      headers: requestHeaders(JSON_TYPE, workspace),
      body: JSON.stringify({ path, content }),
    });
    if (!response.ok) return await refusalReason(response);
    return await unexpectedResponse(response);
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * The folder a byte file goes in. The upload route will not create it — it
 * resolves the parent and answers 404 when it is missing — so it is made once
 * per answer, by the route that does create parents recursively.
 */
async function ensureFolder(path: string, workspace: string | null): Promise<string | null> {
  try {
    const response = await runtimeFetch('/api/fs/mkdir', {
      method: 'POST',
      headers: requestHeaders(JSON_TYPE, workspace),
      body: JSON.stringify({ path }),
    });
    if (!response.ok) return await refusalReason(response);
    return await unexpectedResponse(response);
  } catch (error) {
    return messageOf(error);
  }
}

/** One binary file; `overwrite` because an answer written twice is the same answer. */
async function writeBytesFile(path: string, data: Blob, workspace: string | null): Promise<string | null> {
  try {
    const response = await runtimeFetch('/api/fs/upload', {
      method: 'POST',
      query: { path, overwrite: 'true' },
      headers: requestHeaders(BYTES_TYPE, workspace),
      body: data,
    });
    if (!response.ok) return await refusalReason(response);
    return await unexpectedResponse(response);
  } catch (error) {
    return messageOf(error);
  }
}

const isBlob = (data: OutputFile['data'] | undefined): data is Blob => typeof Blob !== 'undefined' && data instanceof Blob;

/** The answer's own file: the one that says where the answer went. */
const ANSWER_FILE = 'answer.json';

const nameOf = (file: OutputFile | undefined): string => (typeof file?.name === 'string' ? file.name.trim() : '');

/**
 * Whether a name is one path segment, as the folder contract means it.
 *
 * The name comes from the fence's spec, so it is untrusted: a separator would
 * let a file land in a folder beside the answer's, and a `..` segment would let
 * it leave that folder entirely. The workspace check on the server stops the
 * real damage, but the answer's own folder would no longer hold the answer. A
 * bad name is refused, never rewritten — a silently renamed file is a file the
 * reader cannot find.
 */
const isLeafName = (name: string): boolean => (
  name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name) && !name.split(/[/\\]/).includes('..')
);

/** What the answer's file carries about its own write: the library's `OutputRef` shape. */
interface OutputReceipt {
  ok: boolean;
  location: string;
  errors?: string[];
}

/**
 * The answer's folder and what landed in it, grafted onto the answer's envelope.
 *
 * The library builds `answer.json` in `toQuestionFiles` and only then calls the
 * writer, so the envelope it hands us has no `output` — without this the folder
 * cannot say where it went, and a reader has to guess the path it was read from.
 * Returns the reason instead of throwing when the body is not a JSON object, so
 * the caller can still write the answer as the library built it.
 */
function withReceipt(
  content: string,
  location: string,
  ok: boolean,
  errors: string[],
): { text: string } | { reason: string } {
  try {
    const envelope = JSON.parse(content) as unknown;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return { reason: 'the answer is not a JSON object' };
    }
    const receipt: OutputReceipt = { ok, location, ...(errors.length > 0 ? { errors: [...errors] } : {}) };
    (envelope as Record<string, unknown>).output = receipt;
    return { text: `${JSON.stringify(envelope, null, 2)}\n` };
  } catch (error) {
    return { reason: messageOf(error) };
  }
}

/**
 * Writes one answer's files into its folder, one at a time: a failed file is
 * recorded and the rest still go.
 *
 * `answer.json` goes last and carries the receipt, because it is the only file
 * that can report its own folder and the failures beside it — writing it first
 * would freeze it as the pre-write envelope the library handed over.
 *
 * `workspace` is spelled out for the tests; a real call reads the open folder.
 */
export async function writeVqFiles(
  files: OutputFile[],
  dest: Destination,
  workspace: string | null = workspaceDirectory(),
): Promise<WriteResult> {
  const location = typeof dest?.path === 'string' ? dest.path.trim() : '';
  if (!location) return { ok: false, location: '', errors: ['No destination path in the output spec.'] };

  const errors: string[] = [];
  try {
    const folder = resolveVqOutputPath(location, workspace);
    const list = Array.isArray(files) ? files : [];
    // The answer is set aside by position, not by filtering, so a duplicate
    // name is still written rather than dropped.
    const answerIndex = list.findIndex((file) => nameOf(file) === ANSWER_FILE);
    // A byte file needs its folder to exist first; the text route is what
    // creates it, but the library's order does not promise a text file first.
    let folderFailure: string | null = null;
    if (list.some((file) => isBlob(file?.data))) folderFailure = await ensureFolder(folder, workspace);

    const writeOne = async (file: OutputFile): Promise<void> => {
      const name = nameOf(file);
      if (!name) {
        errors.push('(unnamed file): the answer named no file name.');
        return;
      }
      if (!isLeafName(name)) {
        errors.push(`${name}: invalid file name`);
        return;
      }
      const path = `${folder}/${name}`;
      const data = file.data;
      const failure = isBlob(data)
        ? folderFailure ?? await writeBytesFile(path, data, workspace)
        : typeof data === 'string'
          ? await writeTextFile(path, data, workspace)
          : `the file carries ${typeof data}, which this writer cannot write.`;
      if (failure) errors.push(`${name}: ${failure}`);
    };

    for (let i = 0; i < list.length; i += 1) {
      if (i !== answerIndex) await writeOne(list[i]);
    }

    // Last, with the receipt: every other file has now reported, so the answer
    // knows the folder and each failure beside it.
    if (answerIndex < 0) {
      errors.push(`${ANSWER_FILE}: could not attach output receipt (the answer named no ${ANSWER_FILE})`);
    } else {
      const answer = list[answerIndex];
      let prepared: string | Blob = answer.data;
      let receiptFailure: string | null = null;
      if (typeof answer.data !== 'string') {
        receiptFailure = `the answer carries ${typeof answer.data}, not text`;
      } else {
        // The receipt goes on the envelope root, not on `answers[0]`: the
        // library already writes `output` onto the answer object it hands to
        // `onAnswer`, but it serialises `answer.json` before that write, so the
        // file — not the payload — is what has to carry the receipt.
        const receipt = withReceipt(answer.data, location, errors.length === 0, errors);
        if ('text' in receipt) prepared = receipt.text;
        else receiptFailure = receipt.reason;
      }
      // A receipt we could not attach costs a note, never the answer's file.
      if (receiptFailure) errors.push(`${ANSWER_FILE}: could not attach output receipt (${receiptFailure})`);
      await writeOne({ ...answer, data: prepared });
    }
  } catch (error) {
    return { ok: false, location, errors: [messageOf(error)] };
  }

  return errors.length > 0 ? { ok: false, location, errors } : { ok: true, location };
}

const writer: Writer = { write: (files, dest) => writeVqFiles(files, dest) };

let installed = false;

/**
 * Registers the writer under the folder kind, so a spec's `output` reaches the
 * disk instead of the browser's folder picker. Idempotent: the app installs it
 * at boot and the fence's own loader installs it again, and both must end with
 * one writer.
 */
export function installVqWriter(mod: VqOutputModule): void {
  if (installed) return;
  mod.registerWriter(VQ_OUTPUT_KIND, writer);
  installed = true;
}

/**
 * Installs the writer at boot without making the library part of the startup
 * bundle: most replies draw no fence. A failure here is swallowed on purpose —
 * the fence's loader runs the same install when a fence does arrive.
 */
export function installVqWriterLoader(): void {
  void import('vq-react')
    .then((mod) => installVqWriter(mod))
    .catch(() => {});
}
