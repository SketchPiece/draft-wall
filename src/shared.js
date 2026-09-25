// Shared by the Vercel app (src/index.ts) and the local CLI (bin/canvas.mjs).

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

/** @param {string} path */
export const contentType = path => MIME[path.slice(path.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';

/** @param {string} id */
export const validId = id => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);

/** Relative file path inside a canvas: no dot-segments, no hidden files. @param {string} path */
export const validPath = path =>
  path.length > 0 && path.length <= 200 && path.split('/').every(s => /^[\w\-. ()@+]+$/.test(s) && !s.startsWith('.'));

// Boards run sandboxed; this lets Esc inside a board close the full-size view.
const BRIDGE = `<script>addEventListener('keydown',e=>{if(e.key==='Escape')parent.postMessage('canvas:escape','*')})</script>`;

/** @param {string} html */
export const injectBridge = html => /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, BRIDGE + '</body>') : html + BRIDGE;

// Applied to board files opened directly (new tab); the viewer also sandboxes its iframes.
export const BOARD_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals';

const ANNOTATION_KEYS = new Set(['id', 'x', 'y', 'w', 'text', 'page', 'kind', 'size', 'bold', 'italic', 'color']);

/**
 * What the viewer may change: board positions and sticky notes. Everything else stays as pushed.
 * @param {any} canvas @param {any} body
 */
export function applyLayout(canvas, body) {
  for (const [f, pos] of Object.entries(body?.boards ?? {})) {
    const b = canvas.boards?.[f];
    if (b && Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) { b.x = Math.round(pos.x); b.y = Math.round(pos.y); }
  }
  if (Array.isArray(body?.annotations)) {
    const seen = new Set();
    canvas.annotations = body.annotations
      .filter(a => a && typeof a.id === 'string' && /^[\w-]{1,40}$/.test(a.id) && !seen.has(a.id) && seen.add(a.id)
        && Number.isFinite(a.x) && Number.isFinite(a.y) && typeof a.text === 'string')
      .slice(0, 200)
      .map(a => Object.fromEntries(Object.entries(a).filter(([k]) => ANNOTATION_KEYS.has(k))))
      .map(a => ({ ...a, w: Number.isFinite(a.w) ? a.w : 320, text: a.text.slice(0, 5000) }));
  }
  return canvas;
}
