// Production server (Railway): `npm start`. Canvases live under CANVAS_DATA_DIR, a mounted volume.
import { serve } from '@hono/node-server';
import app from './index.js';

// Railway ends TLS at its proxy, so take the scheme from x-forwarded-proto (the Google callback URL is built from it).
const fetch = (req: Request) => {
  const proto = req.headers.get('x-forwarded-proto');
  const url = new URL(req.url);
  if (!proto || url.protocol === `${proto}:`) return app.fetch(req);
  url.protocol = proto;
  return app.fetch(new Request(url, req));
};

const port = Number(process.env.PORT) || 4870;
serve({ fetch, port }, () => console.log(`listening on :${port}`));
