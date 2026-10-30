-- Server-only central public repository indexes and expiring job ownership.
create table if not exists whycode_runtime.repository_indexes (
  namespace text not null,
  repository_id text not null,
  job_id text not null,
  status jsonb not null,
  snapshot jsonb,
  lease_until timestamptz,
  primary key(namespace,repository_id)
);
revoke all on whycode_runtime.repository_indexes from public, anon, authenticated;
