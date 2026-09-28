import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { pages } from './generated/pages.js';
import {
  fileKey, googleAuthUrl, googleEmail, isAdmin, newCliToken, newFlow, newSession, openFlow, sealFlow,
  SESSION_DAYS, sessionEmail, tokenEmail,
} from './auth.js';
import { atLeast, canCreate, levelOf, parseCreators, parseMembers, type Level } from './access.js';
import { applyLayout, BOARD_CSP, contentType, injectBridge, validId, validPath } from './shared.js';
import { ensureBaseline, record, serial } from './history.js';
import * as store from './store.js';

type Env = { Variables: { email: string } };
const COOKIE = 'canvas_session';
const FLOW_COOKIE = 'canvas_signin';
const POLL_MS = 10_000;
const app = new Hono<Env>();

const userOf = (c: Context) => sessionEmail(getCookie(c, COOKIE)) ?? tokenEmail(c.req.header('authorization'));
const html = (c: Context, body: string, status: 200 | 401 = 200) =>
  c.html(body, status, { 'cache-control': 'no-store', 'x-frame-options': 'DENY' });
const loginRedirect = (c: Context) => c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
const safeNext = (next: string | undefined) => (next && /^\/(?!\/)/.test(next) ? next : '/');
const callbackUrl = (c: Context) => new URL('/auth/google/callback', c.req.url).toString();
const cookieOpts = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const;

// ---- sign-in ----
function loginPage(c: Context, next: string, error = '', status: 200 | 401 = 200) {
  return html(c, pages.login.replace('{{error}}', escapeAttr(error)).replace('{{href}}', escapeAttr(`/auth/google?next=${encodeURIComponent(next)}`)), status);
}
app.get('/login', c => loginPage(c, safeNext(c.req.query('next'))));

function startGoogle(c: Context, next: string) {
  const flow = newFlow(next);
  setCookie(c, FLOW_COOKIE, sealFlow(flow), { ...cookieOpts, maxAge: 600 });
  return c.redirect(googleAuthUrl(flow, callbackUrl(c)));
}
app.get('/auth/google', c => startGoogle(c, safeNext(c.req.query('next'))));

// `canvas login` listens on 127.0.0.1:<port> and gets its token back there.
app.get('/auth/cli', c => {
  const port = Number(c.req.query('port')), state = c.req.query('state') ?? '';
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[\w-]{16,64}$/.test(state)) return c.text('Bad CLI sign-in link', 400);
  return startGoogle(c, `cli:${port}:${state}`);
});

app.get('/auth/google/callback', async c => {
  const flow = openFlow(getCookie(c, FLOW_COOKIE));
  deleteCookie(c, FLOW_COOKIE, { path: '/' });
  if (!flow || c.req.query('state') !== flow.state) return loginPage(c, '/', 'Sign-in expired, try again', 401);
  const code = c.req.query('code');
  const email = code ? await googleEmail(code, flow, callbackUrl(c)) : null;
  const cli = flow.next.match(/^cli:(\d+):([\w-]+)$/);
  if (!email) return loginPage(c, cli ? '/' : flow.next, 'Google sign-in didn’t finish', 401);
  if (cli) {
    const q = new URLSearchParams({ state: cli[2], email, token: newCliToken(email) });
    return c.redirect(`http://127.0.0.1:${cli[1]}/callback?${q}`);
  }
  setCookie(c, COOKIE, newSession(email), { ...cookieOpts, maxAge: SESSION_DAYS * 86400 });
  return c.redirect(safeNext(flow.next));
});

app.get('/logout', c => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.redirect('/login');
});

// ---- pages ----
app.get('/', c => (sessionEmail(getCookie(c, COOKIE)) ? html(c, pages.index) : loginRedirect(c)));
// Served to anyone: a public canvas opens without signing in; otherwise the viewer sends people to /login.
app.get('/c/:id', c => html(c, pages.viewer));
app.get('/privacy', c => html(c, pages.privacy));
app.get('/terms', c => html(c, pages.terms));

// ---- board files: capability key in the path, no cookie ----
app.get('/f/:id/:key/*', async c => {
  const { id, key } = c.req.param();
  const path = decodeURIComponent(c.req.path.split('/').slice(4).join('/'));
  if (!validId(id) || !validPath(path)) return c.notFound();
  const [access, file] = await Promise.all([store.readAccess(id), store.getFile(id, path, c.req.query('v'))]);
  if (key !== fileKey(id, access?.epoch) || !file) return c.notFound();
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
const api = new Hono<Env>();
// Reading a canvas works signed out too (email ''), for public canvases; gate() answers 401 for the rest.
const openRead = (c: Context) => c.req.method === 'GET' && /^\/api\/canvases\/[^/]+$/.test(c.req.path);
api.use('*', async (c, next) => {
  const email = userOf(c) ?? (openRead(c) ? '' : null);
  if (email === null) return c.json({ error: 'Sign in first' }, 401);
  c.set('email', email);
  await next();
});
api.use('/canvases/:id/*', async (c, next) => (validId(c.req.param('id')) ? next() : c.json({ error: 'Bad canvas id' }, 400)));
api.use('/canvases/:id', async (c, next) => (validId(c.req.param('id')) ? next() : c.json({ error: 'Bad canvas id' }, 400)));

// Loads the canvas access list and checks the caller's level; `denied` is the response to send when it's too low.
async function gate(c: Context<Env>, need: Level) {
  const id = c.req.param('id')!, email = c.get('email');
  const access = await store.readAccess(id);
  const level = levelOf(access, email);
  let denied: Response | null = null;
  if (!atLeast(level, need)) {
    // Canvases pushed before access lists existed have state but no access.json.
    denied = !access && !await store.readState(id) ? c.json({ error: 'Canvas not found' }, 404)
      : !email ? c.json({ error: 'Sign in first' }, 401)
      : c.json({ error: level ? `Your role on this canvas is ${level}` : `${email} has no access to this canvas`, email, role: level }, 403);
  }
  return { id, email, access, level, denied };
}

api.get('/me', async c => {
  const email = c.get('email');
  return c.json({ email, admin: isAdmin(email), canCreate: canCreate(email, await store.readSettings()) });
});

api.get('/canvases', async c => {
  const email = c.get('email');
  const ids = await store.listIds();
  const rows = await Promise.all(ids.map(async id => {
    const access = await store.readAccess(id);
    // Public canvases are open to anyone with the link, but only listed for the people they're shared with.
    const role = levelOf(access && { ...access, public: false }, email);
    const s = role && await store.readState(id);
    return s ? { id: s.id, title: s.title, updatedAt: s.updatedAt, role, owner: access?.owner ?? null,
      boards: Object.keys(s.canvas.boards ?? {}).length, notes: s.canvas.annotations?.length ?? 0 } : null;
  }));
  return c.json(rows.filter(r => !!r).sort((a, b) => b.updatedAt - a.updatedAt));
});

api.get('/canvases/:id', async c => {
  const { id, email, access, level, denied } = await gate(c, 'viewer');
  if (denied) return denied;
  const state = await store.readState(id);
  if (!state) return c.json({ error: 'Canvas not found' }, 404);
  return c.json({ ...state, fileBase: `/f/${id}/${fileKey(id, access?.epoch)}/`, poll: POLL_MS, role: level, email: email || null, public: !!access?.public },
    200, { 'cache-control': 'no-store' });
});

// Pushing is for the owner. The first push of a new id creates the canvas, if the caller may create canvases.
async function gatePush(c: Context<Env>) {
  const g = await gate(c, 'owner');
  if (g.access || await store.readState(g.id)) return g.denied;
  if (!canCreate(g.email, await store.readSettings())) return c.json({ error: `${g.email} can't create canvases; ask an admin to add it to the creators` }, 403);
  await store.writeAccess(g.id, { owner: g.email, epoch: 0, members: [] });
  return null;
}

// CLI push: upload changed files one by one, then commit the manifest.
api.put('/canvases/:id/files/*', async c => {
  const denied = await gatePush(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const path = decodeURIComponent(c.req.path.split('/files/').slice(1).join('/files/'));
  if (!validPath(path)) return c.json({ error: `Bad file path: ${path}` }, 400);
  const body = await c.req.arrayBuffer();
  await serial(id, async () => { await ensureBaseline(id); await store.putFile(id, path, body); });
  return c.body(null, 204);
});

api.post('/canvases/:id/commit', async c => {
  const denied = await gatePush(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const body = await c.req.json<{ canvas: store.Canvas; files: Record<string, string> }>();
  if (!body?.canvas || typeof body.canvas.boards !== 'object' || typeof body.files !== 'object') return c.json({ error: 'canvas and files are required' }, 400);
  if (!Object.keys(body.files).every(validPath)) return c.json({ error: 'Bad file path in manifest' }, 400);
  if (!Object.values(body.files).every(store.validHash)) return c.json({ error: 'Bad file hash in manifest' }, 400);
  const state = await serial(id, async () => {
    await ensureBaseline(id);
    const prev = await store.readState(id);
    await store.deleteFiles(id, Object.keys(prev?.files ?? {}).filter(p => !(p in body.files)));
    const state: store.State = { id, title: body.canvas.title ?? id, updatedAt: Date.now(), files: body.files, canvas: body.canvas };
    await store.writeState(state);
    await record(prev, state, c.get('email'), 'push');
    return state;
  });
  return c.json({ url: new URL(`/c/${id}`, c.req.url).toString(), updatedAt: state.updatedAt });
});

// Viewer: board positions and sticky notes.
api.put('/canvases/:id/layout', async c => {
  const { id, email, denied } = await gate(c, 'editor');
  if (denied) return denied;
  const body = await c.req.json();
  const state = await serial(id, async () => {
    await ensureBaseline(id);
    const state = await store.readState(id);
    if (!state) return null;
    const prev = structuredClone(state);
    applyLayout(state.canvas, body);
    state.updatedAt = Date.now();
    await store.writeState(state);
    await record(prev, state, email, 'edit');
    return state;
  });
  if (!state) return c.json({ error: 'Canvas not found' }, 404);
  return c.json({ updatedAt: state.updatedAt });
});

// History: every push and every edit in the viewer, newest first, for the people who may edit.
api.get('/canvases/:id/history', async c => {
  const { id, denied } = await gate(c, 'editor');
  if (denied) return denied;
  const list = await store.readHistory(id);
  return c.json({ versions: list.reverse() }, 200, { 'cache-control': 'no-store' });
});

api.get('/canvases/:id/history/:v', async c => {
  const { id, denied } = await gate(c, 'editor');
  if (denied) return denied;
  const v = Number(c.req.param('v')), entry = (await store.readHistory(id)).find(x => x.v === v);
  const body = entry && await store.readVersion(id, v);
  if (!entry || !body) return c.json({ error: 'No such version' }, 404);
  return c.json({ ...entry, ...body });
});

// Taking the canvas back to a version is itself a new version, so a restore can be undone too.
// Editors may restore a version with the same files as now (layout and notes); files need the owner.
api.post('/canvases/:id/history/:v/restore', async c => {
  const { id, email, level, denied } = await gate(c, 'editor');
  if (denied) return denied;
  const v = Number(c.req.param('v'));
  const res = await serial(id, async () => {
    const [list, body, prev] = await Promise.all([store.readHistory(id), store.readVersion(id, v), store.readState(id)]);
    const entry = list.find(x => x.v === v);
    if (!entry || !body || !prev) return { error: 'No such version', status: 404 as const };
    if (!atLeast(level, 'owner') && JSON.stringify(body.files) !== JSON.stringify(prev.files)) {
      return { error: 'This version has other board files; only the owner can bring them back', status: 403 as const };
    }
    const files = await store.restoreFiles(id, body.files, prev.files);
    const state: store.State = { id, title: body.title, updatedAt: Date.now(), files, canvas: body.canvas };
    await store.writeState(state);
    await record(prev, state, email, 'restore', { from: v, summary: `Restored version ${v}` });
    return { updatedAt: state.updatedAt };
  });
  return 'error' in res ? c.json({ error: res.error }, res.status) : c.json(res);
});

// Sharing: who else may open the canvas, by email or by domain ("@company.com").
api.get('/canvases/:id/access', async c => {
  const { access, level, denied } = await gate(c, 'viewer');
  if (denied) return denied;
  return c.json({ owner: access?.owner ?? null, members: access?.members ?? [], public: !!access?.public, role: level });
});

api.put('/canvases/:id/access', async c => {
  const { id, email, access, denied } = await gate(c, 'owner');
  if (denied) return denied;
  if (!access && !await store.readState(id)) return c.json({ error: 'Canvas not found' }, 404);
  const body = await c.req.json<{ members?: unknown; public?: unknown }>().catch(() => null);
  const prev = access ?? { owner: email, epoch: 0, members: [] };
  // Either field may be left out to keep it as it is.
  const members = body?.members === undefined ? prev.members : parseMembers(body.members);
  if (!members) return c.json({ error: 'members: [{ email: "a@b.com" or "@b.com", role: "viewer" | "editor" }]' }, 400);
  if (body?.public !== undefined && typeof body.public !== 'boolean') return c.json({ error: 'public: true | false' }, 400);
  const isPublic = typeof body?.public === 'boolean' ? body.public : !!prev.public;
  // Taking someone off (or the public link away) changes the file links, so links they kept stop working.
  const removed = prev.members.some(m => !members.some(n => n.email === m.email)) || (!!prev.public && !isPublic);
  const next: store.Access = { owner: prev.owner, epoch: prev.epoch + (removed ? 1 : 0), members, ...(isPublic ? { public: true } : {}) };
  await store.writeAccess(id, next);
  return c.json({ owner: next.owner, members: next.members, public: isPublic });
});

api.delete('/canvases/:id', async c => {
  const { id, denied } = await gate(c, 'owner');
  if (denied) return denied;
  await store.deleteCanvas(id);
  return c.body(null, 204);
});

// Admins choose who may create canvases.
api.get('/settings', async c => (isAdmin(c.get('email')) ? c.json(await store.readSettings()) : c.json({ error: 'Admins only' }, 403)));
api.put('/settings', async c => {
  if (!isAdmin(c.get('email'))) return c.json({ error: 'Admins only' }, 403);
  const creators = parseCreators((await c.req.json<{ creators?: unknown }>().catch(() => null))?.creators);
  if (!creators) return c.json({ error: 'creators: ["a@b.com", "@b.com"]' }, 400);
  await store.writeSettings({ creators });
  return c.json({ creators });
});

app.route('/api', api);
app.onError((err, c) => { console.error(err); return c.json({ error: 'Server error' }, 500); });

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export default app;
