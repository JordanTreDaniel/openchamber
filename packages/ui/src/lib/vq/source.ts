/**
 * The data behind a `vq` fence: the fence names a file, a selector into it and
 * the fields that become labels; this turns those records into the prop the
 * named component reads (`items`, `options`, `rows`, `places`).
 *
 * Pure data, no React, so the mapping can be checked without a render. The read
 * goes through the app's own file route, which answers the file's text as it is
 * (`text/plain`, no envelope), so the parse is guarded here.
 */

export interface VqSourceWhere {
  field: string;
  equals?: string;
  prefix?: string;
}

export interface VqSourceFields {
  label: string;
  /** Template: `{token}` is a dot path into the record; ` · ` joins the parts that survive. */
  detail?: string;
  image?: string;
  lat?: string;
  lng?: string;
}

export interface VqSourceSpec {
  path: string;
  /** Dot path into the parsed file, as a string or its segments; absent means the file's root. */
  select?: string | string[];
  /** Equality on the records; a value starting with `^` matches the prefix instead. */
  where?: Record<string, string> | VqSourceWhere[];
  limit?: number;
  fields: VqSourceFields;
  idField?: string;
}

export interface ResolvedVqSource {
  prop: 'items' | 'options' | 'rows' | 'places' | 'nodes';
  data: unknown[];
}

/** A source the fence asked for that cannot be resolved; the message is shown as written. */
export class VqSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VqSourceError';
  }
}

const TTL_MS = 15_000;
const CACHE_LIMIT = 50;
const PLACEHOLDER = /\{([^{}]+)\}/g;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Only these two carry meaning: a number is not a label and `null` is an
// absent field, so neither may read through as "null" in a template.
const textOf = (value: unknown): string => (
  value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value)
);

/** Read a dot path out of parsed JSON; a missing segment reads as undefined. */
const readPath = (value: unknown, path: string): unknown => {
  if (!path) return value;
  let current = value;
  for (const segment of path.split('.')) {
    if (!segment || current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const pathSegments = (select: string | string[] | undefined): string[] => {
  if (Array.isArray(select)) return select.flatMap((part) => String(part).split('.')).filter(Boolean);
  if (typeof select === 'string') return select.split('.').filter(Boolean);
  return [];
};

const selectedRecords = (root: unknown, select: VqSourceSpec['select'], path: string): unknown[] => {
  const segments = pathSegments(select);
  let value: unknown = root;
  for (const segment of segments) {
    value = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined;
  }
  if (!Array.isArray(value)) {
    const found = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const name = segments.length ? `select '${segments.join('.')}'` : 'the file root';
    throw new VqSourceError(`vq source ${path}: ${name} is not an array (found ${found})`);
  }
  return value;
};

const matchesWhere = (record: unknown, where: VqSourceSpec['where']): boolean => {
  if (!where) return true;
  if (Array.isArray(where)) {
    return where.every((clause) => {
      const actual = textOf(readPath(record, clause.field));
      if (clause.prefix !== undefined) return actual.startsWith(String(clause.prefix));
      if (clause.equals !== undefined) return actual === String(clause.equals);
      return true;
    });
  }
  return Object.entries(where).every(([field, expected]) => {
    const actual = textOf(readPath(record, field));
    const wanted = String(expected);
    return wanted.startsWith('^') ? actual.startsWith(wanted.slice(1)) : actual === wanted;
  });
};

const recordId = (record: unknown, source: VqSourceSpec, index: number): string => {
  const fields = source.idField ? [source.idField, 'id'] : ['id'];
  for (const field of fields) {
    const value = textOf(readPath(record, field)).trim();
    if (value) return value;
  }
  return String(index);
};

const recordLabel = (record: unknown, field: string, index: number): string => {
  const own = textOf(readPath(record, field)).trim();
  if (own) return own;
  // A blank card reads as a bug; the record's firm, its id, then its place in
  // the file keep every item addressable.
  const firm = textOf(readPath(record, 'firm')).trim();
  if (firm) return firm;
  const id = textOf(readPath(record, 'id')).trim();
  return id || `#${index + 1}`;
};

const recordDetail = (record: unknown, template: string | undefined): string => {
  if (!template) return '';
  const filled = template.replace(PLACEHOLDER, (_match, token: string) => textOf(readPath(record, token.trim())).trim());
  // An empty token leaves its separator behind, so "Acme · " must read as "Acme".
  return filled.split('·').map((part) => part.trim()).filter(Boolean).join(' · ');
};

const recordImage = (record: unknown, field: string | undefined): string | undefined => {
  if (!field) return undefined;
  const value = textOf(readPath(record, field)).trim();
  return value || undefined;
};

/** Two records that answer to the same id would merge into one card; keep both. */
const uniqueIds = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.map((item, index) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      return item;
    }
    const id = `${item.id}#${index}`;
    seen.add(id);
    return { ...item, id };
  });
};

const propFor = (specType: string): ResolvedVqSource['prop'] => {
  switch (specType) {
    case 'pick':
    case 'duel':
      return 'options';
    case 'table':
      return 'rows';
    case 'map':
      return 'places';
    default:
      return 'items';
  }
};

/** The columns a `table` needs for the cells a source fills. */
export function vqTableColumns(fields: VqSourceFields): { id: string; label: string; kind: 'text' | 'image' }[] {
  const columns: { id: string; label: string; kind: 'text' | 'image' }[] = [{ id: 'label', label: 'Label', kind: 'text' }];
  if (fields.detail) columns.push({ id: 'detail', label: 'Detail', kind: 'text' });
  if (fields.image) columns.push({ id: 'image', label: 'Image', kind: 'image' });
  return columns;
}

const buildElements = (records: unknown[], source: VqSourceSpec) => records.map((record, index) => {
  const element: { id: string; label: string; detail?: string; image?: string } = {
    id: recordId(record, source, index),
    label: recordLabel(record, source.fields.label, index),
  };
  const detail = recordDetail(record, source.fields.detail);
  if (detail) element.detail = detail;
  const image = recordImage(record, source.fields.image);
  if (image) element.image = image;
  return element;
});

const buildRows = (records: unknown[], source: VqSourceSpec) => records.map((record, index) => {
  const cells: Record<string, string> = { label: recordLabel(record, source.fields.label, index) };
  const detail = recordDetail(record, source.fields.detail);
  if (detail) cells.detail = detail;
  const image = recordImage(record, source.fields.image);
  if (image) cells.image = image;
  return { id: recordId(record, source, index), cells };
});

const buildPlaces = (records: unknown[], source: VqSourceSpec) => {
  const { lat: latField, lng: lngField } = source.fields;
  if (!latField || !lngField) throw new VqSourceError('vq source: a map needs fields.lat and fields.lng');
  const places = records.flatMap((record, index) => {
    const lat = Number(readPath(record, latField));
    const lng = Number(readPath(record, lngField));
    // A record without coordinates cannot be placed; dropping it beats a
    // marker at 0,0 in the Atlantic.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const place: { id: string; label: string; lat: number; lng: number; image?: string; address?: string } = {
      id: recordId(record, source, index),
      label: recordLabel(record, source.fields.label, index),
      lat,
      lng,
    };
    const image = recordImage(record, source.fields.image);
    if (image) place.image = image;
    // On a map the detail line is where the place is: the label is short.
    const address = recordDetail(record, source.fields.detail);
    if (address) place.address = address;
    return [place];
  });
  if (!places.length) {
    throw new VqSourceError(`vq source ${source.path}: no record has a numeric ${latField}/${lngField}`);
  }
  return uniqueIds(places);
};

async function readJson(path: string): Promise<unknown> {
  const query = new URLSearchParams({ path, allowOutsideWorkspace: 'true' });
  // The app's own fetch bridge resolves this path on every runtime; the cookie
  // carries a UI password when one is set.
  const response = await fetch(`/api/fs/read?${query.toString()}`, { credentials: 'include', cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) {
    let reason = '';
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
        reason = (parsed as { error: string }).error;
      }
    } catch {
      // A 401 from a UI password is HTML: the status is the whole story.
    }
    throw new VqSourceError(`vq source ${path}: ${reason || `HTTP ${response.status}`}`);
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new VqSourceError(`vq source ${path}: not JSON (${messageOf(error)})`);
  }
}

async function resolveVqSource(specType: string, source: VqSourceSpec): Promise<ResolvedVqSource> {
  const path = typeof source.path === 'string' ? source.path.trim() : '';
  if (!path) throw new VqSourceError('vq source: path is required');
  if (!source.fields || !source.fields.label) throw new VqSourceError(`vq source ${path}: fields.label is required`);

  const root = await readJson(path);
  const records = selectedRecords(root, source.select, path).filter((record) => matchesWhere(record, source.where));
  const limit = typeof source.limit === 'number' && Number.isFinite(source.limit) ? Math.floor(source.limit) : 0;
  const limited = limit > 0 ? records.slice(0, limit) : records;
  const prop = propFor(specType);

  if (prop === 'rows') return { prop, data: uniqueIds(buildRows(limited, source)) };
  if (prop === 'places') return { prop, data: buildPlaces(limited, source) };
  return { prop, data: uniqueIds(buildElements(limited, source)) };
}

interface CacheEntry {
  at: number;
  resolved: Promise<ResolvedVqSource>;
}

const cache = new Map<string, CacheEntry>();

/**
 * The records of one fence's file, mapped to the prop of its component.
 * Concurrent fences on the same path share one request, and a fresh result is
 * reused for `TTL_MS` so a re-render does not read the file again.
 */
export function loadVqSource(specType: string, source: VqSourceSpec): Promise<ResolvedVqSource> {
  const key = JSON.stringify({ specType, ...source });
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.resolved;

  const entry: CacheEntry = { at: now, resolved: resolveVqSource(specType, source) };
  cache.set(key, entry);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done && oldest.value !== key) cache.delete(oldest.value);
  }
  // A failed read must not be served for the next 15 s: the file may simply not
  // have been written yet.
  entry.resolved.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return entry.resolved;
}
