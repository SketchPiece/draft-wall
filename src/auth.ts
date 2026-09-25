import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Env on Vercel:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   the Google OAuth client ("Sign in with Google")
//   CANVAS_SECRET                            signs session cookies, CLI tokens and per-canvas file keys
//   CANVAS_ADMINS                            comma-separated emails: see every canvas, choose who may create canvases
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

const hmac = (data: string) => createHmac('sha256', env('CANVAS_SECRET')).update(data).digest('base64url');
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString();

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isAdmin = (email: string) =>
  (process.env.CANVAS_ADMINS ?? '').split(',').map(normalizeEmail).filter(Boolean).includes(email);

// Signed values: "<kind>.<base64url payload>.<exp>.<sig>". Sessions live in a cookie, CLI tokens in Authorization: Bearer.
function sign(kind: string, payload: string, days: number) {
  const body = `${kind}.${b64(payload)}.${Date.now() + days * 864e5}`;
  return `${body}.${hmac(body)}`;
}
function verify(kind: string, value: string | undefined) {
  const parts = value?.split('.') ?? [];
  if (parts.length !== 4 || parts[0] !== kind || !(Number(parts[2]) > Date.now())) return null;
  return safeEqual(parts[3], hmac(parts.slice(0, 3).join('.'))) ? unb64(parts[1]) : null;
}

export const SESSION_DAYS = 180;
export const CLI_TOKEN_DAYS = 365;
export const newSession = (email: string) => sign('s', email, SESSION_DAYS);
export const sessionEmail = (cookie: string | undefined) => verify('s', cookie);
export const newCliToken = (email: string) => sign('t', email, CLI_TOKEN_DAYS);
export const tokenEmail = (header: string | undefined) => verify('t', header?.match(/^Bearer\s+(\S+)$/i)?.[1]);

// Short-lived state of one Google sign-in, kept in a cookie between /auth/google and the callback.
export type Flow = { state: string; verifier: string; next: string };
export const newFlow = (next: string): Flow => ({ state: randomBytes(16).toString('base64url'), verifier: randomBytes(32).toString('base64url'), next });
export const sealFlow = (flow: Flow) => sign('f', JSON.stringify(flow), 1 / 144);
export function openFlow(cookie: string | undefined): Flow | null {
  try { return JSON.parse(verify('f', cookie) ?? 'null'); } catch { return null; }
}

export function googleAuthUrl(flow: Flow, redirectUri: string) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri, response_type: 'code', scope: 'openid email',
    state: flow.state, code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 'S256',
    prompt: 'select_account',
  });
}

// The ID token comes straight from Google's token endpoint over TLS, so its claims can be read without checking the signature.
export async function googleEmail(code: string, flow: Flow, redirectUri: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, code_verifier: flow.verifier, redirect_uri: redirectUri, grant_type: 'authorization_code',
      client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
    }),
  });
  if (!r.ok) throw new Error(`Google token exchange: ${r.status} ${await r.text()}`);
  const { id_token } = await r.json() as { id_token?: string };
  const claims = JSON.parse(unb64(id_token?.split('.')[1] ?? '')) as { email?: string; email_verified?: boolean; aud?: string };
  if (claims.aud !== env('GOOGLE_CLIENT_ID') || !claims.email || !claims.email_verified) return null;
  return normalizeEmail(claims.email);
}

// Board files are served under /f/<id>/<key>/…: the key is the capability, so boards can run sandboxed
// (no cookies, no access to the API) and still load their assets. Removing someone from a canvas bumps
// its epoch, so file links they kept stop working.
export const fileKey = (id: string, epoch = 0) => hmac(`files:${id}:${epoch}`).slice(0, 24);
