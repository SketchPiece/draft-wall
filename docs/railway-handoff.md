# Draftwall: finishing the move from Vercel to Railway

Draftwall (the hosted canvas) moved from Vercel to Railway on 2026-09-26 because the Vercel Hobby limits ran out and the Vercel Blob store is now blocked (`403 Your store is blocked`).

- New address: **https://draftwall.up.railway.app** (the old one, https://draftwall.vercel.app, stops working once Vercel is turned off).
- Repo: `/Users/you/Documents/Hacking/draft-wall` (the changes are not committed yet, see step 5).
- Railway: project `draftwall`, service `web`, volume `web-volume` mounted at `/data`. The repo folder is already linked, so `railway` commands run from it work without extra flags.
- Canvases are stored as files on the volume (`src/store.ts`); there is no Vercel Blob anymore.
- Env on Railway: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CANVAS_SECRET`, `CANVAS_ADMINS`, `CANVAS_DATA_DIR=/data`. `CANVAS_SECRET` is the same as on Vercel, so existing CLI tokens keep working.

Already checked: CLI push, board file serving, data surviving a redeploy.

## What's left

### Execution status (2026-09-26)

- Added and saved the Railway callback in Google Cloud's `Draftwall Web` OAuth client. Google now accepts the redirect URI and reaches account selection. The final callback was blocked by Chrome with `ERR_BLOCKED_BY_CLIENT`; a complete browser session still needs verification.
- Updated the installed canvas CLI URL and all three skill documents below. `canvas list` succeeds with the existing token; the current list is empty. No `vercel.app` references remain under `~/.claude/skills`.
- `npm run typecheck` and `git diff --check` pass.
- Retried the Blob migration: reads still fail with `403 Forbidden`. The temporary environment file was removed. No old canvases were uploaded and Vercel remains intact.
- Connecting Railway production to GitHub `main` was blocked by automatic approval review pending specific user confirmation. The service still runs its existing uploaded deployment.

### 1. Google sign-in (callback saved; browser verification pending)
In Google Cloud Console → APIs & Services → Credentials → the OAuth client used by draftwall, add the authorized redirect URI:

```
https://draftwall.up.railway.app/auth/google/callback
```

To finish checking it: open https://draftwall.up.railway.app, sign in with Google, and you should get to the canvas list. The earlier `redirect_uri_mismatch` is resolved; Chrome blocked the final callback during the automated check.

### 2. Point the CLI at the new address — done
```
node ~/.claude/skills/canvas/cli/bin/canvas.mjs config --url https://draftwall.up.railway.app
node ~/.claude/skills/canvas/cli/bin/canvas.mjs list
```
(Or `canvas config …` if `canvas` is on PATH.) `list` should answer without an auth error.

### 3. Replace the old URL in the skills — done
Replace `https://draftwall.vercel.app` with `https://draftwall.up.railway.app` in:
- `~/.claude/skills/canvas/SKILL.md` (lines 10 and 28)
- `~/.claude/skills/artifact-design/SKILL.md` (line 10)
- `~/.claude/skills/artifact-design/references/page-contract.md` (line 3)

Then check it with `grep -rn "vercel.app" ~/.claude/skills` — nothing should be left. The skill's `cli/` copies (`bin/canvas.mjs`, `src/shared.js`, `web/viewer.html`) did not change and do not need updating.

### 4. Bring back the old canvases (only once the Blob store is unblocked)
There are 118 files, about 7 MB, in the old Blob store; right now reading them fails with 403. They become readable again when the Vercel billing month resets (or after a temporary switch to Pro). Then, from the repo:

```
vercel env pull /tmp/dw-prod.env --environment=production -y
set -a && . /tmp/dw-prod.env && set +a
CANVAS_STORE_PREFIX= CANVAS_DATA_DIR=data npx tsx scripts/migrate-blob.ts   # copies into ./data, skips dev/
railway volume files upload data/ /       # check first that "/" is the volume root: railway volume files list /
rm /tmp/dw-prod.env
```

Then `canvas list` should show the old canvases. If local canvas folders still exist, `canvas push <dir>` also restores boards, but the sticky notes lived only on the server and come back only through this migration.

### 5. Git and auto-deploys (optional, ask the user first)
Right now the deploy was uploaded with `railway up`, not from GitHub. If the user agrees: commit the changes on a branch, open a PR to `SketchPiece/draft-wall`, and link the `web` service to the repo in Railway (Settings → Source) so every push to `main` deploys.

### 6. Turn off Vercel (only after step 4, ask the user first)
Do not delete the Vercel project or the Blob store before the canvases are migrated — that's the only copy.
