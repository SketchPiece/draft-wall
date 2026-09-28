import { isAdmin, normalizeEmail } from './auth.js';
import type { Access, Role, Settings } from './store.js';

export type Level = Role | 'owner';
const RANK: Record<Level, number> = { viewer: 1, editor: 2, owner: 3 };
export const atLeast = (level: Level | null, need: Level) => !!level && RANK[level] >= RANK[need];

// "a@b.com" or a whole domain "@b.com".
export const validMember = (s: string) => /^[^\s@,]*@[^\s@,]+\.[^\s@,]+$/.test(s) && s.length <= 254;
export const validRole = (s: unknown): s is Role => s === 'viewer' || s === 'editor';
const matches = (entry: string, email: string) => entry === email || entry === '@' + email.split('@')[1];

// Admins own every canvas, including ones pushed before access lists existed (no access.json).
// email is '' for someone not signed in, who gets in only when the canvas is public.
export function levelOf(access: Access | null, email: string): Level | null {
  if (email && isAdmin(email)) return 'owner';
  if (!access) return null;
  if (email && access.owner === email) return 'owner';
  let best: Level | null = access.public ? 'viewer' : null;
  if (!email) return best;
  for (const m of access.members) if (matches(m.email, email) && !atLeast(best, m.role)) best = m.role;
  return best;
}

export const canCreate = (email: string, settings: Settings) => isAdmin(email) || settings.creators.some(c => matches(c, email));

export function parseMembers(body: unknown): Access['members'] | null {
  if (!Array.isArray(body) || body.length > 200) return null;
  const out = new Map<string, Role>();
  for (const m of body) {
    const email = typeof m?.email === 'string' ? normalizeEmail(m.email) : '';
    if (!validMember(email) || !validRole(m.role)) return null;
    out.set(email, m.role);
  }
  return [...out].map(([email, role]) => ({ email, role }));
}

export function parseCreators(body: unknown): string[] | null {
  if (!Array.isArray(body) || body.length > 200) return null;
  const out = body.map(c => (typeof c === 'string' ? normalizeEmail(c) : ''));
  return out.every(validMember) ? [...new Set(out)] : null;
}
