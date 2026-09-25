# Canvas

Design canvases: a folder of HTML boards plus `canvas.json` (the Claude Desktop canvas format), shown on a zoomable board with sticky notes. Runs locally (`bin/canvas.mjs serve`) and on Vercel (this repo, Hono + private Vercel Blob), so canvases open on the phone too.

- `web/viewer.html`: the canvas viewer, shared by both modes. `npm run embed` bundles `web/*.html` into `src/generated/pages.ts` for the Vercel function.
- `src/index.ts`: hosted app: password login (cookie), API for push/pull/layout, board files under capability URLs.
- `bin/canvas.mjs`: CLI: `sync`, `serve`, `push`, `pull`, `list`, `rm`, `config`.
- Env on Vercel: `CANVAS_PASSWORD`, `CANVAS_TOKEN`, `CANVAS_SECRET`, plus the Blob store connection.

Agents use the CLI through a Claude Code skill that carries a copy of `bin/canvas.mjs`, `src/shared.js` and `web/viewer.html`.
