# Canvas

Design canvases: a folder of HTML boards plus `canvas.json` (the Claude Desktop canvas format), shown on a zoomable board with sticky notes. Runs locally (`bin/canvas.mjs serve`) and hosted on Railway (this repo, Hono on Node with canvases on a volume), so canvases open on the phone too.

- Diagram boards: a Mermaid file (`*.mmd`) in a canvas folder is a board of its own. `web/diagram.js` reads it (flowchart, sequence, state, ER), lays it out with ELK (loaded from jsDelivr) and draws it as SVG in the draftwall style, colored by the viewer theme. The text opens beside the canvas; nodes moved by hand are saved in `canvas.json` (`boards[f].nodes`). Sticky notes can be pinned to a board spot or a diagram node (`annotations[].to`).
- `web/viewer.html`: the canvas viewer, shared by both modes. `web/theme.js`: color themes (T3 Code's built-in ones plus our custom ones) and the theme picker, inlined into pages at the `<!--theme-->` marker (and `web/diagram.js` at `<!--diagram-->`). `npm run embed` bundles `web/*.html` into `src/generated/pages.ts` for the hosted app.
- `src/index.ts`: hosted app: Google sign-in (cookie for the browser, bearer tokens for the CLI), API for push/pull/layout/sharing, board files under capability URLs.
- `src/access.ts`: who may do what. Each canvas has an owner plus members by email or by domain (`@company.com`) with the role `viewer` (looks) or `editor` (moves boards, leaves sticky notes); only the owner pushes and shares. Admins own every canvas and choose who may create canvases.
- `bin/canvas.mjs`: CLI: `sync`, `serve`, `push`, `pull`, `share`, `list`, `rm`, `login`, `accounts`, `project`, `creators`, `config`. `canvas login` can be run for several Google accounts; `canvas project <dir> --account … --share …` sets the account and default sharing per repo.
- `src/server.ts`: the production server (`npm start`). Deploy with `railway up`.
- Env on Railway: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CANVAS_SECRET`, `CANVAS_ADMINS` (comma-separated emails), `CANVAS_DATA_DIR=/data` (the volume mount). The Google OAuth client needs the redirect URI `<origin>/auth/google/callback`.
- `scripts/migrate-blob.ts`: one-off copy of canvases from the old Vercel Blob store into `CANVAS_DATA_DIR`.
- `npm run dev`: the hosted app on http://localhost:4870 with env from `.env.local`. Canvases go to `./data` (or `CANVAS_DATA_DIR`); `/dev/login?email=…` signs in as anyone, locally only.

Agents use the CLI through a Claude Code skill that carries a copy of `bin/canvas.mjs`, `src/shared.js` and `web/viewer.html`.
