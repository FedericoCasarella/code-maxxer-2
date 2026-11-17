/**
 * Chiave di licenza: CMX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX, base32 di Crockford.
 * 24 caratteri casuali + 1 di controllo: ALFABETO[sha256(24 caratteri)[0] & 31].
 */
import crypto from 'node:crypto';

export const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Normalizza come il server: maiuscole, via spazi/trattini/prefisso, O→0, I/L→1. Null se non ha la forma giusta. */
export function normalizeKey(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.startsWith('CMX')) s = s.slice(3);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 25 || [...s].some((c) => !ALFABETO.includes(c))) return null;
  const atteso = ALFABETO[crypto.createHash('sha256').update(s.slice(0, 24), 'ascii').digest()[0] & 31];
  if (s[24] !== atteso) return null;
  return `CMX-${s.match(/.{5}/g)!.join('-')}`;
}
