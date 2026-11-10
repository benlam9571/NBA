-- Run once in Supabase SQL Editor (or apply with the Supabase CLI).
-- New dedicated objects; no application data is deleted or replaced.
begin;

create table public.nba_app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.nba_app_members enable row level security;
revoke all on table public.nba_app_members from anon, authenticated;
grant select on table public.nba_app_members to authenticated;
grant all on table public.nba_app_members to service_role;

create policy "NBA member reads own membership"
  on public.nba_app_members for select to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nba-props-private', 'nba-props-private', false, 52428800, array['application/json']);

create policy "NBA members read private snapshots"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'nba-props-private'
    and exists (
      select 1 from public.nba_app_members m
      where m.user_id = (select auth.uid())
    )
  );
-- No INSERT/UPDATE/DELETE policies for browser users. Only a trusted service-role
-- publisher uploads snapshots. Anonymous users have no read policy.

-- Restrictive policies keep this dedicated bucket private even if another app
-- in the same project has permissive storage-object policies.
create policy "NBA anonymous isolation" on storage.objects
  as restrictive for select to anon using (bucket_id <> 'nba-props-private');
create policy "NBA authenticated isolation" on storage.objects
  as restrictive for select to authenticated
  using (bucket_id <> 'nba-props-private' or exists (
    select 1 from public.nba_app_members m where m.user_id = (select auth.uid())
  ));
create policy "NBA no browser inserts" on storage.objects
  as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'nba-props-private');
create policy "NBA no browser updates" on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'nba-props-private') with check (bucket_id <> 'nba-props-private');
create policy "NBA no browser deletes" on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id <> 'nba-props-private');

create policy "NBA no browser bucket inserts" on storage.buckets
  as restrictive for insert to anon, authenticated with check (id <> 'nba-props-private');
create policy "NBA no browser bucket updates" on storage.buckets
  as restrictive for update to anon, authenticated
  using (id <> 'nba-props-private') with check (id <> 'nba-props-private');
create policy "NBA no browser bucket deletes" on storage.buckets
  as restrictive for delete to anon, authenticated using (id <> 'nba-props-private');
commit;
