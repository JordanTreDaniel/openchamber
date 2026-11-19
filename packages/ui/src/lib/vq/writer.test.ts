import { afterEach, describe, expect, test } from 'bun:test';
import type { Destination, OutputFile } from 'vq-react';
import { resolveVqOutputPath, writeVqFiles } from './writer';

/**
 * The writer's side of an answer: one request per file through the app's file
 * route, one reason per file that failed, and never a throw.
 */

const originalFetch = globalThis.fetch;

interface Call {
  path: string;
  method: string;
  body: unknown;
  headers: Headers;
}

const FOLDER = '/repo/vq-out/a-call';
const WORKSPACE = '/repo';
const destination: Destination = { kind: 'dir', path: FOLDER };

/** A fetch that records the call and answers whatever `respond` decides for it. */
const stubFetch = (
  calls: Call[],
  respond: (path: string, body: unknown) => Response,
): typeof fetch => async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input), 'http://host.test');
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
  calls.push({
    path: url.pathname,
    method: String(init?.method ?? 'GET'),
    body,
    headers: new Headers(init?.headers),
  });
  return respond(url.pathname, body);
};

/** Every request succeeds: the shape one write of an answer has. */
const recordingFetch = (calls: Call[]): typeof fetch => stubFetch(calls, () => Response.json({ success: true }));

/** One answer as the library builds it: text files and, for a recorder, audio. */
const textFiles = (names: string[]): OutputFile[] => names.map((name) => ({
  name,
  data: name.endsWith('.json') ? jsonBody(name) : `${name} body`,
  mime: name.endsWith('.json') ? 'application/json' : 'text/markdown',
}));

/**
 * What `toQuestionFiles` hands the writer: the pre-write envelope, built before
 * the destination is known, so it has no `output` of its own.
 */
const jsonBody = (name: string): string => `${JSON.stringify({
  id: 'a-call',
  type: 'question',
  answers: [{ value: `${name} answer` }],
  sessions: [],
}, null, 2)}\n`;

/** The body one write carried, found by the path it went to. */
const bodyFor = (calls: Call[], name: string, folder: string = FOLDER): { content: string } => {
  const call = calls.find((entry) => (entry.body as { path?: string } | undefined)?.path === `${folder}/${name}`);
  if (!call) throw new Error(`${name} was never written`);
  return call.body as { content: string };
};

const answerEnvelope = (calls: Call[]): Record<string, unknown> => JSON.parse(bodyFor(calls, 'answer.json').content) as Record<string, unknown>;

const audioFile = (): OutputFile => ({
  name: 'recording.webm',
  data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
  mime: 'audio/webm',
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('vq output path', () => {
  test('an absolute folder is taken as it is', () => {
    expect(resolveVqOutputPath(FOLDER, WORKSPACE)).toBe(FOLDER);
    expect(resolveVqOutputPath(`${FOLDER}/`, WORKSPACE)).toBe(FOLDER);
  });

  test('a relative folder is joined onto the open workspace', () => {
    // A spec writes `"out": { "kind": "dir", "path": "vq-out" }`; the folder
    // must land in the project, not in whatever folder the server started in.
    expect(resolveVqOutputPath('vq-out', WORKSPACE)).toBe(`${WORKSPACE}/vq-out`);
    expect(resolveVqOutputPath('vq-out/', `${WORKSPACE}/`)).toBe(`${WORKSPACE}/vq-out`);
    expect(resolveVqOutputPath('./vq-out', WORKSPACE)).toBe(`${WORKSPACE}/vq-out`);
    expect(resolveVqOutputPath('/abs/out', WORKSPACE)).toBe('/abs/out');
    expect(resolveVqOutputPath('vq-out', null)).toBe('vq-out');
  });
});

describe('writeVqFiles', () => {
  test('writes every text file into the folder, one request each, the answer last', async () => {
    const calls: Call[] = [];
    globalThis.fetch = recordingFetch(calls);

    const result = await writeVqFiles(textFiles(['answer.json', 'session.json', 'notes.md', 'meta.json']), destination, WORKSPACE);

    expect(result).toEqual({ ok: true, location: FOLDER });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/fs/write', '/api/fs/write', '/api/fs/write', '/api/fs/write',
    ]);
    // The answer goes last: it is the file that reports the write.
    expect(calls.map((call) => (call.body as { path: string }).path)).toEqual([
      `${FOLDER}/session.json`,
      `${FOLDER}/notes.md`,
      `${FOLDER}/meta.json`,
      `${FOLDER}/answer.json`,
    ]);
    // Every other file is exactly what the library built.
    expect(bodyFor(calls, 'session.json').content).toBe(jsonBody('session.json'));
    expect(bodyFor(calls, 'notes.md').content).toBe('notes.md body');
    expect(bodyFor(calls, 'meta.json').content).toBe(jsonBody('meta.json'));
    // The answer carries a receipt for where it landed, and its own fields stay.
    const envelope = answerEnvelope(calls);
    expect(envelope.output).toEqual({ ok: true, location: FOLDER });
    expect(Object.keys(envelope)).toEqual(['id', 'type', 'answers', 'sessions', 'output']);
    expect(calls.every((call) => call.method === 'POST')).toBe(true);
    expect(calls[0].headers.get('x-opencode-directory')).toBe(WORKSPACE);
  });

  test('a relative folder writes into the workspace', async () => {
    const calls: Call[] = [];
    globalThis.fetch = recordingFetch(calls);

    const result = await writeVqFiles(textFiles(['answer.json']), { kind: 'dir', path: 'vq-out' }, WORKSPACE);

    expect(result.ok).toBe(true);
    expect((calls[0].body as { path: string }).path).toBe(`${WORKSPACE}/vq-out/answer.json`);
  });

  test('a refused file is reported with its name and the route reason, and the rest still go', async () => {
    const calls: Call[] = [];
    // The second file is refused the way an out-of-workspace path is.
    globalThis.fetch = stubFetch(calls, (_path, body) => (
      (body as { path: string }).path.endsWith('session.json')
        ? Response.json({ error: 'Path is outside of active workspace' }, { status: 400 })
        : Response.json({ success: true })
    ));

    const result = await writeVqFiles(textFiles(['answer.json', 'session.json', 'notes.md']), destination, WORKSPACE);

    expect(result.ok).toBe(false);
    expect(result.location).toBe(FOLDER);
    expect(result.errors).toEqual(['session.json: Path is outside of active workspace']);
    // Every file was attempted: a refusal costs its own file, not the answer.
    expect(calls.map((call) => (call.body as { path: string }).path)).toEqual([
      `${FOLDER}/session.json`,
      `${FOLDER}/notes.md`,
      `${FOLDER}/answer.json`,
    ]);
    // The answer's receipt says the write failed and names what failed.
    expect(answerEnvelope(calls).output).toEqual({
      ok: false,
      location: FOLDER,
      errors: ['session.json: Path is outside of active workspace'],
    });
  });

  test('an out-of-workspace refusal produces a message, not a throw', async () => {
    const calls: Call[] = [];
    globalThis.fetch = stubFetch(calls, () => Response.json({ error: 'Path is outside of active workspace' }, { status: 400 }));

    // `write` must never reject: the answer ships even when nothing landed.
    const result = await writeVqFiles(textFiles(['answer.json']), { kind: 'dir', path: '/outside/elsewhere' }, WORKSPACE);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['answer.json: Path is outside of active workspace']);
    expect(result.errors?.[0]).not.toContain('    at ');
  });

  test('a refusal body that is not JSON reports the status', async () => {
    const calls: Call[] = [];
    globalThis.fetch = stubFetch(calls, () => new Response('<html>who are you</html>', { status: 401 }));

    const result = await writeVqFiles(textFiles(['answer.json']), destination, WORKSPACE);

    expect(result.errors).toEqual(['answer.json: HTTP 401']);
  });

  test('a network failure is reported per file and the loop continues', async () => {
    let attempt = 0;
    globalThis.fetch = (async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Failed to fetch');
      return Response.json({ success: true });
    }) as unknown as typeof fetch;

    const result = await writeVqFiles(textFiles(['answer.json', 'meta.json']), destination, WORKSPACE);

    expect(result.ok).toBe(false);
    // The first write is meta.json, because the answer goes last.
    expect(result.errors).toEqual(['meta.json: Failed to fetch']);
    expect(attempt).toBe(2);
  });

  test('no destination path is its own refusal', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return Response.json({ success: true });
    }) as unknown as typeof fetch;

    const result = await writeVqFiles(textFiles(['answer.json']), { kind: 'dir' }, WORKSPACE);

    expect(result).toEqual({ ok: false, location: '', errors: ['No destination path in the output spec.'] });
    expect(requests).toBe(0);
  });

  test('a recording goes through the byte route, after its folder is made', async () => {
    // The upload route resolves the parent folder and answers 404 when it is
    // missing, so a byte file makes the folder first, through the route that
    // creates parents recursively.
    const calls: Call[] = [];
    globalThis.fetch = recordingFetch(calls);

    const result = await writeVqFiles([...textFiles(['answer.json']), audioFile()], destination, WORKSPACE);

    expect(result).toEqual({ ok: true, location: FOLDER });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/fs/mkdir',
      '/api/fs/upload',
      '/api/fs/write',
    ]);
    expect((calls[0].body as { path: string }).path).toBe(FOLDER);
    const upload = calls[1];
    expect(upload.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(upload.headers.get('x-opencode-directory')).toBe(WORKSPACE);
    expect(upload.body).toBeInstanceOf(Blob);
    // The answer still lands last, after the byte file, and reports the folder.
    expect((calls[2].body as { path: string }).path).toBe(`${FOLDER}/answer.json`);
    expect(answerEnvelope(calls).output).toEqual({ ok: true, location: FOLDER });
  });

  test('a text-only answer makes no folder of its own', async () => {
    const calls: Call[] = [];
    globalThis.fetch = recordingFetch(calls);

    await writeVqFiles(textFiles(['answer.json']), destination, WORKSPACE);

    expect(calls.map((call) => call.path)).toEqual(['/api/fs/write']);
  });

  test('a refused recording leaves the text files on the disk and names the audio', async () => {
    const calls: Call[] = [];
    globalThis.fetch = stubFetch(calls, (path) => (
      path === '/api/fs/upload'
        ? Response.json({ error: 'Destination directory not found' }, { status: 404 })
        : Response.json({ success: true })
    ));

    const result = await writeVqFiles([...textFiles(['answer.json']), audioFile()], destination, WORKSPACE);

    expect(result.ok).toBe(false);
    expect(result.location).toBe(FOLDER);
    expect(result.errors).toEqual(['recording.webm: Destination directory not found']);
    // The folder is still the answer's, and its JSON is still there.
    expect(calls.filter((call) => call.path === '/api/fs/write')).toHaveLength(1);
  });

  test('an answer that is not JSON is written as built, with the receipt failure named', async () => {
    const calls: Call[] = [];
    globalThis.fetch = recordingFetch(calls);

    const files: OutputFile[] = [
      { name: 'answer.json', data: 'answer.json body', mime: 'application/json' },
      { name: 'notes.md', data: 'notes.md body', mime: 'text/markdown' },
    ];
    // The writer must still return, and the answer must still reach the disk.
    const result = await writeVqFiles(files, destination, WORKSPACE);

    expect(result.ok).toBe(false);
    expect(result.location).toBe(FOLDER);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toContain('answer.json: could not attach output receipt (');
    expect(bodyFor(calls, 'answer.json').content).toBe('answer.json body');
    expect(bodyFor(calls, 'notes.md').content).toBe('notes.md body');
  });

  test('an answer envelope that is not an object is written as built too', async () => {
    const calls: Call[] = [];
    globalThis.fetch = recordingFetch(calls);

    const result = await writeVqFiles([{ name: 'answer.json', data: '["not", "an", "object"]', mime: 'application/json' }], destination, WORKSPACE);

    expect(result.errors).toEqual(['answer.json: could not attach output receipt (the answer is not a JSON object)']);
    expect(bodyFor(calls, 'answer.json').content).toBe('["not", "an", "object"]');
  });

  test('an answer with no answer.json says so rather than claiming a clean write', async () => {
    const calls: Call[] = [];
    globalThis.fetch = recordingFetch(calls);

    const result = await writeVqFiles([{ name: 'notes.md', data: 'notes.md body', mime: 'text/markdown' }], destination, WORKSPACE);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([`answer.json: could not attach output receipt (the answer named no answer.json)`]);
    expect(bodyFor(calls, 'notes.md').content).toBe('notes.md body');
  });

  test('a refused answer file is named after every other file has reported', async () => {
    const calls: Call[] = [];
    globalThis.fetch = stubFetch(calls, (_path, body) => (
      (body as { path: string }).path.endsWith('answer.json')
        ? Response.json({ error: 'Path is outside of active workspace' }, { status: 400 })
        : Response.json({ success: true })
    ));

    const result = await writeVqFiles(textFiles(['answer.json', 'notes.md']), destination, WORKSPACE);

    expect(result.errors).toEqual(['answer.json: Path is outside of active workspace']);
    expect(calls.map((call) => (call.body as { path: string }).path)).toEqual([
      `${FOLDER}/notes.md`,
      `${FOLDER}/answer.json`,
    ]);
  });

  test('a folder that cannot be made is the recording’s own error', async () => {
    const calls: Call[] = [];
    globalThis.fetch = stubFetch(calls, (path) => (
      path === '/api/fs/mkdir'
        ? Response.json({ error: 'Path is outside of active workspace' }, { status: 400 })
        : Response.json({ success: true })
    ));

    const result = await writeVqFiles([...textFiles(['answer.json']), audioFile()], destination, WORKSPACE);

    expect(result.errors).toEqual(['recording.webm: Path is outside of active workspace']);
    expect(calls.some((call) => call.path === '/api/fs/upload')).toBe(false);
  });
});
