import { del, get, list, put } from '@vercel/blob';

// Layout in the private Blob store (under CANVAS_STORE_PREFIX, e.g. "dev/" for a local server):
//   settings.json          { creators: ["a@b.com", "@company.com"] }
//   c/<id>/state.json      { id, title, updatedAt, files: { path: hash }, canvas }
//   c/<id>/access.json     { owner, epoch, members: [{ email, role }] }, apart from state so pushes and layout saves can't drop it
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
export type Role = 'viewer' | 'editor';
// A member is one email or a whole domain ("@company.com").
export type Access = { owner: string; epoch: number; members: { email: string; role: Role }[] };
export type Settings = { creators: string[] };

const PREFIX = process.env.CANVAS_STORE_PREFIX ?? '';
const statePath = (id: string) => `${PREFIX}c/${id}/state.json`;
const accessPath = (id: string) => `${PREFIX}c/${id}/access.json`;
const filePath = (id: string, path: string) => `${PREFIX}c/${id}/files/${path}`;

async function readJson<T>(pathname: string): Promise<T | null> {
  const r = await get(pathname, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}

async function writeJson(pathname: string, value: unknown) {
  await put(pathname, JSON.stringify(value), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
  });
}

export const readState = (id: string) => readJson<State>(statePath(id));
export const writeState = (state: State) => writeJson(statePath(state.id), state);
export const readAccess = (id: string) => readJson<Access>(accessPath(id));
export const writeAccess = (id: string, access: Access) => writeJson(accessPath(id), access);
export const readSettings = async (): Promise<Settings> => ({ creators: [], ...await readJson<Settings>(`${PREFIX}settings.json`) });
export const writeSettings = (settings: Settings) => writeJson(`${PREFIX}settings.json`, settings);

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
    const page = await list({ prefix: `${PREFIX}c/${id}/`, cursor });
    if (page.blobs.length) await del(page.blobs.map(b => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

export async function listIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${PREFIX}c/`, mode: 'folded', cursor });
    for (const folder of page.folders) ids.push(folder.slice(PREFIX.length + 2, -1));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return ids;
}
