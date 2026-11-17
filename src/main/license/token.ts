// Ported from code-maxxer (same author): same key format, token signature and device id as the license server.
/**
 * Token di licenza: base64url(JSON payload) + "." + base64url(firma Ed25519 dei byte ASCII della prima parte).
 * Funzioni pure: nessun accesso a disco o rete.
 */
import crypto from 'node:crypto';

export interface LicensePayload {
  v: 1;
  /** id licenza */
  lid: string;
  /** id chiave */
  kid: string;
  name: string;
  email: string;
  /** sha256 hex del device_id */
  dev: string;
  /** emesso (unix s) */
  iat: number;
  /** scadenza (unix s), null = a vita */
  exp: number | null;
  /** entro quando ricontrollare online (unix s) */
  chk: number;
  plan: string;
}

export type TokenError = 'formato' | 'firma' | 'chiave_pubblica';

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Chiave pubblica da PEM, base64/base64url dei 32 byte grezzi o base64 del DER SPKI. Null se non valida o vuota. */
export function parsePublicKey(raw: string): crypto.KeyObject | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    if (t.includes('BEGIN PUBLIC KEY')) return crypto.createPublicKey(t);
    const bytes = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const der = bytes.length === 32 ? Buffer.concat([SPKI_ED25519_PREFIX, bytes]) : bytes;
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

export const sha256hex = (s: string): string => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function b64urlDecode(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return Buffer.from(s, 'base64url');
}

function validPayload(p: unknown): p is LicensePayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.lid === 'string' &&
    typeof o.dev === 'string' &&
    typeof o.iat === 'number' &&
    typeof o.chk === 'number' &&
    (o.exp === null || typeof o.exp === 'number') &&
    typeof o.name === 'string' &&
    typeof o.email === 'string'
  );
}

/** Verifica firma e forma. Non guarda date né dispositivo: quello lo fa rules.ts. */
export function verifyToken(token: string, key: crypto.KeyObject | null): { ok: true; payload: LicensePayload } | { ok: false; error: TokenError } {
  if (!key) return { ok: false, error: 'chiave_pubblica' };
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 2) return { ok: false, error: 'formato' };
  const [body, sig] = parts;
  const sigBytes = b64urlDecode(sig);
  const bodyBytes = b64urlDecode(body);
  if (!sigBytes || !bodyBytes || sigBytes.length !== 64) return { ok: false, error: 'formato' };
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(body, 'ascii'), key, sigBytes);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: 'firma' };
  let payload: unknown;
  try {
    payload = JSON.parse(bodyBytes.toString('utf8'));
  } catch {
    return { ok: false, error: 'formato' };
  }
  if (!validPayload(payload)) return { ok: false, error: 'formato' };
  return { ok: true, payload: { ...payload, kid: payload.kid ?? '', plan: payload.plan ?? '' } };
}

/** Solo per test e strumenti di verifica: firma un payload con una chiave privata. */
export function signToken(payload: LicensePayload, privateKey: crypto.KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body, 'ascii'), privateKey).toString('base64url');
  return `${body}.${sig}`;
}
