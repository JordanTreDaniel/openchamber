import { afterEach, expect, test } from 'bun:test';
import { loadVqSource, vqTableColumns, VqSourceError, type VqSourceSpec } from './source';

const PATH = '/tmp/vq-source-test.json';

const CONTACTS = {
  schema: 1,
  session: 'a-call-card',
  contacts: [
    { name: 'Victoria Abshire', title: 'Executive Recruiter', firm: 'Talance Group', segment: 'recruiters', notion: { contact: 'id-1' } },
    { name: '', title: '', firm: 'ProFound Staffing', segment: 'recruiters', notion: { contact: null } },
    { name: 'Ann Lee', title: '', firm: 'Harnham', segment: 'owners', notion: { contact: 'id-1' } },
    { name: 'Bob Ray', title: 'Partner', firm: 'Blue Signal', segment: 'owners', id: 'own-2' },
  ],
};

const originalFetch = globalThis.fetch;

const serve = (body: unknown, status = 200) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
};

const base: VqSourceSpec = {
  path: PATH,
  select: 'contacts',
  fields: { label: 'name', detail: '{title} · {firm}' },
  idField: 'notion.contact',
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('maps records onto items, eliding the empty half of a detail', async () => {
  serve(CONTACTS);
  const resolved = await loadVqSource('assign', { ...base, limit: 3 });
  expect(resolved.prop).toBe('items');
  expect(resolved.data).toEqual([
    { id: 'id-1', label: 'Victoria Abshire', detail: 'Executive Recruiter · Talance Group' },
    // A blank title and a null id fall back to the firm and the record's index.
    { id: '1', label: 'ProFound Staffing', detail: 'ProFound Staffing' },
    // The second id-1 would merge two cards; the later record keeps both apart.
    { id: 'id-1#2', label: 'Ann Lee', detail: 'Harnham' },
  ]);
});

test('pick and duel read options, table reads rows with columns', async () => {
  serve(CONTACTS);
  expect((await loadVqSource('pick', { ...base, limit: 2 })).prop).toBe('options');
  expect((await loadVqSource('duel', { ...base, limit: 2 })).prop).toBe('options');
  const table = await loadVqSource('table', { ...base, limit: 2 });
  expect(table.prop).toBe('rows');
  expect(table.data[0]).toEqual({ id: 'id-1', cells: { label: 'Victoria Abshire', detail: 'Executive Recruiter · Talance Group' } });
  expect(vqTableColumns(base.fields)).toEqual([
    { id: 'label', label: 'Label', kind: 'text' },
    { id: 'detail', label: 'Detail', kind: 'text' },
  ]);
});

test('where filters before the limit, by equality and by prefix', async () => {
  serve(CONTACTS);
  const equal = await loadVqSource('assign', { ...base, where: { segment: 'owners' } });
  expect(equal.data.map((item) => (item as { id: string }).id)).toEqual(['id-1', 'own-2']);
  const prefix = await loadVqSource('assign', { ...base, where: [{ field: 'segment', prefix: 'recr' }] });
  expect(prefix.data).toHaveLength(2);
  const caret = await loadVqSource('assign', { ...base, where: { segment: '^recr' }, limit: 1 });
  expect(caret.data).toHaveLength(1);
});

test('the label never comes out empty', async () => {
  serve({ rows: [{ firm: '', id: '' }] });
  const resolved = await loadVqSource('assign', { path: PATH, select: 'rows', fields: { label: 'name' } });
  expect((resolved.data[0] as { label: string }).label).toBe('#1');
});

test('a select that is not an array names the path and what it found', async () => {
  serve(CONTACTS);
  await expect(loadVqSource('assign', { ...base, select: 'session' })).rejects.toThrow(
    /vq source \/tmp\/vq-source-test\.json: select 'session' is not an array \(found string\)/,
  );
});

test('a failed read carries the route’s reason', async () => {
  serve({ error: 'File not found' }, 404);
  await expect(loadVqSource('assign', base)).rejects.toThrow('vq source /tmp/vq-source-test.json: File not found');
});

test('a body that is not JSON is named as such', async () => {
  globalThis.fetch = (async () => new Response('<html>nope</html>')) as unknown as typeof fetch;
  const failure = loadVqSource('assign', base).catch((error: unknown) => error);
  expect(await failure).toBeInstanceOf(VqSourceError);
});

test('a map without coordinates is refused', async () => {
  serve(CONTACTS);
  await expect(loadVqSource('map', base)).rejects.toThrow('a map needs fields.lat and fields.lng');
});

test('two renders of one source share a single read', async () => {
  let reads = 0;
  globalThis.fetch = (async () => {
    reads += 1;
    return new Response(JSON.stringify(CONTACTS));
  }) as unknown as typeof fetch;
  const [first, second] = await Promise.all([
    loadVqSource('assign', { ...base, limit: 1 }),
    loadVqSource('assign', { ...base, limit: 1 }),
  ]);
  expect(reads).toBe(1);
  expect(first).toBe(second);
});
