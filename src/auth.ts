import { createHmac, timingSafeEqual } from 'node:crypto';

// Three secrets, all from the Vercel project env:
//   CANVAS_PASSWORD  typed once per device on the login page
//   CANVAS_TOKEN     used by the CLI (Authorization: Bearer) to push and pull
//   CANVAS_SECRET    signs session cookies and per-canvas file keys
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

const hmac = (data: string) => createHmac('sha256', env('CANVAS_SECRET')).update(data).digest('base64url');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const SESSION_DAYS = 180;

export function newSession() {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${hmac(`session:${exp}`)}`;
}

export function validSession(value: string | undefined) {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  return Number(exp) > Date.now() && !!sig && safeEqual(sig, hmac(`session:${exp}`));
}

export const passwordMatches = (typed: string) => safeEqual(typed, env('CANVAS_PASSWORD'));

export function validToken(header: string | undefined) {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  return !!m && safeEqual(m[1], env('CANVAS_TOKEN'));
}

// Board files are served under /f/<id>/<key>/…: the key is the capability, so boards
// can run sandboxed (no cookies, no access to the API) and still load their assets.
export const fileKey = (id: string) => hmac(`files:${id}`).slice(0, 24);
