#!/usr/bin/env node
// Canvas CLI. A canvas is a folder of HTML boards plus canvas.json (same format as Claude Desktop canvases).
// Mermaid files (*.mmd) are diagram boards: the viewer draws them in the draftwall diagram style.
//   canvas sync   <dir> [--title "…"]    lay out new boards in canvas.json, keep placed ones
//   canvas serve  <dir> [--port 4870]    view locally with live reload
//   canvas push   <dir> [--id <id>]      upload to the hosted canvas, print its URL
//   canvas pull   <dir>                  bring sticky notes, headings and board positions back from the hosted canvas
//   canvas thumbs <id>                   make board previews for a canvas already on the server (push makes them too)
//   canvas share  <dir|id> [add <email|@domain> [--role viewer|editor] | rm <email|@domain> | public on|off]
//   canvas list | canvas rm <id>
//   canvas login | logout <email> | accounts [--default <email>]   Google accounts the CLI acts as
//   canvas project [<dir>] [--account <email>] [--share "a@b.com:editor,@company.com"|none]
//   canvas creators [add|rm <email|@domain>]                     (admins) who may create canvases
//   canvas config --url <https://…>      hosted canvas; --as <email> picks the account for one command
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyLayout, BOARD_CSP, contentType, injectBridge, inlineScripts, isDiagram, validId, validPath } from '../src/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(os.homedir(), '.config', 'canvas', 'config.json');
const REMOTE = '.canvas-remote.json';
const DEFAULT_SIZE = [1280, 800];
const GAP_X = 80, GAP_Y = 160;
const MAX_FILE = 4.4 * 1024 * 1024; // Vercel request body limit is 4.5 MB

const die = msg => { console.error(msg); process.exit(1); };
const isBoard = f => /\.(html?|mmd)$/i.test(f) && !/^[_.]/.test(f) && !f.includes('/');
const baseName = f => f.replace(/\.(html?|mmd)$/i, '');
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n');

// ---------- layout ----------
function readMeta(file) {
  const src = fs.readFileSync(file, 'utf8').slice(0, 16384);
  if (isDiagram(file)) {
    // Mermaid front matter: title, and draftwall's own board size ("board: 1600x900").
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)?.[1] ?? '';
    const title = /^\s*title\s*:\s*(.+?)\s*$/m.exec(front)?.[1].replace(/^["']|["']$/g, '');
    const size = /^\s*board\s*:\s*(\d+)\s*[x×]\s*(\d+)\s*$/m.exec(front);
    return { title: title || undefined, w: size ? +size[1] : undefined, h: size ? +size[2] : undefined };
  }
  const title = src.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim();
  const size = src.match(/<meta\s+name=["']board["']\s+content=["']\s*(\d+)\s*[x×]\s*(\d+)\s*["']/i);
  return { title: title ? decode(title) : undefined, w: size ? +size[1] : undefined, h: size ? +size[2] : undefined };
}

function sync(dir, title) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'canvas.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const doc = before ? JSON.parse(before) : {
    v: 3, title: title || path.basename(dir), launch: { view: 'canvas' },
    pages: [], boards: {}, order: [], notes: {}, annotations: [], designSystems: [],
  };
  if (title) doc.title = title;
  doc.boards ??= {}; doc.order ??= []; doc.notes ??= {};

  const files = fs.readdirSync(dir).filter(isBoard).sort();
  const meta = Object.fromEntries(files.map(f => [f, readMeta(path.join(dir, f))]));
  for (const f of Object.keys(doc.boards)) if (!files.includes(f)) delete doc.boards[f];
  doc.order = doc.order.filter(f => doc.boards[f]);
  for (const f of Object.keys(doc.boards)) if (!doc.order.includes(f)) doc.order.push(f);
  for (const [f, b] of Object.entries(doc.boards)) {
    if (meta[f].w) { b.w = meta[f].w; b.h = meta[f].h; }
    if (meta[f].title) b.title = meta[f].title;
  }

  // New boards take the next grid slots; boards already placed keep their positions.
  const fresh = files.filter(f => !doc.boards[f]);
  const all = [...doc.order, ...fresh];
  const cols = all.length <= 4 ? 2 : 3;
  const cellW = Math.max(...all.map(f => doc.boards[f]?.w ?? meta[f].w ?? DEFAULT_SIZE[0]));
  const cellH = Math.max(...all.map(f => doc.boards[f]?.h ?? meta[f].h ?? DEFAULT_SIZE[1]));
  for (const f of fresh) {
    const i = all.indexOf(f), m = meta[f];
    doc.boards[f] = {
      x: (i % cols) * (cellW + GAP_X), y: Math.floor(i / cols) * (cellH + GAP_Y),
      w: m.w ?? DEFAULT_SIZE[0], h: m.h ?? DEFAULT_SIZE[1], title: m.title ?? baseName(f),
    };
    doc.order.push(f);
  }
  if (!before && Object.keys(doc.notes).length === 0) {
    doc.notes.t = { x: 0, y: -240, text: doc.title, kind: 'title1', maxW: Math.max(cellW, Math.min(all.length, cols) * (cellW + GAP_X) - GAP_X) };
  }
  const out = JSON.stringify(doc, null, 1) + '\n';
  if (out !== before) fs.writeFileSync(file, out);
  return doc;
}

// Every file of the canvas except canvas.json and dotfiles, as relative paths.
function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, rel));
    else if (rel !== 'canvas.json') out.push(rel);
  }
  return out;
}

// ---------- local viewer ----------
function serve(dir, port, title) {
  const root = path.resolve(dir);
  sync(root, title);
  fs.watch(root, (_e, name) => { if (name && isBoard(name)) { try { sync(root); } catch { /* mid-save */ } } });

  const state = () => {
    const files = {};
    let updatedAt = fs.statSync(path.join(root, 'canvas.json')).mtimeMs;
    for (const rel of walk(root)) {
      const st = fs.statSync(path.join(root, rel));
      files[rel] = st.mtimeMs.toString(36) + st.size.toString(36);
      updatedAt = Math.max(updatedAt, st.mtimeMs);
    }
    return { id: 'local', updatedAt, files, canvas: readJson(path.join(root, 'canvas.json'), { boards: {} }), fileBase: '/f/local/local/', poll: 1000 };
  };

  const server = http.createServer((req, res) => {
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'cache-control': 'no-store', ...headers }); res.end(body); };
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { return send(400); }
    if (p === '/') return send(302, '', { location: '/c/local' });
    if (p === '/c/local') {
      const web = f => fs.readFileSync(path.join(ROOT, 'web', f), 'utf8');
      return send(200, inlineScripts(web('viewer.html'), { theme: web('theme.js'), diagram: web('diagram.js') }), { 'content-type': 'text/html; charset=utf-8' });
    }
    if (p === '/api/canvases/local' && req.method === 'GET') {
      try { return send(200, JSON.stringify(state()), { 'content-type': 'application/json' }); } catch (e) { return send(500, JSON.stringify({ error: e.message })); }
    }
    if (p === '/api/canvases/local/layout' && req.method === 'PUT') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const file = path.join(root, 'canvas.json');
          writeJson(file, applyLayout(readJson(file, { boards: {} }), JSON.parse(body)));
          send(200, JSON.stringify({ updatedAt: fs.statSync(file).mtimeMs }), { 'content-type': 'application/json' });
        } catch (e) { send(400, JSON.stringify({ error: e.message })); }
      });
      return;
    }
    if (p.startsWith('/f/local/local/')) {
      const rel = p.slice('/f/local/local/'.length);
      if (!validPath(rel)) return send(404);
      const file = path.join(root, rel);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404);
      const type = contentType(rel), body = fs.readFileSync(file);
      return send(200, type.startsWith('text/html') ? injectBridge(body.toString('utf8')) : body, { 'content-type': type, 'content-security-policy': BOARD_CSP });
    }
    send(404);
  });
  const listen = p => {
    server.once('error', e => { if (e.code === 'EADDRINUSE' && p < port + 50) listen(p + 1); else die(e.message); });
    server.listen(p, '127.0.0.1', () => console.log(`Canvas "${readJson(path.join(root, 'canvas.json'), {}).title}": http://127.0.0.1:${p}/c/local`));
  };
  listen(port);
}

// ---------- hosted canvas ----------
// ~/.config/canvas/config.json: { url, accounts: { email: token }, default, projects: { <repo path>: { account, share: [{ email, role }] } } }
const loadConfig = () => readJson(CONFIG, {});
function saveConfig(c) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
}
function serverUrl() {
  const url = (process.env.CANVAS_URL || loadConfig().url || '').replace(/\/$/, '');
  return url || die('No hosted canvas configured. Run: canvas config --url https://…');
}

// A project is the git repo a canvas folder lives in (or the folder itself outside a repo).
function projectRoot(dir) {
  const start = path.resolve(dir);
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return start;
  }
}
const projectOf = dir => loadConfig().projects?.[projectRoot(dir)] ?? {};

// --as, then the account the canvas was pushed with, then the project's, then the default one.
function pickAccount(dir, sidecar = {}) {
  const c = loadConfig(), accounts = Object.keys(c.accounts ?? {});
  if (!accounts.length) die('Not signed in. Run: canvas login');
  const email = str(args.as) || sidecar.account || (dir && projectOf(dir).account) || c.default || (accounts.length === 1 ? accounts[0] : null);
  if (!email) die(`Several accounts (${accounts.join(', ')}); pass --as <email> or set one: canvas project <dir> --account <email>`);
  if (!c.accounts[email]) die(`${email} is not signed in here. Run: canvas login (signed in: ${accounts.join(', ')})`);
  return email;
}

async function call(account, method, route, body, headers = {}) {
  const r = await fetch(serverUrl() + route, { method, body, headers: { authorization: `Bearer ${loadConfig().accounts[account]}`, ...headers } });
  if (r.status === 404 && method === 'GET') return null;
  if (r.status === 401) die(`The sign-in of ${account} has expired. Run: canvas login`);
  if (!r.ok) die(`${method} ${route} as ${account}: ${r.status} ${(await r.json().catch(() => null))?.error ?? r.statusText}`);
  return r.status === 204 ? true : r.json();
}

// Opens Google sign-in in the browser; the server hands the token back to this one-off local listener.
async function login() {
  const url = serverUrl(), state = randomBytes(24).toString('base64url');
  const got = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const q = new URL(req.url, 'http://local').searchParams;
      if (!req.url.startsWith('/callback') || q.get('state') !== state || !q.get('token')) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Canvas CLI</title><body style="font:15px system-ui;padding:40px">The canvas CLI is signed in as <b>${q.get('email').replace(/[<&]/g, '')}</b>. You can close this tab.`);
      server.close(); resolve({ email: q.get('email'), token: q.get('token') });
    });
    server.listen(0, '127.0.0.1', () => {
      const link = `${url}/auth/cli?port=${server.address().port}&state=${state}`;
      console.log(`Opening Google sign-in in the browser. If it doesn't open, go to:\n${link}`);
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      spawn(opener, [link], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    });
    setTimeout(() => { server.close(); reject(new Error('Timed out waiting for the sign-in')); }, 5 * 60_000).unref();
  }).catch(e => die(e.message));
  const c = loadConfig();
  c.accounts = { ...c.accounts, [got.email]: got.token };
  c.default ??= got.email;
  delete c.token; delete c.password; // from the password era
  saveConfig(c);
  console.log(`Signed in as ${got.email}${c.default === got.email ? ' (default)' : ''}.`);
}

// "a@b.com:editor,@company.com" -> [{ email, role }]
function parseShare(spec) {
  if (spec === 'none') return [];
  return spec.split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const [email, role = 'viewer'] = x.split(':');
    if (!/^[^\s@]*@[^\s@]+\.[^\s@]+$/.test(email) || !['viewer', 'editor'].includes(role)) die(`Bad share entry "${x}": use a@b.com or @company.com, optionally :viewer or :editor`);
    return { email: email.toLowerCase(), role };
  });
}
const shareText = members => members.length ? members.map(m => `${m.email} (${m.role})`).join(', ') : 'nobody';

function project(dir) {
  const root = projectRoot(dir), c = loadConfig();
  const p = { ...c.projects?.[root] };
  if (str(args.account)) { if (!c.accounts?.[args.account]) die(`${args.account} is not signed in here. Run: canvas login`); p.account = args.account; }
  if (str(args.share)) p.share = parseShare(args.share);
  if (str(args.account) || str(args.share)) { c.projects = { ...c.projects, [root]: p }; saveConfig(c); }
  console.log(`Project ${root}`);
  console.log(`  account: ${p.account ?? '(not set)'}`);
  console.log(`  share new canvases with: ${p.share ? shareText(p.share) : '(not set)'}`);
  console.log(`  signed-in accounts: ${Object.keys(c.accounts ?? {}).join(', ') || '(none, run canvas login)'}`);
}

async function share(target) {
  const dir = target && fs.existsSync(target) ? target : null;
  const sidecar = dir ? readJson(path.join(dir, REMOTE), {}) : {};
  const id = dir ? sidecar.id : target;
  if (!id || !validId(id)) die(dir ? `${dir} hasn't been pushed yet (no ${REMOTE}).` : 'Usage: canvas share <dir|id> [add|rm <email>]');
  const account = pickAccount(dir, sidecar);
  const cur = await call(account, 'GET', `/api/canvases/${id}/access`);
  if (!cur) die(`Canvas ${id} is not on the server.`);
  const [, , op, who] = args._;
  let members = cur.members, isPublic = !!cur.public;
  if (op === 'public' && (who === 'on' || who === 'off')) {
    isPublic = (await call(account, 'PUT', `/api/canvases/${id}/access`, JSON.stringify({ public: who === 'on' }), { 'content-type': 'application/json' })).public;
  } else if (op === 'add' || op === 'rm') {
    const entry = parseShare(`${who ?? ''}:${str(args.role) ?? 'viewer'}`)[0];
    members = members.filter(m => m.email !== entry.email);
    if (op === 'add') members.push(entry);
    members = (await call(account, 'PUT', `/api/canvases/${id}/access`, JSON.stringify({ members }), { 'content-type': 'application/json' })).members;
  } else if (op) die('Usage: canvas share <dir|id> [add <email|@domain> [--role viewer|editor] | rm <email|@domain> | public on|off]');
  console.log(`${id}: owner ${cur.owner ?? '(admins)'}; shared with ${shareText(members)}${isPublic ? '; anyone with the link can view' : ''}`);
}

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'canvas';

function nearestBoard(doc, a) {
  let best = null, bestD = Infinity;
  for (const [f, b] of Object.entries(doc.boards ?? {})) {
    const dx = Math.max(b.x - a.x, 0, a.x - (b.x + b.w)), dy = Math.max(b.y - a.y, 0, a.y - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = { f, title: b.title || f, on: d === 0 }; }
  }
  return best;
}

function printNotes(doc) {
  const notes = doc.annotations ?? [];
  if (!notes.length) { console.log('No sticky notes.'); return; }
  console.log(`${notes.length} sticky note${notes.length === 1 ? '' : 's'}:`);
  for (const a of notes) {
    const b = nearestBoard(doc, a), pin = a.to && doc.boards?.[a.to.board];
    const where = pin ? (a.to.node != null ? `pinned to node "${a.to.label || a.to.node}" (id ${a.to.node}) in "${pin.title || a.to.board}" (${a.to.board})`
      : `pinned to "${pin.title || a.to.board}" (${a.to.board}) at ${a.to.x},${a.to.y}`)
      : b ? `${b.on ? 'on' : 'near'} "${b.title}" (${b.f})` : 'on the canvas';
    console.log(`- [${a.id}${a.color ? ', ' + a.color : ''}] ${where}: ${a.text.replace(/\n/g, '\n    ')}`);
  }
}

async function push(dir, idFlag) {
  const root = path.resolve(dir);
  const doc = sync(root);
  const sidecar = readJson(path.join(root, REMOTE), {});
  const id = idFlag || sidecar.id || `${slug(path.basename(root))}-${randomBytes(2).toString('hex')}`;
  if (!validId(id)) die(`Bad canvas id "${id}": lowercase letters, digits and dashes.`);
  const account = pickAccount(root, sidecar);

  // Keep notes the user added on the hosted canvas since the last pull; drop the ones removed here.
  const remote = await call(account, 'GET', `/api/canvases/${id}`);
  const seen = new Set(sidecar.seen ?? []);
  const local = doc.annotations ?? [];
  const localIds = new Set(local.map(a => a.id));
  const added = (remote?.canvas.annotations ?? []).filter(a => !localIds.has(a.id) && !seen.has(a.id));
  if (added.length) {
    doc.annotations = [...local, ...added];
    writeJson(path.join(root, 'canvas.json'), doc);
    console.log(`Kept ${added.length} new note${added.length === 1 ? '' : 's'} from the hosted canvas (now in canvas.json):`);
    printNotes({ ...doc, annotations: added });
  }

  // Hand-placed diagram nodes are kept like board positions: the hosted canvas has the latest ones.
  for (const [f, b] of Object.entries(doc.boards ?? {})) {
    const nodes = remote?.canvas.boards?.[f]?.nodes;
    if (isDiagram(f) && nodes) b.nodes = { ...nodes, ...b.nodes };
  }
  await checkDiagrams(root, doc);

  const files = {};
  const uploads = [];
  for (const rel of walk(root)) {
    if (!validPath(rel)) die(`Unsupported file name: ${rel}`);
    const buf = fs.readFileSync(path.join(root, rel));
    if (buf.length > MAX_FILE) die(`${rel} is ${(buf.length / 1048576).toFixed(1)} MB; the limit is 4.4 MB per file.`);
    files[rel] = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    if (remote?.files?.[rel] !== files[rel]) uploads.push([rel, buf]);
  }
  uploads.push(...await addThumbs(root, doc, files, remote?.files));
  for (const [rel, buf] of uploads) {
    await call(account, 'PUT', `/api/canvases/${id}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, buf, { 'content-type': contentType(rel) });
  }
  const res = await call(account, 'POST', `/api/canvases/${id}/commit`, JSON.stringify({ canvas: doc, files }), { 'content-type': 'application/json' });
  writeJson(path.join(root, REMOTE), { id, url: res.url, account, seen: (doc.annotations ?? []).map(a => a.id) });
  console.log(`Pushed ${Object.keys(files).length} files (${uploads.length} changed) as ${account}: ${res.url}`);
  // A new canvas gets the project's default sharing.
  const members = !remote && projectOf(root).share;
  if (members?.length) {
    await call(account, 'PUT', `/api/canvases/${id}/access`, JSON.stringify({ members }), { 'content-type': 'application/json' });
    console.log(`Shared with ${shareText(members)}`);
  }
}

// ---------- board previews ----------
// The viewer shows these pictures instead of live pages when zoomed out: a phone can't keep dozens of pages alive.
// They're taken with the local Chrome and uploaded as _thumbs/<board>.png; without Chrome the canvas works as before.
const THUMBS = path.join(os.homedir(), '.cache', 'canvas', 'thumbs');
const thumbPath = f => `_thumbs/${f}.png`;
function findChrome() {
  const list = [process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return list.find(p => p && fs.existsSync(p));
}
function screenshot(chrome, file, w, h, out) {
  return new Promise(resolve => {
    const args = ['--headless=new', '--hide-scrollbars', '--mute-audio', `--window-size=${w},${h}`, '--force-device-scale-factor=1',
      '--virtual-time-budget=4000', `--screenshot=${out}`, 'file://' + file];
    execFile(chrome, args, { timeout: 30_000 }, () => resolve(fs.existsSync(out)));
  });
}

// Adds a preview of every HTML board to the manifest; returns the ones the server doesn't have yet, taking missing ones.
async function addThumbs(root, doc, files, remoteFiles = {}) {
  const boards = Object.keys(doc.boards ?? {}).filter(f => !isDiagram(f) && files[f]);
  if (!boards.length) return [];
  // A board can use any other file in the folder (shared CSS, images), so all of them go into its key.
  const assets = createHash('sha256').update(Object.entries(files).filter(([p]) => !doc.boards[p]).sort().join()).digest('hex');
  const todo = [];
  for (const f of boards) {
    const b = doc.boards[f], key = createHash('sha256').update(`${files[f]}:${assets}:${b.w}x${b.h}`).digest('hex').slice(0, 16);
    const cached = path.join(THUMBS, key + '.png');
    if (remoteFiles[thumbPath(f)] === key || fs.existsSync(cached)) files[thumbPath(f)] = key;
    else todo.push({ f, b, key, cached });
  }
  const chrome = todo.length && findChrome();
  if (todo.length && !chrome) console.warn('No Chrome found (set CHROME=<path>): boards go without previews, which is heavy on phones.');
  if (chrome) {
    fs.mkdirSync(THUMBS, { recursive: true });
    console.log(`Taking ${todo.length} board preview${todo.length === 1 ? '' : 's'}…`);
    const queue = [...todo];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let t; (t = queue.shift());) {
        const tmp = `${t.cached}.${process.pid}.png`;
        // A second try: with several Chromes at once one sometimes runs out of time.
        const ok = await screenshot(chrome, path.join(root, t.f), t.b.w, t.b.h, tmp) || await screenshot(chrome, path.join(root, t.f), t.b.w, t.b.h, tmp);
        if (ok) { fs.renameSync(tmp, t.cached); files[thumbPath(t.f)] = t.key; }
        else console.warn(`No preview for ${t.f}`);
      }
    }));
  }
  return boards.filter(f => files[thumbPath(f)] && remoteFiles[thumbPath(f)] !== files[thumbPath(f)])
    .map(f => [thumbPath(f), fs.readFileSync(path.join(THUMBS, files[thumbPath(f)] + '.png'))]);
}

// Previews for a canvas already on the server: its files are fetched into a temp folder and the canvas itself stays as it is.
async function thumbsFor(id) {
  if (!id || !validId(id)) die('Usage: canvas thumbs <id>');
  const account = pickAccount(null);
  const remote = await call(account, 'GET', `/api/canvases/${id}`);
  if (!remote) die(`Canvas ${id} is not on the server.`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-thumbs-'));
  try {
    const files = Object.fromEntries(Object.entries(remote.files).filter(([p]) => !p.startsWith('_thumbs/')));
    for (const rel of Object.keys(files)) {
      const r = await fetch(serverUrl() + remote.fileBase + rel.split('/').map(encodeURIComponent).join('/'));
      if (!r.ok) die(`Couldn't fetch ${rel}: ${r.status}`);
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), Buffer.from(await r.arrayBuffer()));
    }
    const uploads = await addThumbs(root, remote.canvas, files, remote.files);
    for (const [rel, buf] of uploads) {
      await call(account, 'PUT', `/api/canvases/${id}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, buf, { 'content-type': 'image/png' });
    }
    // The latest canvas, so notes or moves made meanwhile aren't undone.
    const now = await call(account, 'GET', `/api/canvases/${id}`);
    await call(account, 'POST', `/api/canvases/${id}/commit`, JSON.stringify({ canvas: now.canvas, files: { ...now.files, ...files } }), { 'content-type': 'application/json' });
    console.log(`${id}: ${uploads.length} preview${uploads.length === 1 ? '' : 's'} uploaded`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// Reads every diagram board the way the viewer will and reports what it can't draw.
async function checkDiagrams(root, doc) {
  const list = Object.keys(doc.boards ?? {}).filter(isDiagram);
  if (!list.length) return;
  await import('../web/diagram.js');
  for (const f of list) {
    const d = globalThis.draftwallDiagram.parse(fs.readFileSync(path.join(root, f), 'utf8'));
    for (const e of d.errors) console.warn(`${f}:${e.line}: ${e.msg}`);
  }
}

async function pull(dir) {
  const root = path.resolve(dir);
  const sidecar = readJson(path.join(root, REMOTE), {});
  if (!sidecar.id) die(`${dir} hasn't been pushed yet (no ${REMOTE}).`);
  const remote = await call(pickAccount(root, sidecar), 'GET', `/api/canvases/${sidecar.id}`);
  if (!remote) die(`Canvas ${sidecar.id} is not on the server.`);
  const file = path.join(root, 'canvas.json');
  const doc = readJson(file, { boards: {} });
  for (const [f, b] of Object.entries(remote.canvas.boards ?? {})) {
    const local = doc.boards[f];
    if (!local) continue;
    local.x = b.x; local.y = b.y;
    if (b.nodes) local.nodes = b.nodes; else delete local.nodes;
  }
  doc.annotations = remote.canvas.annotations ?? [];
  if (remote.canvas.notes) doc.notes = remote.canvas.notes;
  writeJson(file, doc);
  writeJson(path.join(root, REMOTE), { ...sidecar, seen: doc.annotations.map(a => a.id) });
  printNotes(doc);
}

// ---------- main ----------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const [cmd, arg] = args._;
const str = v => (typeof v === 'string' ? v : undefined);
const needDir = () => arg || die(`Usage: canvas ${cmd} <dir>`);

switch (cmd) {
  case 'sync': { const d = sync(path.resolve(needDir()), str(args.title)); console.log(`canvas.json: ${d.order.length} boards`); break; }
  case 'serve': serve(needDir(), Number(args.port) || 4870, str(args.title)); break;
  case 'push': await push(needDir(), str(args.id)); break;
  case 'pull': await pull(needDir()); break;
  case 'thumbs': await thumbsFor(arg); break;
  case 'share': await share(arg); break;
  case 'list': {
    const account = pickAccount(null);
    const items = await call(account, 'GET', '/api/canvases');
    for (const c of items ?? []) console.log(`${c.id}\t${c.role}\t${c.boards} boards\t${c.notes} notes\t${new Date(c.updatedAt).toISOString().slice(0, 16)}\t${c.title}`);
    break;
  }
  case 'rm': { if (!arg || !validId(arg)) die('Usage: canvas rm <id>'); await call(pickAccount(null), 'DELETE', `/api/canvases/${arg}`); console.log(`Deleted ${arg}`); break; }
  case 'login': await login(); break;
  case 'logout': {
    const c = loadConfig();
    if (!arg || !c.accounts?.[arg]) die(`Usage: canvas logout <email> (signed in: ${Object.keys(c.accounts ?? {}).join(', ') || 'none'})`);
    delete c.accounts[arg];
    if (c.default === arg) c.default = Object.keys(c.accounts)[0];
    saveConfig(c); console.log(`Signed out ${arg}`);
    break;
  }
  case 'accounts': {
    const c = loadConfig();
    if (str(args.default)) { if (!c.accounts?.[args.default]) die(`${args.default} is not signed in here.`); c.default = args.default; saveConfig(c); }
    const accounts = Object.keys(c.accounts ?? {});
    if (!accounts.length) console.log('No accounts. Run: canvas login');
    for (const a of accounts) console.log(`${a}${a === c.default ? '\t(default)' : ''}`);
    break;
  }
  case 'project': project(arg ?? '.'); break;
  case 'creators': {
    const account = pickAccount(null);
    let { creators } = await call(account, 'GET', '/api/settings');
    const [, op, who] = args._;
    if (op === 'add' || op === 'rm') {
      const entry = (who ?? '').toLowerCase();
      creators = creators.filter(x => x !== entry);
      if (op === 'add') creators.push(entry);
      ({ creators } = await call(account, 'PUT', '/api/settings', JSON.stringify({ creators }), { 'content-type': 'application/json' }));
    } else if (op) die('Usage: canvas creators [add|rm <email|@domain>]');
    console.log(`Admins and these may create canvases: ${creators.join(', ') || '(nobody else)'}`);
    break;
  }
  case 'config': {
    const c = loadConfig();
    if (str(args.url)) { c.url = args.url; saveConfig(c); }
    console.log(`${CONFIG}: url ${c.url ?? '(not set)'}, accounts: ${Object.keys(c.accounts ?? {}).join(', ') || 'none'}`);
    break;
  }
  default:
    die(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
