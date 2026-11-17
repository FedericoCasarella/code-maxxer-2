export const RECON_SCHEMA = `
create table if not exists recon_environments (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  kind text not null, name text not null default '', protocol text not null default 'ssh',
  host text not null default '', port int not null default 22, username text not null default '',
  auth_method text not null default 'agent', key_path text, key_encrypted text, password_encrypted text,
  workdir text not null default '', rules text not null default '',
  health_url text, monitor_enabled boolean not null default false, interval_sec int not null default 60,
  expected_status int, monitor_state text not null default 'unknown',
  last_check_at timestamptz, last_ok_at timestamptz, last_error text,
  connection_status text not null default 'unverified', verified_at timestamptz,
  profile_md text, profile_summary text, profile_updated_at timestamptz,
  unique (project_id, kind)
);
create table if not exists recon_sessions (
  id text primary key, env_id text not null references recon_environments(id) on delete cascade,
  kind text not null, status text not null default 'running', ok boolean, summary text, result_md text,
  cost_usd double precision, logs jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(), finished_at timestamptz
);
create table if not exists recon_incidents (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  env_id text references recon_environments(id) on delete set null, number int not null,
  title text not null, details text not null default '', severity text not null default 'medium',
  source text not null default 'manual', status text not null default 'open',
  summary text, diagnosis text, created_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists recon_checks (
  env_id text not null references recon_environments(id) on delete cascade,
  at timestamptz not null default now(), ok boolean not null, status int, ms int, error text
);
create index if not exists recon_checks_env on recon_checks(env_id, at desc);
create table if not exists recon_downtimes (
  id text primary key, env_id text not null references recon_environments(id) on delete cascade,
  started_at timestamptz not null default now(), ended_at timestamptz, incident_id text
);
create table if not exists cicd_configs (
  env_id text primary key references recon_environments(id) on delete cascade,
  enabled boolean not null default false, yaml text not null default '', last_seen_sha text
);
create table if not exists cicd_secrets (
  env_id text not null references recon_environments(id) on delete cascade,
  name text not null, value_encrypted text not null, primary key (env_id, name)
);
create table if not exists cicd_deploys (
  id text primary key, env_id text not null references recon_environments(id) on delete cascade,
  number int not null, trigger text not null, ref text not null, commit_sha text, commit_message text,
  status text not null default 'queued', release_id text, error text, steps jsonb not null default '[]'::jsonb,
  logs jsonb not null default '[]'::jsonb, started_at timestamptz not null default now(), finished_at timestamptz
);
update recon_sessions set status='failed', summary='Interrupted: the app was closed', finished_at=now() where status='running';
update cicd_deploys set status='failed', error='Interrupted: the app was closed during the deploy', finished_at=now() where status in ('queued','running');
`
