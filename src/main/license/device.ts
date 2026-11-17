/**
 * Identità di questo Mac per la licenza.
 * device_id = sha256(sale dell'app + IOPlatformUUID): stabile, non rivela l'UUID vero e cambia solo cambiando Mac.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

const APP_SALT = 'code-maxxer/licenza/v1/7c1f3e0a9b';

const sh = (cmd: string, args: string[]): string => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch {
    return '';
  }
};

function platformUuid(): string {
  if (process.platform === 'darwin') {
    const m = sh('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = fs.readFileSync(f, 'utf8').trim();
      if (id) return id;
    } catch {
      /* assente */
    }
  }
  // ultima risorsa: nome host + MAC delle interfacce di rete
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .map((n) => n?.mac)
    .filter((m): m is string => !!m && m !== '00:00:00:00:00:00')
    .sort();
  return `${os.hostname()}|${macs.join(',')}`;
}

let cached: { id: string; name: string; os: string } | null = null;

export function deviceInfo(): { id: string; name: string; os: string } {
  if (cached) return cached;
  const id = crypto.createHash('sha256').update(`${APP_SALT}:${platformUuid()}`, 'utf8').digest('hex');
  const name = (process.platform === 'darwin' && sh('/usr/sbin/scutil', ['--get', 'ComputerName'])) || os.hostname();
  const ver = process.platform === 'darwin' ? sh('/usr/bin/sw_vers', ['-productVersion']) : os.release();
  const osName = process.platform === 'darwin' ? `macOS ${ver}` : `${os.type()} ${ver}`;
  cached = { id, name, os: osName };
  return cached;
}
