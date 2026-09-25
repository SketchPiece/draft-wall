#!/usr/bin/env node
// Canvas CLI. A canvas is a folder of HTML boards plus canvas.json (same format as Claude Desktop canvases).
//   canvas sync   <dir> [--title "…"]    lay out new boards in canvas.json, keep placed ones
//   canvas serve  <dir> [--port 4870]    view locally with live reload
//   canvas push   <dir> [--id <id>]      upload to the hosted canvas, print its URL
//   canvas pull   <dir>                  bring sticky notes and board positions back from the hosted canvas
//   canvas list | canvas rm <id>
//   canvas config --url <https://…> --token <token>
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyLayout, BOARD_CSP, contentType, injectBridge, validId, validPath } from '../src/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(os.homedir(), '.config', 'canvas', 'config.json');
const REMOTE = '.canvas-remote.json';
const DEFAULT_SIZE = [1280, 800];
const GAP_X = 80, GAP_Y = 160;
const MAX_FILE = 4.4 * 1024 * 1024; // Vercel request body limit is 4.5 MB

const die = msg => { console.error(msg); process.exit(1); };
const isBoard = f => /\.html?$/i.test(f) && !/^[_.]/.test(f) && !f.includes('/');
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n');

// ---------- layout ----------
function readMeta(file) {
  const src = fs.readFileSync(file, 'utf8').slice(0, 16384);
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
      w: m.w ?? DEFAULT_SIZE[0], h: m.h ?? DEFAULT_SIZE[1], title: m.title ?? f.replace(/\.html?$/i, ''),
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
    if (p === '/c/local') return send(200, fs.readFileSync(path.join(ROOT, 'web', 'viewer.html')), { 'content-type': 'text/html; charset=utf-8' });
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
function remoteConfig() {
  const c = readJson(CONFIG, {});
  const url = (process.env.CANVAS_URL || c.url || '').replace(/\/$/, ''), token = process.env.CANVAS_TOKEN || c.token;
  if (!url || !token) die(`No hosted canvas configured. Run: canvas config --url https://… --token …`);
  return { url, token };
}

async function call(method, route, body, headers = {}) {
  const { url, token } = remoteConfig();
  const r = await fetch(url + route, { method, body, headers: { authorization: `Bearer ${token}`, ...headers } });
  if (r.status === 404 && method === 'GET') return null;
  if (!r.ok) die(`${method} ${route}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? true : r.json();
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
    const b = nearestBoard(doc, a);
    const where = b ? `${b.on ? 'on' : 'near'} "${b.title}" (${b.f})` : 'on the canvas';
    console.log(`- [${a.id}${a.color ? ', ' + a.color : ''}] ${where}: ${a.text.replace(/\n/g, '\n    ')}`);
  }
}

async function push(dir, idFlag) {
  const root = path.resolve(dir);
  const doc = sync(root);
  const sidecar = readJson(path.join(root, REMOTE), {});
  const id = idFlag || sidecar.id || `${slug(path.basename(root))}-${randomBytes(2).toString('hex')}`;
  if (!validId(id)) die(`Bad canvas id "${id}": lowercase letters, digits and dashes.`);

  // Keep notes the user added on the hosted canvas since the last pull; drop the ones removed here.
  const remote = await call('GET', `/api/canvases/${id}`);
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

  const files = {};
  const uploads = [];
  for (const rel of walk(root)) {
    if (!validPath(rel)) die(`Unsupported file name: ${rel}`);
    const buf = fs.readFileSync(path.join(root, rel));
    if (buf.length > MAX_FILE) die(`${rel} is ${(buf.length / 1048576).toFixed(1)} MB; the limit is 4.4 MB per file.`);
    files[rel] = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    if (remote?.files?.[rel] !== files[rel]) uploads.push([rel, buf]);
  }
  for (const [rel, buf] of uploads) {
    await call('PUT', `/api/canvases/${id}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, buf, { 'content-type': contentType(rel) });
  }
  const res = await call('POST', `/api/canvases/${id}/commit`, JSON.stringify({ canvas: doc, files }), { 'content-type': 'application/json' });
  writeJson(path.join(root, REMOTE), { id, url: res.url, seen: (doc.annotations ?? []).map(a => a.id) });
  console.log(`Pushed ${Object.keys(files).length} files (${uploads.length} changed): ${res.url}`);
}

async function pull(dir) {
  const root = path.resolve(dir);
  const sidecar = readJson(path.join(root, REMOTE), {});
  if (!sidecar.id) die(`${dir} hasn't been pushed yet (no ${REMOTE}).`);
  const remote = await call('GET', `/api/canvases/${sidecar.id}`);
  if (!remote) die(`Canvas ${sidecar.id} is not on the server.`);
  const file = path.join(root, 'canvas.json');
  const doc = readJson(file, { boards: {} });
  for (const [f, b] of Object.entries(remote.canvas.boards ?? {})) if (doc.boards[f]) { doc.boards[f].x = b.x; doc.boards[f].y = b.y; }
  doc.annotations = remote.canvas.annotations ?? [];
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
  case 'list': {
    const items = await call('GET', '/api/canvases');
    for (const c of items ?? []) console.log(`${c.id}\t${c.boards} boards\t${c.notes} notes\t${new Date(c.updatedAt).toISOString().slice(0, 16)}\t${c.title}`);
    break;
  }
  case 'rm': { if (!arg || !validId(arg)) die('Usage: canvas rm <id>'); await call('DELETE', `/api/canvases/${arg}`); console.log(`Deleted ${arg}`); break; }
  case 'config': {
    const c = readJson(CONFIG, {});
    if (str(args.url)) c.url = args.url;
    if (str(args.token)) c.token = args.token;
    fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
    fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
    console.log(`${CONFIG}: url ${c.url ?? '(not set)'}, token ${c.token ? 'set' : '(not set)'}`);
    break;
  }
  default:
    die(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
