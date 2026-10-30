-- Encrypted temporary OAuth/PKCE and password-recovery records for API replicas.
-- Server-only: browser roles cannot read, create or consume these records.
create table if not exists whycode_runtime.auth_flows (
  namespace text not null,
  kind text not null check (kind in ('flow', 'recovery')),
  id text not null,
  payload bytea not null,
  expires_at timestamptz not null,
  primary key (namespace, kind, id)
);
create index if not exists auth_flows_expiry on whycode_runtime.auth_flows (expires_at);
revoke all on whycode_runtime.auth_flows from public, anon, authenticated;
