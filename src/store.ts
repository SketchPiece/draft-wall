import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Layout on disk under CANVAS_DATA_DIR (a Railway volume in production, ./data locally):
//   settings.json          { creators: ["a@b.com", "@company.com"] }
//   c/<id>/state.json      { id, title, updatedAt, files: { path: hash }, canvas }
//   c/<id>/access.json     { owner, epoch, members: [{ email, role }], public? }, apart from state so pushes and layout saves can't drop it
//   c/<id>/files/<path>    board HTML and assets as pushed
export type Canvas = {
  title?: string;
  boards: Record<string, { x: number; y: number; w: number; h: number; title?: string; nodes?: Record<string, [number, number]> }>;
  order?: string[];
  notes?: Record<string, unknown>;
  annotations?: Annotation[];
  [key: string]: unknown;
};
export type Annotation = { id: string; x: number; y: number; w: number; text: string; color?: string; [key: string]: unknown };
export type State = { id: string; title: string; updatedAt: number; files: Record<string, string>; canvas: Canvas };
export type Role = 'viewer' | 'editor';
// A member is one email or a whole domain ("@company.com").
// public: anyone with the link may view, signed in or not.
export type Access = { owner: string; epoch: number; members: { email: string; role: Role }[]; public?: boolean };
export type Settings = { creators: string[] };

const ROOT = process.env.CANVAS_DATA_DIR ?? 'data';
const canvasDir = (id: string) => join(ROOT, 'c', id);
const statePath = (id: string) => join(canvasDir(id), 'state.json');
const accessPath = (id: string) => join(canvasDir(id), 'access.json');
const filePath = (id: string, path: string) => join(canvasDir(id), 'files', path);

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

// Write to a temp file and rename, so readers never see half a file.
async function writeAtomic(path: string, data: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

const writeJson = (path: string, value: unknown) => writeAtomic(path, JSON.stringify(value));

export const readState = (id: string) => readJson<State>(statePath(id));
export const writeState = (state: State) => writeJson(statePath(state.id), state);
export const readAccess = (id: string) => readJson<Access>(accessPath(id));
export const writeAccess = (id: string, access: Access) => writeJson(accessPath(id), access);
export const readSettings = async (): Promise<Settings> => ({ creators: [], ...await readJson<Settings>(join(ROOT, 'settings.json')) });
export const writeSettings = (settings: Settings) => writeJson(join(ROOT, 'settings.json'), settings);

export async function putFile(id: string, path: string, body: ArrayBuffer) {
  await writeAtomic(filePath(id, path), Buffer.from(body));
}

// Boards and their assets are small, so a whole read is fine and leaves no open handle when the caller bails out.
export async function getFile(id: string, path: string) {
  try {
    return { stream: new Blob([await readFile(filePath(id, path))]).stream() };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return null;
    throw e;
  }
}

export async function deleteFiles(id: string, paths: string[]) {
  await Promise.all(paths.map(p => rm(filePath(id, p), { force: true })));
}

export async function deleteCanvas(id: string) {
  await rm(canvasDir(id), { recursive: true, force: true });
}

export async function listIds(): Promise<string[]> {
  const entries = await readdir(join(ROOT, 'c'), { withFileTypes: true }).catch(() => []);
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}
