-- Migration 2: derived-image metadata, published sites, and public form submissions.
-- Apply AFTER 20250101000000_init.sql. Safe to run once; see docs/backend.md.

-- ---------- assets: remember which file a rotated / cropped image came from ----------
alter table public.assets
  add column derived_from_asset text check (derived_from_asset ~ '^asset_[a-z0-9]+$'),
  add column derived_op         text check (derived_op in ('rotate', 'crop'));
alter table public.assets
  add constraint assets_derived_pair check ((derived_from_asset is null) = (derived_op is null));

-- ---------- sites: a published project (deployment itself is done elsewhere) ----------
create table public.sites (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  project_id    uuid not null unique references public.projects (id) on delete cascade,
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  notify_email  text check (char_length(notify_email) <= 254 and notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  forms_enabled boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table public.sites enable row level security;
-- The check also requires that the project belongs to the caller. Without it, anyone who learned a project id could attach a
-- site to it (and, because a project can have only one site, stop the real owner from ever publishing it).
create policy sites_owner on public.sites
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );

-- ---------- form submissions ----------
-- Visitors of a published site are anonymous. They can ONLY submit through submit_form() below; there is no insert
-- policy, so a direct INSERT (or any read) as anon is denied. Site owners can read and delete their own submissions.
create table public.form_submissions (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.sites (id) on delete cascade,
  form_id     text not null check (form_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  payload     jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16000),
  -- salted hash of the visitor's address, used only to limit abuse. The raw address is never stored.
  sender_hash text,
  created_at  timestamptz not null default now()
);
create index form_submissions_site_idx   on public.form_submissions (site_id, created_at desc);
create index form_submissions_sender_idx on public.form_submissions (site_id, sender_hash, created_at desc);

alter table public.form_submissions enable row level security;
create policy submissions_owner_read on public.form_submissions
  for select to authenticated
  using (exists (select 1 from public.sites s where s.id = site_id and s.owner_id = (select auth.uid())));
create policy submissions_owner_delete on public.form_submissions
  for delete to authenticated
  using (exists (select 1 from public.sites s where s.id = site_id and s.owner_id = (select auth.uid())));

-- ---------- the public entry point ----------
-- SECURITY DEFINER on purpose: anonymous visitors have no table access, and this is the one narrow, validated door.
-- Everything it accepts is checked here; nothing from the caller is ever concatenated into SQL.
create or replace function public.submit_form(p_site_slug text, p_form_id text, p_fields jsonb, p_honeypot text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site      public.sites%rowtype;
  v_key       text;
  v_val       jsonb;
  v_count     integer := 0;
  v_total     integer := 0;
  v_ip        text;
  v_hash      text;
begin
  -- Bots tend to fill every field. A filled honeypot gets a normal-looking success and is silently dropped.
  if p_honeypot is not null and btrim(p_honeypot) <> '' then
    return jsonb_build_object('ok', true);
  end if;

  if p_form_id is null or p_form_id !~ '^[a-zA-Z0-9_-]{1,64}$' then
    raise exception 'invalid_form' using errcode = '22023';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid_fields' using errcode = '22023';
  end if;

  for v_key, v_val in select * from jsonb_each(p_fields) loop
    v_count := v_count + 1;
    if v_count > 20 then raise exception 'too_many_fields' using errcode = '22023'; end if;
    if v_key !~ '^[a-zA-Z0-9_ -]{1,64}$' then raise exception 'invalid_field_name' using errcode = '22023'; end if;
    if jsonb_typeof(v_val) <> 'string' then raise exception 'invalid_field_value' using errcode = '22023'; end if;
    if char_length(v_val #>> '{}') > 2000 then raise exception 'field_too_long' using errcode = '22023'; end if;
    v_total := v_total + char_length(v_val #>> '{}');
  end loop;
  if v_count = 0 then raise exception 'invalid_fields' using errcode = '22023'; end if;
  if v_total > 8000 then raise exception 'submission_too_large' using errcode = '22023'; end if;

  select * into v_site from public.sites where slug = p_site_slug and forms_enabled;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Site-wide flood limit.
  if (select count(*) from public.form_submissions where site_id = v_site.id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited' using errcode = 'R0429';
  end if;

  -- Per-visitor limit, only when the request carries an address (PostgREST passes request headers in this setting).
  begin
    v_ip := nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null then
    v_hash := encode(sha256(convert_to(v_ip || ':' || v_site.id::text, 'UTF8')), 'hex');
    if (select count(*) from public.form_submissions where site_id = v_site.id and sender_hash = v_hash and created_at > now() - interval '10 minutes') >= 5 then
      raise exception 'rate_limited' using errcode = 'R0429';
    end if;
  end if;

  insert into public.form_submissions (site_id, form_id, payload, sender_hash)
  values (v_site.id, p_form_id, p_fields, v_hash);

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.submit_form(text, text, jsonb, text) from public;
grant  execute on function public.submit_form(text, text, jsonb, text) to anon, authenticated;
