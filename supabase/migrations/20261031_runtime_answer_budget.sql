-- Server-only runtime counters. This schema is not exposed through the public Data API.
-- Apply using a database administrator; browser anon/authenticated roles get no access.
create schema if not exists whycode_runtime;
revoke all on schema whycode_runtime from public, anon, authenticated;
create table if not exists whycode_runtime.answer_budget (
  namespace text not null,
  day date not null,
  used integer not null check (used >= 0),
  primary key (namespace, day)
);
revoke all on whycode_runtime.answer_budget from public, anon, authenticated;
