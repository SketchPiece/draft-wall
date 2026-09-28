import * as store from './store.js';
import type { Canvas, State, Version } from './store.js';

// Every change to a canvas (a push from the CLI, an edit in the viewer, a restore) is kept as a version,
// so the canvas can be taken back to any of them.

// Changes to one canvas are recorded one at a time, so two saves at once can't both take the same version number.
const queues = new Map<string, Promise<unknown>>();
export function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
  const tail = run.finally(() => { if (queues.get(id) === tail) queues.delete(id); });
  queues.set(id, tail);
  return run;
}

// A canvas that existed before history did gets its current state as the first version, before anything overwrites it.
export async function ensureBaseline(id: string) {
  if ((await store.readHistory(id)).length) return;
  const state = await store.readState(id);
  if (state) await store.addVersion(id, state, { by: '', kind: 'initial', summary: 'Before history was kept' });
}

// Records `next` (already written) as a new version, unless nothing visible changed.
export async function record(prev: State | null, next: State, by: string, kind: Version['kind'], extra: Partial<Version> = {}) {
  const summary = kind === 'restore' ? '' : describe(prev?.canvas, next.canvas, prev?.files ?? {}, next.files);
  if (kind !== 'restore' && prev && !summary) return null;
  return store.addVersion(next.id, next, { by, kind, summary: summary || (prev ? '' : 'Created'), ...extra });
}

const plural = (n: number, one: string, many = one + 's') => (n === 1 ? `a ${one}` : `${n} ${many}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A short line of what changed, e.g. "2 boards updated, moved a sticky note".
export function describe(a: Canvas | undefined, b: Canvas, fa: Record<string, string>, fb: Record<string, string>) {
  const out: string[] = [];
  const boardsA = a?.boards ?? {}, boardsB = b.boards ?? {};
  const added = Object.keys(boardsB).filter(f => !boardsA[f]), removed = Object.keys(boardsA).filter(f => !boardsB[f]);
  const updated = Object.keys(boardsB).filter(f => boardsA[f] && fa[f] !== fb[f]);
  const assets = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(p => !boardsA[p] && !boardsB[p] && fa[p] !== fb[p]);
  if (added.length) out.push(`${plural(added.length, 'board')} added`);
  if (removed.length) out.push(`${plural(removed.length, 'board')} removed`);
  if (updated.length) out.push(`${plural(updated.length, 'board')} updated`);
  if (assets.length) out.push(`${plural(assets.length, 'file')} changed`);
  const moved = Object.keys(boardsB).filter(f => boardsA[f] && (boardsA[f].x !== boardsB[f].x || boardsA[f].y !== boardsB[f].y));
  if (moved.length) out.push(`moved ${plural(moved.length, 'board')}`);
  if (Object.keys(boardsB).some(f => boardsA[f] && !same(boardsA[f].nodes ?? {}, boardsB[f].nodes ?? {}))) out.push('moved diagram nodes');
  if ((a?.title ?? '') !== (b.title ?? '') && a) out.push('renamed the canvas');

  const items = (label: string, x: Record<string, any>, y: Record<string, any>) => {
    const add = Object.keys(y).filter(k => !x[k]).length, del = Object.keys(x).filter(k => !y[k]).length;
    let edit = 0, move = 0;
    for (const k of Object.keys(y)) {
      if (!x[k]) continue;
      const { x: x1, y: y1, ...r1 } = x[k], { x: x2, y: y2, ...r2 } = y[k];
      if (!same(r1, r2)) edit++; else if (x1 !== x2 || y1 !== y2) move++;
    }
    if (add) out.push(`added ${plural(add, label)}`);
    if (del) out.push(`removed ${plural(del, label)}`);
    if (edit) out.push(`edited ${plural(edit, label)}`);
    if (move) out.push(`moved ${plural(move, label)}`);
  };
  const byId = (list: Canvas['annotations']) => Object.fromEntries((list ?? []).map(n => [n.id, n]));
  items('sticky note', byId(a?.annotations), byId(b.annotations));
  items('heading', (a?.notes ?? {}) as Record<string, unknown>, (b.notes ?? {}) as Record<string, unknown>);
  const s = out.join(', ');
  return s && s[0].toUpperCase() + s.slice(1);
}
