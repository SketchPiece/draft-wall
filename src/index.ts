import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { pages } from './generated/pages.js';
import { fileKey, newSession, passwordMatches, SESSION_DAYS, validSession, validToken } from './auth.js';
import { applyLayout, BOARD_CSP, contentType, injectBridge, validId, validPath } from './shared.js';
import * as store from './store.js';

const COOKIE = 'canvas_session';
const POLL_MS = 10_000;
const app = new Hono();

const authed = (c: Context) => validSession(getCookie(c, COOKIE)) || validToken(c.req.header('authorization'));
const html = (c: Context, body: string, status: 200 | 401 = 200) =>
  c.html(body, status, { 'cache-control': 'no-store', 'x-frame-options': 'DENY' });
const loginRedirect = (c: Context) => c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
const safeNext = (next: string | undefined) => (next && /^\/(?!\/)/.test(next) ? next : '/');

// ---- pages ----
app.get('/login', c => html(c, pages.login.replace('{{error}}', '').replace('{{next}}', escapeAttr(safeNext(c.req.query('next'))))));
app.post('/login', async c => {
  const form = await c.req.parseBody();
  const next = safeNext(String(form.next ?? ''));
  if (!passwordMatches(String(form.password ?? ''))) {
    return html(c, pages.login.replace('{{error}}', 'Wrong password').replace('{{next}}', escapeAttr(next)), 401);
  }
  setCookie(c, COOKIE, newSession(), { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 });
  return c.redirect(next);
});
app.get('/', c => (authed(c) ? html(c, pages.index) : loginRedirect(c)));
app.get('/c/:id', c => (authed(c) ? html(c, pages.viewer) : loginRedirect(c)));

// ---- board files: capability key in the path, no cookie ----
app.get('/f/:id/:key/*', async c => {
  const { id, key } = c.req.param();
  const path = decodeURIComponent(c.req.path.split('/').slice(4).join('/'));
  if (!validId(id) || key !== fileKey(id) || !validPath(path)) return c.notFound();
  const file = await store.getFile(id, path);
  if (!file) return c.notFound();
  const type = contentType(path);
  const headers: Record<string, string> = {
    'content-type': type,
    'content-security-policy': BOARD_CSP,
    // ?v=<hash> URLs never change content, so the CDN may keep them.
    'cache-control': c.req.query('v') ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (type.startsWith('text/html')) return new Response(injectBridge(await new Response(file.stream).text()), { headers });
  return new Response(file.stream, { headers });
});

// ---- API ----
const api = new Hono();
api.use('*', async (c, next) => (authed(c) ? next() : c.json({ error: 'Sign in first' }, 401)));
api.use('/canvases/:id/*', async (c, next) => (validId(c.req.param('id')) ? next() : c.json({ error: 'Bad canvas id' }, 400)));
api.use('/canvases/:id', async (c, next) => (validId(c.req.param('id')) ? next() : c.json({ error: 'Bad canvas id' }, 400)));

api.get('/canvases', async c => {
  const states = await store.listStates();
  return c.json(states.map(s => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, boards: Object.keys(s.canvas.boards ?? {}).length, notes: s.canvas.annotations?.length ?? 0 })));
});

api.get('/canvases/:id', async c => {
  const id = c.req.param('id');
  const state = await store.readState(id);
  if (!state) return c.json({ error: 'Canvas not found' }, 404);
  return c.json({ ...state, fileBase: `/f/${id}/${fileKey(id)}/`, poll: POLL_MS }, 200, { 'cache-control': 'no-store' });
});

// CLI push: upload changed files one by one, then commit the manifest.
api.put('/canvases/:id/files/*', async c => {
  const id = c.req.param('id');
  const path = decodeURIComponent(c.req.path.split('/files/').slice(1).join('/files/'));
  if (!validPath(path)) return c.json({ error: `Bad file path: ${path}` }, 400);
  await store.putFile(id, path, await c.req.arrayBuffer(), contentType(path));
  return c.body(null, 204);
});

api.post('/canvases/:id/commit', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<{ canvas: store.Canvas; files: Record<string, string> }>();
  if (!body?.canvas || typeof body.canvas.boards !== 'object' || typeof body.files !== 'object') return c.json({ error: 'canvas and files are required' }, 400);
  if (!Object.keys(body.files).every(validPath)) return c.json({ error: 'Bad file path in manifest' }, 400);
  const prev = await store.readState(id);
  await store.deleteFiles(id, Object.keys(prev?.files ?? {}).filter(p => !(p in body.files)));
  const state: store.State = { id, title: body.canvas.title ?? id, updatedAt: Date.now(), files: body.files, canvas: body.canvas };
  await store.writeState(state);
  return c.json({ url: new URL(`/c/${id}`, c.req.url).toString(), updatedAt: state.updatedAt });
});

// Viewer: board positions and sticky notes.
api.put('/canvases/:id/layout', async c => {
  const id = c.req.param('id');
  const state = await store.readState(id);
  if (!state) return c.json({ error: 'Canvas not found' }, 404);
  applyLayout(state.canvas, await c.req.json());
  state.updatedAt = Date.now();
  await store.writeState(state);
  return c.json({ updatedAt: state.updatedAt });
});

api.delete('/canvases/:id', async c => {
  await store.deleteCanvas(c.req.param('id'));
  return c.body(null, 204);
});

app.route('/api', api);
app.onError((err, c) => { console.error(err); return c.json({ error: 'Server error' }, 500); });

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export default app;
