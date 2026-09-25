import { del, get, list, put } from '@vercel/blob';

// Layout in the private Blob store:
//   c/<id>/state.json      { id, title, updatedAt, files: { path: hash }, canvas }
//   c/<id>/files/<path>    board HTML and assets as pushed
export type Canvas = {
  title?: string;
  boards: Record<string, { x: number; y: number; w: number; h: number; title?: string }>;
  order?: string[];
  notes?: Record<string, unknown>;
  annotations?: Annotation[];
  [key: string]: unknown;
};
export type Annotation = { id: string; x: number; y: number; w: number; text: string; color?: string; [key: string]: unknown };
export type State = { id: string; title: string; updatedAt: number; files: Record<string, string>; canvas: Canvas };

const statePath = (id: string) => `c/${id}/state.json`;
const filePath = (id: string, path: string) => `c/${id}/files/${path}`;

export async function readState(id: string): Promise<State | null> {
  const r = await get(statePath(id), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}

export async function writeState(state: State) {
  await put(statePath(state.id), JSON.stringify(state), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
  });
}

export async function putFile(id: string, path: string, body: ArrayBuffer, contentType: string) {
  await put(filePath(id, path), Buffer.from(body), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType,
  });
}

export async function getFile(id: string, path: string) {
  const r = await get(filePath(id, path), { access: 'private' });
  return r?.statusCode === 200 ? r : null;
}

export async function deleteFiles(id: string, paths: string[]) {
  if (paths.length) await del(paths.map(p => filePath(id, p)));
}

export async function deleteCanvas(id: string) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `c/${id}/`, cursor });
    if (page.blobs.length) await del(page.blobs.map(b => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

export async function listStates(): Promise<State[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'c/', mode: 'folded', cursor });
    for (const folder of page.folders) ids.push(folder.slice(2, -1));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const states = await Promise.all(ids.map(readState));
  return states.filter((s): s is State => !!s).sort((a, b) => b.updatedAt - a.updatedAt);
}
