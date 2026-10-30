-- Temporary browser/account workspace references; payloads are encrypted by the API.
create table if not exists whycode_runtime.guest_workspaces (
  namespace text not null,
  id text not null,
  payload bytea not null,
  expires_at timestamptz not null,
  primary key(namespace,id)
);
create index if not exists guest_workspace_expiry on whycode_runtime.guest_workspaces(expires_at);
revoke all on whycode_runtime.guest_workspaces from public, anon, authenticated;
