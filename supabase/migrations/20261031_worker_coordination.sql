-- One global admission lock per deployment; claims count public and private leases.
create table if not exists whycode_runtime.worker_gate(namespace text primary key);
revoke all on whycode_runtime.worker_gate from public, anon, authenticated;
alter table whycode_runtime.repository_indexes add column if not exists generation integer not null default 1;
create table if not exists whycode_runtime.private_indexes (
  namespace text not null, scope text not null, repository_id text not null,
  job_id text not null, status jsonb not null, snapshot jsonb,
  lease_until timestamptz, generation integer not null default 1,
  expires_at timestamptz not null, primary key(namespace,scope,repository_id)
);
revoke all on whycode_runtime.private_indexes from public, anon, authenticated;
create table if not exists whycode_runtime.private_index_imports (
  namespace text not null, legacy_id text not null, primary key(namespace,legacy_id)
);
revoke all on whycode_runtime.private_index_imports from public, anon, authenticated;
alter table whycode_runtime.sessions add column if not exists private_scope text;
alter table whycode_runtime.sessions add column if not exists github_enabled boolean not null default false;
create index if not exists sessions_private_scope on whycode_runtime.sessions(namespace,private_scope);
