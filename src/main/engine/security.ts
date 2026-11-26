import { languageRule } from './language'
import { createHash, randomUUID } from 'node:crypto'
import { slug } from './git'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { connect as tlsConnect } from 'node:tls'
import { app } from 'electron'
import type { EngineEvent, SendOptions, Workspace } from '@shared/types'
import {
  penalty, type FindingStatus, type SecDashboard, type SecFinding, type SecScan, type SecSchedule, type SecSeverity, type SecTarget, type TargetState
} from '@shared/security'
import { db, pool } from '../db'
import { bin, shellEnv } from './bins'
import { listModels } from './models'
import { isMutating, sshExec, type EnvRow } from '../recon/ssh'
import { claudeText } from '../recon/scan'
import { rstore } from '../recon/store'

/*
 * Cyber Security: three integrity scores (software, production, staging) from 0 to 100.
 *
 * Like code-maxxer, an agent audits with the claude-red pentest skills; unlike it:
 *  - the facts are collected deterministically first (npm audit, committed secrets, HTTP headers and TLS,
 *    a fixed list of read-only server commands over SSH) and handed to the agent, which never gets a shell;
 *  - findings have a fingerprint: a rescan keeps the same rows, and what disappears is resolved by itself;
 *  - the score is computed from the open findings (100 minus a penalty per severity), so it is stable
 *    between scans and rises as soon as you resolve or accept something. The agent's own estimate is kept too.
 */

export const SECURITY_SCHEMA = `
create table if not exists security_scans (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  target text not null, status text not null default 'running', trigger text not null default 'manual',
  summary text not null default '', agent_integrity int, score int, error text, cost_usd double precision,
  started_at timestamptz not null default now(), finished_at timestamptz
);
create index if not exists security_scans_project on security_scans(project_id, target, started_at desc);
create table if not exists security_findings (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  target text not null, fingerprint text not null, severity text not null, category text not null default '',
  title text not null, detail text not null default '', location text not null default '', remediation text not null default '',
  status text not null default 'open', scan_id text, first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(), resolved_at timestamptz,
  unique (project_id, fingerprint)
);
create index if not exists security_findings_project on security_findings(project_id, status);
update security_scans set status='failed', error='Interrupted: the app was closed', finished_at=now() where status='running';
`

type Emit = (e: EngineEvent) => void
let emit: Emit | null = null
let sendFix: ((o: SendOptions) => void) | null = null
let newBranch: ((projectId: string, name: string, branch: string) => Promise<Workspace>) | null = null
export const setSecurityWiring = (e: Emit, send: (o: SendOptions) => void, create: (projectId: string, name: string, branch: string) => Promise<Workspace>) => {
  emit = e
  sendFix = send
  newBranch = create
}
const changed = (projectId: string) => emit?.({ type: 'security', projectId })

const SKILLS = () => join(app.getAppPath(), 'resources', 'security-skills')
const ENV_KIND: Record<'production' | 'staging', string> = { production: 'production', staging: 'staging' }
const scheduleKey = (pid: string) => `security:schedule:${pid}`
const DEFAULT_SCHEDULE: SecSchedule = { enabled: false, days: [1, 2, 3, 4, 5], time: '03:00', targets: ['software', 'production', 'staging'] }

type Raw = { severity: SecSeverity; category: string; title: string; detail: string; location: string; remediation: string }

const SEVS: SecSeverity[] = ['critical', 'high', 'medium', 'low', 'info']
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[0-9a-f]{7,}/g, '#').trim()
const fingerprint = (t: SecTarget, f: Raw) => createHash('sha1').update([t, norm(f.category), norm(f.title), norm(f.location)].join('|')).digest('hex').slice(0, 20)

// ─── software: deterministic facts ───

function sh(cmd: string, args: string[], cwd: string, timeout = 120_000): Promise<{ code: number; out: string }> {
  return new Promise((ok) => {
    execFile(cmd === 'git' ? bin('git') : cmd, args, { cwd, env: shellEnv(), maxBuffer: 32 * 1024 * 1024, timeout }, (e, out) =>
      ok({ code: e ? (typeof (e as any).code === 'number' ? (e as any).code : 1) : 0, out: String(out ?? '') })
    )
  })
}

/** npm audit, twice: what ships (production deps) keeps its severity; what only the dev tooling uses counts as low. */
async function npmAudit(root: string): Promise<Raw[]> {
  if (!existsSync(join(root, 'package-lock.json'))) return []
  const parse = (out: string): Record<string, any> => {
    try {
      return JSON.parse(out).vulnerabilities ?? {}
    } catch {
      return {}
    }
  }
  const all = parse((await sh('npm', ['audit', '--json'], root)).out)
  const prod = parse((await sh('npm', ['audit', '--json', '--omit=dev'], root)).out)
  return Object.values<any>(all)
    .filter((v) => v.isDirect || v.severity === 'critical' || v.severity === 'high')
    .slice(0, 40)
    .map((v) => {
      const via = (v.via ?? []).find((x: any) => typeof x === 'object')
      const through = (v.via ?? []).filter((x: any) => typeof x === 'string')
      const shipped = v.name in prod
      const reported: SecSeverity = v.severity === 'moderate' ? 'medium' : SEVS.includes(v.severity) ? v.severity : 'low'
      return {
        severity: shipped ? reported : 'low',
        category: 'Dependency',
        title: via?.title ? `${v.name}: ${via.title}` : `${v.name} is vulnerable${through.length ? ` through ${through.slice(0, 2).join(', ')}` : ''}`,
        detail:
          `${v.name} ${v.range ?? ''} has a known ${v.severity} vulnerability${via?.url ? ` (${via.url})` : ''}.` +
          (shipped ? ' It ships with the app.' : ' Only the development tooling uses it, so it does not reach your users.'),
        location: 'package.json',
        remediation: v.fixAvailable ? (typeof v.fixAvailable === 'object' ? `Upgrade ${v.fixAvailable.name} to ${v.fixAvailable.version}` : 'Run npm audit fix') : 'No fix published yet: replace or isolate the package'
      }
    })
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe live key', /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/]
]

async function committedSecrets(root: string): Promise<Raw[]> {
  const r = await sh('git', ['ls-files'], root)
  if (r.code !== 0) return []
  const out: Raw[] = []
  for (const f of r.out.split('\n').filter(Boolean).slice(0, 20_000)) {
    if (/(^|\/)\.env(\.(local|production|prod|staging))?$/.test(f)) {
      out.push({ severity: 'high', category: 'Secrets', title: `Environment file committed: ${f}`, detail: `${f} is tracked by git, so every clone and every push carries its values.`, location: f, remediation: `git rm --cached ${f}, add it to .gitignore and rotate the values it held.` })
      continue
    }
    if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|lock|min\.js|map)$/i.test(f) || /node_modules\//.test(f)) continue
    const p = join(root, f)
    try {
      if (statSync(p).size > 512 * 1024) continue
      const text = readFileSync(p, 'utf8')
      for (const [name, re] of SECRET_PATTERNS) {
        const m = re.exec(text)
        if (!m) continue
        const line = text.slice(0, m.index).split('\n').length
        out.push({ severity: 'critical', category: 'Secrets', title: `${name} in the code`, detail: `A value that looks like a ${name} is committed in ${f}.`, location: `${f}:${line}`, remediation: 'Remove it from the code (read it from the environment), rotate the key, and purge it from the git history.' })
        break
      }
    } catch { /* unreadable */ }
    if (out.length > 30) break
  }
  return out
}

// ─── servers: deterministic facts ───

const SEC_SURVEY: [string, string][] = [
  ['System', 'uname -a; cat /etc/os-release 2>/dev/null | head -3'],
  ['Listening ports', 'ss -tulpn 2>/dev/null | head -60 || netstat -tulpn 2>/dev/null | head -60'],
  ['SSH daemon', 'sshd -T 2>/dev/null | grep -Ei "^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|permitemptypasswords|x11forwarding|maxauthtries|allowusers|allowgroups) " || grep -Ei "^(Port|PermitRootLogin|PasswordAuthentication|PermitEmptyPasswords|X11Forwarding|MaxAuthTries)" /etc/ssh/sshd_config 2>/dev/null'],
  ['Firewall', 'ufw status verbose 2>/dev/null | head -40; iptables -S 2>/dev/null | head -40; nft list ruleset 2>/dev/null | head -40'],
  ['Fail2ban', 'fail2ban-client status 2>/dev/null | head -10'],
  ['Pending updates', 'apt list --upgradable 2>/dev/null | head -60; (command -v yum >/dev/null && yum -q check-update 2>/dev/null | head -60)'],
  ['Users with a shell', 'awk -F: \'$7 ~ /(ba|z|)sh$/ {print $1":"$3":"$7}\' /etc/passwd; getent group sudo wheel admin 2>/dev/null'],
  ['Failed logins', '(journalctl -u ssh -u sshd -n 400 --no-pager 2>/dev/null || tail -n 400 /var/log/auth.log 2>/dev/null) | grep -Ei "failed|invalid user" | tail -30'],
  ['Web server', 'nginx -T 2>/dev/null | grep -Ei "server_tokens|ssl_protocols|ssl_ciphers|add_header|autoindex|listen" | head -50; apache2ctl -M 2>/dev/null | head -30'],
  ['Containers', 'docker ps --format "{{.Names}}\\t{{.Image}}\\t{{.Ports}}" 2>/dev/null | head -30; for c in $(docker ps -q 2>/dev/null | head -20); do docker inspect --format "{{.Name}} privileged={{.HostConfig.Privileged}} user={{.Config.User}}" $c; done 2>/dev/null'],
  ['Exposed files in the app folder', 'cd "$WD" 2>/dev/null && find . -maxdepth 4 \\( -name ".env*" -o -name "*.sql" -o -name "*.sql.gz" -o -name "*.bak" -o -name ".git" -o -name "*.pem" -o -name "id_rsa*" \\) -not -path "*/node_modules/*" 2>/dev/null | head -40'],
  ['Permissions', 'cd "$WD" 2>/dev/null && ls -la | head -40; stat -c "%a %U %n" .env* 2>/dev/null; find . -xdev -type f -perm -0002 -not -path "*/node_modules/*" 2>/dev/null | head -20'],
  ['Recently changed files', 'cd "$WD" 2>/dev/null && find . -type f -mmin -1440 -not -path "*/node_modules/*" -not -path "./.git/*" 2>/dev/null | head -40'],
  ['Webshell patterns', 'cd "$WD" 2>/dev/null && grep -rlE "eval\\(base64_decode|gzinflate\\(base64_decode|assert\\(\\$_(GET|POST|REQUEST)|system\\(\\$_(GET|POST)" --include=*.php . 2>/dev/null | head -20'],
  ['Versions', 'nginx -v 2>&1; openssl version 2>/dev/null; node -v 2>/dev/null; php -v 2>/dev/null | head -1; docker -v 2>/dev/null']
]

/** The same survey for a Windows host, in PowerShell: read-only, and file contents (.env, keys) are never read, only names and rights. */
const WIN_SURVEY: [string, string][] = [
  ['System', '$o=Get-CimInstance Win32_OperatingSystem; "$($o.Caption) $($o.Version) build $($o.BuildNumber)"; "Last boot: $($o.LastBootUpTime)"'],
  ['Listening ports', "Get-NetTCPConnection -State Listen | Sort-Object LocalPort | Select-Object -First 60 LocalAddress,LocalPort,@{n='Process';e={(Get-Process -Id $_.OwningProcess).ProcessName}} | Format-Table -AutoSize | Out-String -Width 200"],
  ['SSH daemon', "Get-Service sshd | Format-List Name,Status,StartType | Out-String; Get-Content \"$env:ProgramData\\ssh\\sshd_config\" | Select-String -Pattern '^\\s*(Port|PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|PermitEmptyPasswords|AllowUsers|AllowGroups|MaxAuthTries)\\b'"],
  ['Firewall', "Get-NetFirewallProfile | Format-Table Name,Enabled,DefaultInboundAction,DefaultOutboundAction -AutoSize | Out-String; Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow | Select-Object -First 40 DisplayName,Profile | Format-Table -AutoSize | Out-String -Width 200"],
  ['Updates and antivirus', 'Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 10 HotFixID,InstalledOn | Format-Table -AutoSize | Out-String; Get-MpComputerStatus | Format-List AntivirusEnabled,RealTimeProtectionEnabled,AntivirusSignatureLastUpdated | Out-String'],
  ['Users and administrators', 'Get-LocalUser | Format-Table Name,Enabled,LastLogon,PasswordRequired -AutoSize | Out-String; Get-LocalGroupMember -SID S-1-5-32-544 | Format-Table Name,PrincipalSource -AutoSize | Out-String'],
  ['Failed logins', "Get-WinEvent -FilterHashtable @{LogName='Security';Id=4625} -MaxEvents 30 | Format-Table TimeCreated,@{n='Account';e={$_.Properties[5].Value}},@{n='From';e={$_.Properties[19].Value}} -AutoSize | Out-String -Width 200"],
  ['Web server', 'Get-Service W3SVC | Format-List Name,Status | Out-String'],
  ['Containers', "docker ps --format '{{.Names}} | {{.Image}} | {{.Ports}}'; docker ps -q | Select-Object -First 20 | ForEach-Object { docker inspect --format '{{.Name}} privileged={{.HostConfig.Privileged}} user={{.Config.User}}' $_ }"],
  ['Exposed files in the app folder', "Get-ChildItem -Path $wd -Recurse -Depth 4 -Force -Include .env*,*.sql,*.sql.gz,*.bak,.git,*.pem,*.key,id_rsa* | Where-Object { $_.FullName -notmatch '\\\\node_modules\\\\' } | Select-Object -First 40 -ExpandProperty FullName"],
  ['Permissions', "Get-ChildItem -Path $wd -Force | Select-Object -First 40 Mode,LastWriteTime,Name | Format-Table -AutoSize | Out-String; Get-ChildItem -Path $wd -Force -Include .env*,*.key -Recurse -Depth 2 | Where-Object { $_.FullName -notmatch '\\\\node_modules\\\\' } | ForEach-Object { $_.FullName; (Get-Acl $_.FullName).Access | Format-Table IdentityReference,FileSystemRights,AccessControlType -AutoSize | Out-String }"],
  ['Recently changed files', "$since=(Get-Date).AddDays(-1); Get-ChildItem -Path $wd -Recurse -File -Force | Where-Object { $_.LastWriteTime -gt $since -and $_.FullName -notmatch '\\\\(node_modules|\\.git)\\\\' } | Select-Object -First 40 -ExpandProperty FullName"],
  ['Webshell patterns', "Get-ChildItem -Path $wd -Recurse -File -Include *.php | Select-String -List -Pattern 'eval\\(base64_decode|gzinflate\\(base64_decode|assert\\(\\$_(GET|POST|REQUEST)|system\\(\\$_(GET|POST)' | Select-Object -First 20 -ExpandProperty Path"],
  ['Versions', 'node -v; docker -v; git --version; $PSVersionTable.PSVersion.ToString()']
]

/** A PowerShell script sent encoded (no quoting through cmd), checked as plain text first so read-only still holds. */
function powershell(script: string): string | null {
  if (isMutating(script)) return null
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
}

/** Whether the host's SSH shell is Windows: no uname, but PowerShell answers. */
const windowsHosts = new Map<string, boolean>()
async function isWindows(env: EnvRow): Promise<boolean> {
  const key = `${env.host}:${env.port}`
  if (!windowsHosts.has(key)) windowsHosts.set(key, await probeWindows(env))
  return windowsHosts.get(key)!
}
async function probeWindows(env: EnvRow): Promise<boolean> {
  const u = await sshExec(env, 'uname -s', { readOnly: true, timeoutMs: 20_000 })
  if (/linux|darwin|bsd|sunos/i.test(u.stdout)) return false
  const p = await sshExec(env, 'powershell -NoProfile -NonInteractive -Command $PSVersionTable.PSVersion.Major', { readOnly: true, timeoutMs: 30_000 })
  return /^\s*\d+\s*$/.test(p.stdout)
}

/** The claude-red skills that fit a server: privilege escalation for its system, container escape when it runs containers, TLS. */
function serverSkills(windows: boolean, facts: string): string {
  const picks = [windows ? 'privesc/offensive-windows-privesc' : 'privesc/offensive-linux-privesc', 'crypto/offensive-tls-attacks']
  if (/privileged=|docker|containerd/i.test(facts.split('## Containers')[1]?.split('\n## ')[0] ?? '')) picks.push('container/offensive-container-escape')
  return picks
    .map((p) => {
      try {
        return `# Skill: ${p}\n${readFileSync(join(SKILLS(), p, 'SKILL.md'), 'utf8')}`
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

/** HTTP security headers and the TLS certificate of the environment's URL, checked from here. */
async function webFacts(url: string | null): Promise<string> {
  if (!url) return 'No health URL configured: headers and TLS not checked.'
  const lines: string[] = []
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    lines.push(`GET ${url} → ${r.status}`)
    for (const h of ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'server', 'x-powered-by'])
      lines.push(`${h}: ${r.headers.get(h) ?? '(missing)'}`)
  } catch (e: any) {
    lines.push(`GET ${url} failed: ${e.message}`)
  }
  const u = new URL(url)
  if (u.protocol === 'https:') {
    const cert = await new Promise<string>((ok) => {
      const s = tlsConnect({ host: u.hostname, port: Number(u.port || 443), servername: u.hostname, rejectUnauthorized: false, timeout: 8000 }, () => {
        const c = s.getPeerCertificate()
        const days = Math.round((new Date(c.valid_to).getTime() - Date.now()) / 86_400_000)
        ok(`TLS ${s.getProtocol()} · authorized=${s.authorized}${s.authorizationError ? ` (${s.authorizationError})` : ''} · issuer ${c.issuer?.O ?? '?'} · expires ${c.valid_to} (${days} days)`)
        s.end()
      })
      s.on('error', (e) => ok(`TLS handshake failed: ${e.message}`))
      s.on('timeout', () => (ok('TLS handshake timed out'), s.destroy()))
    })
    lines.push(cert)
  } else lines.push('Served over plain HTTP: no TLS.')
  return lines.join('\n')
}

// ─── the agent ───

const RESULT_SHAPE =
  'Answer with ONE block and nothing after it:\n<security-result>{"integrity": 0-100 (100 = no risk), "summary": "two plain sentences for the owner", ' +
  '"findings": [{"severity": "critical|high|medium|low|info", "category": "short, e.g. Injection, Auth, Secrets, Config, TLS, Network, Dependency", ' +
  '"title": "under 10 words", "detail": "what is wrong and why it matters, 1-3 sentences", "location": "file:line or server path/service", "remediation": "the concrete fix"}]}</security-result>\n' +
  'Only real, confirmed problems; no generic advice; do not repeat the facts already listed as findings unless you add something.'

function parseResult(text: string): { integrity: number | null; summary: string; findings: Raw[] } {
  const m = text.match(/<security-result>([\s\S]*?)<\/security-result>/)
  const json = m ? m[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  const v = JSON.parse(json)
  const findings: Raw[] = (Array.isArray(v.findings) ? v.findings : [])
    .filter((f: any) => f?.title)
    .slice(0, 60)
    .map((f: any) => ({
      severity: SEVS.includes(f.severity) ? f.severity : f.severity === 'warning' ? 'low' : 'medium',
      category: String(f.category ?? 'General').slice(0, 40),
      title: String(f.title).slice(0, 160),
      detail: String(f.detail ?? '').slice(0, 2000),
      location: String(f.location ?? '').slice(0, 300),
      remediation: String(f.remediation ?? '').slice(0, 1500)
    }))
  const i = Number(v.integrity)
  return { integrity: Number.isFinite(i) ? Math.max(0, Math.min(100, Math.round(i))) : null, summary: String(v.summary ?? ''), findings }
}

/** Code audit: the agent reads the repository (no edits, no shell) with the pentest skills at hand. */
function auditCode(root: string, facts: Raw[], focus: string, lang: string): Promise<{ text: string; cost: number | null }> {
  const skills = SKILLS()
  const prompt =
    lang + '\n' +
    `Audit this repository (${root}) like a senior application pentester, statically: never run or attack anything. ` +
    `Pentest skills are in ${skills}: read ${join(skills, 'INDEX.md')} first, then only the SKILL.md files that fit this stack. ` +
    'Look for injection (SQL/NoSQL/command/template), XSS, broken access control and IDOR, SSRF, insecure deserialization, unvalidated uploads, ' +
    'hardcoded secrets, weak auth/JWT/OAuth/sessions, permissive CORS, path traversal, risky CI/CD and Docker config, unsafe dependency use. ' +
    'Prefer depth on the entry points (routes, handlers, auth, file and DB access) over reading everything.\n\n' +
    (focus ? `FOCUS of this scan, asked by the user: ${focus}\n\n` : '') +
    `Facts already collected (dependency audit, committed secrets):\n${facts.map((f) => `- [${f.severity}] ${f.title} (${f.location})`).join('\n') || '(none)'}\n\n` +
    RESULT_SHAPE
  return new Promise((ok) => {
    const child = execFile(
      bin('claude'),
      ['-p', '--output-format', 'json', '--model', 'sonnet', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob',
        '--add-dir', skills, '--strict-mcp-config', '--setting-sources', 'project', '--disable-slash-commands', '--no-session-persistence'],
      { cwd: root, env: shellEnv(), maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 },
      (_e, out) => {
        try {
          const j = JSON.parse(String(out))
          ok({ text: String(j.result ?? ''), cost: j.total_cost_usd ?? null })
        } catch {
          ok({ text: '', cost: null })
        }
      }
    )
    child.stdin?.end(prompt)
  })
}

// ─── scans ───

const running = new Set<string>()

export function scan(projectId: string, targets: SecTarget[], trigger: 'manual' | 'scheduled' = 'manual', focus = ''): Promise<void[]> {
  return Promise.all(targets.map((t) => scanOne(projectId, t, trigger, focus)))
}

async function scanOne(projectId: string, target: SecTarget, trigger: 'manual' | 'scheduled', focus: string) {
  const key = `${projectId}:${target}`
  if (running.has(key)) return
  const project = await db.project(projectId)
  if (!project) return
  let env: EnvRow | null = null
  if (target !== 'software') {
    const e = (await rstore.envs(projectId)).find((x) => x.kind === ENV_KIND[target])
    env = e ? await rstore.envRow(e.id) : null
    if (!env || env.connection_status === 'unverified') return
  }
  running.add(key)
  const id = 'ss_' + randomUUID().slice(0, 8)
  await pool.query('insert into security_scans(id, project_id, target, trigger) values($1,$2,$3,$4)', [id, projectId, target, trigger])
  changed(projectId)
  try {
    let facts: Raw[] = []
    let res: { integrity: number | null; summary: string; findings: Raw[] }
    let cost: number | null = null
    if (target === 'software') {
      facts = [...(await npmAudit(project.path)), ...(await committedSecrets(project.path))]
      const a = await auditCode(project.path, facts, focus, await languageRule())
      cost = a.cost
      res = parseResult(a.text)
    } else {
      const wd = env!.workdir || '~'
      const parts: string[] = [`## Web (checked from outside)\n${await webFacts(env!.health_url)}`]
      const windows = await isWindows(env!)
      for (const [title, cmd] of windows ? WIN_SURVEY : SEC_SURVEY) {
        const line = windows
          ? powershell(`$ErrorActionPreference='SilentlyContinue'; $ProgressPreference='SilentlyContinue'; $wd='${wd.replace(/'/g, "''")}'; ${cmd}`)
          : `WD=${JSON.stringify(wd)}; ${cmd}`
        const r = line ? await sshExec(env!, line, { readOnly: true, timeoutMs: 60_000 }) : { stdout: '', stderr: 'Skipped: the command would change the server.' }
        parts.push(`## ${title}\n${(r.stdout || r.stderr || '(no output)').slice(0, 8000)}`)
      }
      const system =
        'You are a senior infrastructure security auditor. You get the read-only output of fixed commands run on a server ' +
        `(${target}, ${env!.host}, ${windows ? 'Windows, collected with PowerShell' : 'Unix'}, app folder ${wd}) plus its web headers and TLS. Judge exposure: open ports, SSH hardening, firewall, pending security updates, ` +
        'exposed .env/.git/dumps/keys in the app folder, loose permissions, webshells and suspicious recent files, risky web server or container config, missing security headers, weak or expiring TLS. ' +
        'Base every finding on the output; say where. ' + RESULT_SHAPE +
        '\n\nThe claude-red pentest skills below are how an attacker would go at this server: use them as the checklist of what to look for in the output, ' +
        'and report only what the output shows.\n\n' + serverSkills(windows, parts.join('\n'))
      const r = await claudeText(system, (focus ? `FOCUS of this scan, asked by the user: ${focus}\n\n` : '') + parts.join('\n\n'), 'sonnet', 300_000)
      cost = r.cost
      if (!r.ok) throw new Error(r.text || 'The agent did not answer')
      res = parseResult(r.text)
    }
    await record(projectId, target, id, [...facts, ...res.findings])
    const score = await scoreOf(projectId, target)
    await pool.query(
      `update security_scans set status='done', summary=$2, agent_integrity=$3, score=$4, cost_usd=$5, finished_at=now() where id=$1`,
      [id, res.summary.slice(0, 1000), res.integrity, score, cost]
    )
  } catch (e: any) {
    await pool.query(`update security_scans set status='failed', error=$2, finished_at=now() where id=$1`, [id, String(e?.message ?? e).slice(0, 500)])
  } finally {
    running.delete(key)
    changed(projectId)
  }
}

/** Upsert by fingerprint; open findings of this target that the scan no longer sees are resolved. */
async function record(projectId: string, target: SecTarget, scanId: string, list: Raw[]) {
  const seen = new Set<string>()
  for (const f of list) {
    const fp = fingerprint(target, f)
    if (seen.has(fp)) continue
    seen.add(fp)
    await pool.query(
      `insert into security_findings(id, project_id, target, fingerprint, severity, category, title, detail, location, remediation, scan_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (project_id, fingerprint) do update set severity=excluded.severity, detail=excluded.detail, remediation=excluded.remediation,
         scan_id=excluded.scan_id, last_seen=now(),
         status = case when security_findings.status = 'resolved' then 'open' else security_findings.status end,
         resolved_at = case when security_findings.status = 'resolved' then null else security_findings.resolved_at end`,
      ['sf_' + randomUUID().slice(0, 10), projectId, target, fp, f.severity, f.category, f.title, f.detail, f.location, f.remediation, scanId]
    )
  }
  await pool.query(
    `update security_findings set status='resolved', resolved_at=now()
     where project_id=$1 and target=$2 and status='open' and not (fingerprint = any($3))`,
    [projectId, target, [...seen]]
  )
}

async function scoreOf(projectId: string, target: SecTarget): Promise<number> {
  const r = await pool.query(`select severity, count(*)::int as n from security_findings where project_id=$1 and target=$2 and status='open' group by severity`, [projectId, target])
  return Math.max(0, 100 - penalty(Object.fromEntries(r.rows.map((x) => [x.severity, x.n]))))
}

const findingRow = (x: any): SecFinding => ({
  id: x.id, projectId: x.project_id, target: x.target, severity: x.severity, category: x.category, title: x.title, detail: x.detail,
  location: x.location, remediation: x.remediation, status: x.status, firstSeen: x.first_seen.getTime(), lastSeen: x.last_seen.getTime(),
  resolvedAt: x.resolved_at ? x.resolved_at.getTime() : null, scanId: x.scan_id
})
const scanRow = (x: any): SecScan => ({
  id: x.id, target: x.target, status: x.status, trigger: x.trigger, summary: x.summary, agentIntegrity: x.agent_integrity, error: x.error,
  costUsd: x.cost_usd, startedAt: x.started_at.getTime(), finishedAt: x.finished_at ? x.finished_at.getTime() : null
})

export async function dashboard(projectId: string, days: number): Promise<SecDashboard> {
  const envs = await rstore.envs(projectId)
  const [scans, findings] = await Promise.all([
    pool.query('select * from security_scans where project_id=$1 order by started_at desc limit 200', [projectId]),
    pool.query(
      `select * from security_findings where project_id=$1
       order by case status when 'open' then 0 else 1 end, array_position(array['critical','high','medium','low','info'], severity), last_seen desc limit 500`,
      [projectId]
    )
  ])
  const list = findings.rows.map(findingRow)
  const targets: TargetState[] = []
  for (const t of ['software', 'production', 'staging'] as SecTarget[]) {
    const mine = scans.rows.filter((x) => x.target === t)
    const done = mine.filter((x) => x.status === 'done')
    const env = t === 'software' ? null : envs.find((e) => e.kind === ENV_KIND[t])
    targets.push({
      target: t,
      score: done.length ? await scoreOf(projectId, t) : null,
      previous: done[1]?.score ?? null,
      connected: t === 'software' || (!!env && env.connection_status !== 'unverified'),
      lastScan: mine[0] ? scanRow(mine[0]) : null,
      running: mine[0]?.status === 'running',
      open: list.filter((f) => f.target === t && f.status === 'open').length
    })
  }

  // New findings per day.
  const from = Date.now() - (days - 1) * 86_400_000
  const out: SecDashboard['days'] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(from + i * 86_400_000)
    out.push({ day: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), total: 0, critical: 0, high: 0, medium: 0, low: 0 })
  }
  for (const f of list) {
    const b = out.find((x) => x.day === new Date(f.firstSeen).toISOString().slice(0, 10))
    if (!b || f.severity === 'info') continue
    b.total++
    b[f.severity]++
  }
  const open = list.filter((f) => f.status === 'open')
  const count = (key: (f: SecFinding) => string) => {
    const m = new Map<string, number>()
    for (const f of open) m.set(key(f), (m.get(key(f)) ?? 0) + 1)
    return [...m.entries()].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count).slice(0, 5)
  }
  const label: Record<SecTarget, string> = { software: 'Software', production: 'Production', staging: 'Staging' }
  return {
    projectId,
    targets,
    days: out,
    byCategory: count((f) => f.category || 'General'),
    byTarget: count((f) => label[f.target]),
    findings: list,
    schedule: (await db.getSetting<SecSchedule>(scheduleKey(projectId))) ?? DEFAULT_SCHEDULE
  }
}

export async function setStatus(id: string, status: FindingStatus) {
  const r = await pool.query(
    `update security_findings set status=$2, resolved_at = case when $2 = 'open' then null else coalesce(resolved_at, now()) end where id=$1 returning project_id`,
    [id, status]
  )
  if (r.rows[0]) changed(r.rows[0].project_id)
}

export async function setSchedule(projectId: string, s: SecSchedule) {
  await db.setSetting(scheduleKey(projectId), s)
  changed(projectId)
}

/** The finding goes to the project's main chat as a request to fix it. */
export async function fix(id: string): Promise<string> {
  const f = (await pool.query('select * from security_findings where id=$1', [id])).rows[0]
  if (!f) throw new Error('Finding not found')
  const p = await db.project(f.project_id)
  const all = await db.workspaces()
  const main = all.find((w) => w.projectId === f.project_id && w.worktreePath === p?.path)
  if (!main || !sendFix || !newBranch) throw new Error('This project has no main chat')
  // Each fix on its own branch, so a change to the code never lands on the main one; pressed again, the same branch
  const earlier = await db.getSetting<string>(`security-fix:${id}`)
  const ws = all.find((w) => w.id === earlier) ?? (await newBranch(f.project_id, `Fix: ${f.title}`, `fix/security-${slug(f.title).slice(0, 40)}`))
  await db.setSetting(`security-fix:${id}`, ws.id)
  if (ws.id === earlier) return ws.id
  const o = (await db.getSetting<any>(`opts:${main.id}`)) ?? (await db.getSetting<any>('opts:last'))
  sendFix({
    workspaceId: ws.id,
    model: o?.model ?? (await listModels(false))[0]?.id ?? 'claude-opus-5-5',
    effort: o?.effort ?? 'medium',
    mode: { kind: 'direct' },
    fullAccess: o?.fullAccess ?? true,
    text:
      `Fix this security finding (${f.severity}, ${f.category}):\n**${f.title}**\n${f.detail}\n\nWhere: ${f.location || 'n/a'}\nSuggested fix: ${f.remediation || 'n/a'}\n\n` +
      (f.target === 'software'
        ? 'You are on a branch made for this fix. Make the smallest safe change, verify it, and commit it here. If it needs a decision only I can make, ask.'
        : `It is on the ${f.target} server: see it with env_info, inspect it with env_exec or env_files (env "${f.target}"). ` +
          'Follow the project rules on files and actions that must not be touched. Before any change on the server, tell me the exact commands and wait for my ok; ' +
          'then apply them with env_exec or env_files, and check the fix. If the right fix is in the code or the deploy config instead, change that and commit it on this branch, made for this fix.')
  })
  return ws.id
}

// ─── schedule: weekdays at a time, while the app is open ───

let timer: NodeJS.Timeout | null = null
export function startSecuritySchedule() {
  if (timer) return
  const tick = async () => {
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const slot = `${now.toISOString().slice(0, 10)} ${hhmm}`
    const r = await pool.query(`select key, value from settings where key like 'security:schedule:%'`).catch(() => ({ rows: [] as any[] }))
    for (const row of r.rows) {
      const s = row.value as SecSchedule
      const pid = String(row.key).slice('security:schedule:'.length)
      if (!s?.enabled || !s.days.includes(now.getDay()) || s.time !== hhmm) continue
      if ((await db.getSetting<string>(`security:last:${pid}`)) === slot) continue
      await db.setSetting(`security:last:${pid}`, slot)
      void scan(pid, s.targets, 'scheduled')
    }
  }
  timer = setInterval(() => void tick().catch(() => {}), 30_000)
}

// ─── the orchestrator's access (cm2 MCP → app bridge) ───

const TARGETS: SecTarget[] = ['software', 'production', 'staging']
async function projectOf(wsId: string) {
  const ws = await db.workspace(wsId)
  if (!ws) throw new Error('Unknown chat')
  return ws.projectId
}

async function statusText(pid: string): Promise<string> {
  const d = await dashboard(pid, 30)
  const t = d.targets.map((x) => `${x.target}: ${x.score ?? 'not scanned'}${x.score !== null ? '/100' : ''}${x.connected ? '' : ' (no environment connected)'}${x.running ? ' (scanning now)' : ''}, ${x.open} open`).join('\n')
  const open = d.findings.filter((f) => f.status === 'open').slice(0, 40)
  return `Integrity:\n${t}\n\nOpen findings (${open.length}):\n` + (open.map((f) => `${f.id} [${f.severity}] ${f.target} · ${f.category} · ${f.title} @ ${f.location || '-'}\n   ${f.detail.slice(0, 300)}\n   fix: ${f.remediation.slice(0, 300)}`).join('\n') || '(none)')
}

export function registerSecurityActions(register: (name: string, fn: (ws: string, a: any) => Promise<{ text: string; error?: boolean }>) => void) {
  register('security_status', async (ws) => ({ text: await statusText(await projectOf(ws)) }))
  register('security_scan', async (ws, a) => {
    const pid = await projectOf(ws)
    const targets = (Array.isArray(a.targets) && a.targets.length ? a.targets : TARGETS).filter((t: string) => TARGETS.includes(t as SecTarget)) as SecTarget[]
    await scan(pid, targets, 'manual', String(a.focus ?? ''))
    return { text: `Scan finished.\n\n${await statusText(pid)}` }
  })
  register('security_update', async (_ws, a) => {
    await setStatus(String(a.id), a.status as FindingStatus)
    return { text: `Finding ${a.id} is now ${a.status}.` }
  })
  register('env_info', async (ws) => {
    const envs = await rstore.envs(await projectOf(ws))
    if (!envs.length) return { text: 'No environments connected for this project (the user connects them in Recon).' }
    return {
      text: envs.map((e) => `${e.kind}: ${e.username}@${e.host}:${e.port} (${e.protocol}), app folder ${e.workdir || '~'}, ${e.connection_status}` +
        `${e.health_url ? `, health ${e.health_url} (${e.monitor_state})` : ''}${e.profile_summary ? `\n   ${e.profile_summary}` : ''}`).join('\n')
    }
  })
  register('env_exec', async (ws, a) => {
    const kind = a.env === 'staging' ? 'staging' : 'production'
    const e = (await rstore.envs(await projectOf(ws))).find((x) => x.kind === kind)
    const row = e ? await rstore.envRow(e.id) : null
    if (!row || row.connection_status === 'unverified') return { text: `No verified ${kind} environment: the user connects it in Recon.`, error: true }
    if (row.protocol !== 'ssh') return { text: `${kind} is reached over ${row.protocol.toUpperCase()}, which has no shell: use env_files (list, read, write, delete, mkdir, rename) and env_upload.`, error: true }
    const wd = row.workdir || '~'
    // Windows' SSH shell is cmd: its own way to change folder, and no /dev/null
    const line = (await isWindows(row)) ? `cd /d "${wd}" && ${String(a.command)}` : `cd ${JSON.stringify(wd)} 2>/dev/null; ${String(a.command)}`
    const r = await sshExec(row, line, { timeoutMs: Math.min(600, Number(a.timeout_sec) || 120) * 1000 })
    const out = `${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`.slice(0, 30_000)
    return { text: `exit ${r.code ?? '?'}\n${out || '(no output)'}`, error: !r.ok }
  })
}
