-- Isolated PostgreSQL harness for the Supabase migration. Never run against a live project.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id bigint generated always as identity primary key,bucket_id text,name text);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets,storage.objects to anon,authenticated,service_role;
grant usage,select on all sequences in schema storage to anon,authenticated,service_role;
-- Simulate a project that already has over-broad policies from another app.
create policy existing_object_policy on storage.objects for all to anon,authenticated using(true) with check(true);
create policy existing_bucket_policy on storage.buckets for all to anon,authenticated using(true) with check(true);
\i /tmp/nba-migration.sql
insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.nba_app_members(user_id) values ('11111111-1111-4111-8111-111111111111');
insert into storage.buckets(id,name,public) values('other-app','other-app',true);
insert into storage.objects(bucket_id,name) values('nba-props-private','latest.json'),('other-app','public.json');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$ begin
  if (select count(*) from public.nba_app_members)<>1 then raise exception 'Member cannot read own membership'; end if;
  if (select count(*) from storage.objects where bucket_id='nba-props-private')<>1 then raise exception 'Member cannot read snapshot'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('nba-props-private','evil.json');
    raise exception 'Member unexpectedly wrote private snapshot';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.nba_app_members(user_id) values('22222222-2222-4222-8222-222222222222');
    raise exception 'Member unexpectedly granted membership';
  exception when insufficient_privilege then null; end;
end $$;
update storage.objects set name='tampered.json' where bucket_id='nba-props-private';
delete from storage.objects where bucket_id='nba-props-private';
update storage.buckets set public=true where id='nba-props-private';
delete from storage.buckets where id='nba-props-private';
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$ begin
  if (select count(*) from public.nba_app_members)<>0 then raise exception 'Non-member can read membership'; end if;
  if (select count(*) from storage.objects where bucket_id='nba-props-private')<>0 then raise exception 'Non-member can read private snapshots'; end if;
  if (select count(*) from storage.objects where bucket_id='other-app')<>1 then raise exception 'Other app policies were broken'; end if;
end $$;
reset role;
set role anon;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  if (select count(*) from storage.objects where bucket_id='nba-props-private')<>0 then raise exception 'Anonymous read allowed'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('nba-props-private','anonymous.json');
    raise exception 'Anonymous write allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
insert into storage.objects(bucket_id,name) values('nba-props-private','service-upload.json');
reset role;
do $$ begin
  if (select count(*) from storage.objects where bucket_id='nba-props-private')<>2 then raise exception 'Unexpected private object count'; end if;
  if not exists(select 1 from storage.objects where bucket_id='nba-props-private' and name='latest.json') then raise exception 'Browser modified manifest'; end if;
  if (select public from storage.buckets where id='nba-props-private') then raise exception 'Browser made bucket public'; end if;
end $$;
\echo 'PASS: member read, non-member/anonymous denial, no browser writes or membership escalation, private bucket preserved, service upload and other-app isolation'
