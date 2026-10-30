-- Account-owned investigations. Run once in the Supabase SQL editor for this project.
-- This migration does not store repository indexes or GitHub tokens.
create table if not exists public.whycode_investigations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  repository_id text not null check (length(repository_id) between 1 and 200),
  visibility text not null check (visibility in ('public', 'private')),
  answered_at timestamptz not null,
  payload jsonb not null check (octet_length(payload::text) < 2000000),
  unique (user_id, repository_id, visibility, answered_at)
);
alter table public.whycode_investigations enable row level security;
revoke all on public.whycode_investigations from anon, authenticated;
grant select, insert, delete on public.whycode_investigations to authenticated;
drop policy if exists whycode_investigations_select on public.whycode_investigations;
drop policy if exists whycode_investigations_insert on public.whycode_investigations;
drop policy if exists whycode_investigations_delete on public.whycode_investigations;
create policy whycode_investigations_select on public.whycode_investigations for select to authenticated using ((select auth.uid()) = user_id);
create policy whycode_investigations_insert on public.whycode_investigations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy whycode_investigations_delete on public.whycode_investigations for delete to authenticated using ((select auth.uid()) = user_id);
create index if not exists whycode_investigations_owner_date on public.whycode_investigations (user_id, visibility, answered_at desc);

create table if not exists public.whycode_repositories (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  repository_id text not null check (length(repository_id) between 1 and 200),
  repository text not null check (length(repository) between 1 and 200),
  visibility text not null check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  primary key (user_id, repository_id, visibility)
);
alter table public.whycode_repositories enable row level security;
revoke all on public.whycode_repositories from anon, authenticated;
grant select, insert, update, delete on public.whycode_repositories to authenticated;
drop policy if exists whycode_repositories_select on public.whycode_repositories;
drop policy if exists whycode_repositories_insert on public.whycode_repositories;
drop policy if exists whycode_repositories_update on public.whycode_repositories;
drop policy if exists whycode_repositories_delete on public.whycode_repositories;
create policy whycode_repositories_select on public.whycode_repositories for select to authenticated using ((select auth.uid()) = user_id);
create policy whycode_repositories_insert on public.whycode_repositories for insert to authenticated with check ((select auth.uid()) = user_id);
create policy whycode_repositories_update on public.whycode_repositories for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy whycode_repositories_delete on public.whycode_repositories for delete to authenticated using ((select auth.uid()) = user_id);

-- A single transaction removes only the caller's repository reference and investigations.
create or replace function public.whycode_remove_repository(p_repository_id text, p_visibility text)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  delete from public.whycode_investigations where user_id = (select auth.uid()) and repository_id = p_repository_id and visibility = p_visibility;
  delete from public.whycode_repositories where user_id = (select auth.uid()) and repository_id = p_repository_id and visibility = p_visibility;
end;
$$;
revoke all on function public.whycode_remove_repository(text, text) from public, anon;
grant execute on function public.whycode_remove_repository(text, text) to authenticated;
