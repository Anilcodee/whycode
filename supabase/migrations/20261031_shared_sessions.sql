-- Server-only encrypted login sessions. Revisions prevent stale updates after logout.
create table if not exists whycode_runtime.sessions (
  namespace text not null,
  id text not null,
  user_id text not null,
  payload bytea not null,
  expires_at timestamptz not null,
  revision integer not null default 1,
  primary key(namespace, id)
);
create index if not exists sessions_user on whycode_runtime.sessions(namespace,user_id);
revoke all on whycode_runtime.sessions from public, anon, authenticated;
-- Records each legacy-vault import once, in the same transaction as its sessions.
create table if not exists whycode_runtime.session_imports (
  namespace text not null,
  source_hash text not null,
  primary key(namespace, source_hash)
);
revoke all on whycode_runtime.session_imports from public, anon, authenticated;
