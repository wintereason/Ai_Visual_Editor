-- Visual Creator: core schema (spec section 14). Every table is owner-scoped with row level security.

-- ---------- projects ----------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  platform    text not null check (platform in ('web', 'mobile', 'web+mobile')),
  json        jsonb not null,
  version     integer not null default 1 check (version >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Cheap structural guard. Full registry validation must also run server-side before publish (see docs/backend.md).
  -- "is true" matters: a CHECK passes on NULL, so a document with no schemaVersion would otherwise slip through.
  constraint projects_json_shape check ((json ->> 'schemaVersion' = '2' and jsonb_typeof(json -> 'pages') = 'array') is true),
  constraint projects_json_size  check (octet_length(json::text) <= 5 * 1024 * 1024)
);
create index projects_owner_updated_idx on public.projects (owner_id, updated_at desc);

-- ---------- version history ----------
create table public.project_versions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  version     integer not null,
  json        jsonb not null,
  reason      text not null default 'autosave' check (char_length(reason) <= 120),
  created_at  timestamptz not null default now(),
  unique (project_id, version)
);
create index project_versions_project_idx on public.project_versions (project_id, created_at desc);

-- ---------- assets (metadata; bytes live in Storage at <owner>/<asset id>) ----------
create table public.assets (
  id           text primary key check (id ~ '^asset_[a-z0-9]+$'),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) <= 120),
  kind         text not null check (kind in ('png', 'jpeg', 'gif', 'webp')),
  mime         text not null check (mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  bytes        integer not null check (bytes > 0 and bytes <= 20 * 1024 * 1024),
  width        integer not null check (width > 0),
  height       integer not null check (height > 0),
  hash         text not null check (hash ~ '^[0-9a-f]{64}$'),
  alt          text check (char_length(alt) <= 300),
  storage_key  text not null,
  created_at   timestamptz not null default now(),
  unique (owner_id, hash),
  constraint assets_key_is_owned check (storage_key = owner_id::text || '/' || id)
);

-- ---------- row level security ----------
alter table public.projects         enable row level security;
alter table public.project_versions enable row level security;
alter table public.assets           enable row level security;

create policy projects_owner on public.projects
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy versions_owner on public.project_versions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy assets_owner on public.assets
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------- optimistic-concurrency save (spec section 13: autosave with baseVersion -> 409) ----------
-- Runs as the caller (security invoker), so RLS applies: a project you do not own looks like "not found".
create or replace function public.save_project(p_id uuid, p_base_version integer, p_json jsonb, p_name text default null)
returns table (version integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_version integer;
  v_updated timestamptz;
begin
  update public.projects p
     set json = p_json,
         name = coalesce(nullif(p_name, ''), p.name),
         platform = coalesce(p_json ->> 'platform', p.platform),
         version = p.version + 1,
         updated_at = now()
   where p.id = p_id and p.version = p_base_version
  returning p.version, p.updated_at into v_version, v_updated;

  if not found then
    if exists (select 1 from public.projects where id = p_id) then
      raise exception 'version_conflict' using errcode = '40001';
    end if;
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return query select v_version, v_updated;
end;
$$;

-- Snapshot the current state into history; keeps the newest 30 per project.
create or replace function public.snapshot_project(p_id uuid, p_reason text default 'autosave')
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  proj public.projects%rowtype;
begin
  select * into proj from public.projects where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.project_versions (project_id, owner_id, version, json, reason)
  values (proj.id, proj.owner_id, proj.version, proj.json, left(coalesce(p_reason, 'autosave'), 120))
  on conflict (project_id, version) do update set json = excluded.json, reason = excluded.reason, created_at = now();

  delete from public.project_versions
   where project_id = p_id
     and id not in (select id from public.project_versions where project_id = p_id order by created_at desc limit 30);
end;
$$;

revoke execute on function public.save_project(uuid, integer, jsonb, text) from public, anon;
revoke execute on function public.snapshot_project(uuid, text) from public, anon;
grant execute on function public.save_project(uuid, integer, jsonb, text) to authenticated;
grant execute on function public.snapshot_project(uuid, text) to authenticated;

-- ---------- storage: private bucket, each user confined to their own folder ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', false, 20 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create policy assets_storage_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy assets_storage_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy assets_storage_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy assets_storage_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
