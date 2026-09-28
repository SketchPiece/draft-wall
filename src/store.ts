import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Layout on disk under CANVAS_DATA_DIR (a Railway volume in production, ./data locally):
//   settings.json          { creators: ["a@b.com", "@company.com"] }
//   c/<id>/state.json      { id, title, updatedAt, files: { path: hash }, canvas }
//   c/<id>/access.json     { owner, epoch, members: [{ email, role }], public? }, apart from state so pushes and layout saves can't drop it
//   c/<id>/files/<path>    board HTML and assets as pushed
//   c/<id>/history.json    [{ v, at, by, kind, summary }], oldest first: every change, by a push or in the viewer
//   c/<id>/versions/<v>.json  { title, canvas, files } as they were after change v
//   c/<id>/objects/<hash>  file contents by the hash in the manifest, so older versions can be shown and restored
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
const historyPath = (id: string) => join(canvasDir(id), 'history.json');
const versionPath = (id: string, v: number) => join(canvasDir(id), 'versions', `${v}.json`);
const objectPath = (id: string, hash: string) => join(canvasDir(id), 'objects', hash);
export const validHash = (h: unknown): h is string => typeof h === 'string' && /^[\w-]{1,64}$/.test(h);

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

const missing = (e: unknown) => ['ENOENT', 'EISDIR', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '');

// Boards and their assets are small, so a whole read is fine and leaves no open handle when the caller bails out.
// With a hash, the file as it was in the version that had it (older versions are shown this way), else the current one.
export async function getFile(id: string, path: string, hash?: string) {
  if (hash && validHash(hash)) {
    try { return { stream: new Blob([await readFile(objectPath(id, hash))]).stream() }; } catch (e) { if (!missing(e)) throw e; }
  }
  try {
    return { stream: new Blob([await readFile(filePath(id, path))]).stream() };
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

// ---- history ----
export type Version = { v: number; at: number; by: string; kind: 'push' | 'edit' | 'restore' | 'initial'; summary: string; from?: number };
export type VersionBody = { title: string; canvas: Canvas; files: Record<string, string> };
const MAX_VERSIONS = 300;

export const readHistory = async (id: string) => (await readJson<Version[]>(historyPath(id))) ?? [];
export const readVersion = (id: string, v: number) => readJson<VersionBody>(versionPath(id, v));

// Keeps a copy of every current file under its hash, so the version being recorded can come back later.
async function keepObjects(id: string, files: Record<string, string>) {
  await mkdir(join(canvasDir(id), 'objects'), { recursive: true });
  await Promise.all(Object.entries(files).map(async ([path, hash]) => {
    if (!validHash(hash)) return;
    await copyFile(filePath(id, path), objectPath(id, hash), constants.COPYFILE_EXCL).catch(e => {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' && !missing(e)) throw e;
    });
  }));
}

export async function addVersion(id: string, state: State, entry: Omit<Version, 'v' | 'at'>) {
  const list = await readHistory(id);
  const v = (list.at(-1)?.v ?? 0) + 1;
  await keepObjects(id, state.files);
  await writeJson(versionPath(id, v), { title: state.title, canvas: state.canvas, files: state.files } satisfies VersionBody);
  list.push({ v, at: state.updatedAt, ...entry });
  const dropped = list.splice(0, Math.max(0, list.length - MAX_VERSIONS));
  await writeJson(historyPath(id), list);
  if (dropped.length) await dropVersions(id, dropped.map(x => x.v), list);
  return v;
}

// Removes old versions and the file copies no kept version (or the current state) still uses.
async function dropVersions(id: string, gone: number[], kept: Version[]) {
  await Promise.all(gone.map(v => rm(versionPath(id, v), { force: true })));
  const used = new Set<string>();
  for (const x of kept) Object.values((await readVersion(id, x.v))?.files ?? {}).forEach(h => used.add(h));
  Object.values((await readState(id))?.files ?? {}).forEach(h => used.add(h));
  const objects = await readdir(join(canvasDir(id), 'objects')).catch(() => []);
  await Promise.all(objects.filter(h => !used.has(h)).map(h => rm(objectPath(id, h), { force: true })));
}

// Puts the files of an older version back in place. Returns the manifest that is now current.
export async function restoreFiles(id: string, target: Record<string, string>, current: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [path, hash] of Object.entries(target)) {
    if (current[path] === hash) { out[path] = hash; continue; }
    try {
      await writeAtomic(filePath(id, path), await readFile(objectPath(id, hash)));
      out[path] = hash;
    } catch (e) {
      if (!missing(e)) throw e;
      if (current[path]) out[path] = current[path]; // that copy is gone: keep the file as it is now
    }
  }
  await deleteFiles(id, Object.keys(current).filter(p => !(p in out)));
  return out;
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
