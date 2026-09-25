# Canvas

Design canvases: a folder of HTML boards plus `canvas.json` (the Claude Desktop canvas format), shown on a zoomable board with sticky notes. Runs locally (`bin/canvas.mjs serve`) and on Vercel (this repo, Hono + private Vercel Blob), so canvases open on the phone too.

- `web/viewer.html`: the canvas viewer, shared by both modes. `npm run embed` bundles `web/*.html` into `src/generated/pages.ts` for the Vercel function.
- `src/index.ts`: hosted app: Google sign-in (cookie for the browser, bearer tokens for the CLI), API for push/pull/layout/sharing, board files under capability URLs.
- `src/access.ts`: who may do what. Each canvas has an owner plus members by email or by domain (`@company.com`) with the role `viewer` (looks) or `editor` (moves boards, leaves sticky notes); only the owner pushes and shares. Admins own every canvas and choose who may create canvases.
- `bin/canvas.mjs`: CLI: `sync`, `serve`, `push`, `pull`, `share`, `list`, `rm`, `login`, `accounts`, `project`, `creators`, `config`. `canvas login` can be run for several Google accounts; `canvas project <dir> --account … --share …` sets the account and default sharing per repo.
- Env on Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CANVAS_SECRET`, `CANVAS_ADMINS` (comma-separated emails), plus the Blob store connection. The Google OAuth client needs the redirect URI `<origin>/auth/google/callback`.
- `npm run dev`: the hosted app on http://localhost:4870 with env from `.env.local`. Set `CANVAS_STORE_PREFIX=dev/` there to keep local canvases apart from production; `/dev/login?email=…` signs in as anyone, locally only.

Agents use the CLI through a Claude Code skill that carries a copy of `bin/canvas.mjs`, `src/shared.js` and `web/viewer.html`.
