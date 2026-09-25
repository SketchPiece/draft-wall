// Local server for the hosted app: `npm run dev` (env from .env.local, e.g. `vercel env pull .env.local`).
// Set CANVAS_STORE_PREFIX=dev/ there so local canvases stay apart from production ones in the Blob store.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { newSession } from '../src/auth.js';
import app from '../src/index.js';

// Local only: /dev/login?email=a@b.com signs in as anyone, to try roles without Google.
const dev = new Hono();
dev.get('/dev/login', c => {
  setCookie(c, 'canvas_session', newSession(c.req.query('email') ?? ''), { httpOnly: true, path: '/' });
  return c.redirect(c.req.query('next') ?? '/');
});
dev.route('/', app);

const port = Number(process.env.PORT) || 4870;
serve({ fetch: dev.fetch, port }, () => console.log(`http://localhost:${port}`));
