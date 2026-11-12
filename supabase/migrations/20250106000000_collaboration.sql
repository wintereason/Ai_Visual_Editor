-- Visual Creator: sharing a project with other people (Phase 5, collaboration).
--
-- Model
--   * The OWNER shares a project by email, as 'editor' (can change it) or 'viewer' (can only look).
--   * Every share is first an INVITATION. The invited person turns it into membership themselves, by calling claim_invites() after signing in
--     with that email. So sharing can never reveal whether an email already has an account, and nobody can be added without a sign-in.
--   * Only the owner can share, unshare, delete the project, publish it or read its form inbox (those tables stay owner-only, untouched).
--   * Members can read the project and the pictures it uses; editors can save changes (the existing optimistic-concurrency save still applies).
--
-- Every function is explicitly revoked from public/anon: Supabase grants execute to anon by default.

-- ---------- tables ----------
create table public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('editor', 'viewer')),
  added_by    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.project_invites (
  project_id  uuid not null references public.projects (id) on delete cascade,
  email       text not null check (email = lower(email) and char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role        text not null check (role in ('editor', 'viewer')),
  invited_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, email)
);

alter table public.project_members enable row level security;
alter table public.project_invites enable row level security;

-- ---------- who is who ----------
-- Security definer so policies can ask "what is my role here?" without recursing into the tables' own policies.
create or replace function public.project_role(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when exists (select 1 from public.projects where id = p_project and owner_id = (select auth.uid())) then 'owner'
           else (select m.role from public.project_members m where m.project_id = p_project and m.user_id = (select auth.uid()))
         end
$$;

-- Members see their own membership; the owner sees everyone on their projects. Nobody writes these tables directly (only the functions below).
create policy members_select on public.project_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.project_role(project_id) = 'owner');
create policy invites_select_owner on public.project_invites
  for select to authenticated
  using (public.project_role(project_id) = 'owner');

-- ---------- projects: members can read; editors can save ----------
create policy projects_member_select on public.projects
  for select to authenticated
  using (public.project_role(id) is not null);
create policy projects_editor_update on public.projects
  for update to authenticated
  using (public.project_role(id) = 'editor')
  with check (public.project_role(id) = 'editor');

-- An editor must never be able to take over or move a project.
create or replace function public.projects_protect_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id then
    raise exception 'owner_cannot_change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger projects_protect_owner before update on public.projects
  for each row execute function public.projects_protect_owner();

-- ---------- history: members read; editors take and prune snapshots ----------
create policy versions_member_select on public.project_versions
  for select to authenticated
  using (public.project_role(project_id) is not null);
create policy versions_editor_insert on public.project_versions
  for insert to authenticated
  with check (public.project_role(project_id) = 'editor' and owner_id = (select p.owner_id from public.projects p where p.id = project_id));
create policy versions_editor_update on public.project_versions
  for update to authenticated
  using (public.project_role(project_id) = 'editor')
  with check (public.project_role(project_id) = 'editor' and owner_id = (select p.owner_id from public.projects p where p.id = project_id));
create policy versions_editor_delete on public.project_versions
  for delete to authenticated
  using (public.project_role(project_id) = 'editor');

-- ---------- pictures: anyone who can see a project can see the pictures it uses ----------
-- ...but only pictures that belong to someone taking part in that project (its owner or one of its members). Naming another person's
-- picture id inside your own project therefore grants nothing.
create or replace function public.project_participant(p_project uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.project_role(p_project) is not null
     and (exists (select 1 from public.projects where id = p_project and owner_id = p_user)
          or exists (select 1 from public.project_members where project_id = p_project and user_id = p_user))
$$;
revoke execute on function public.project_participant(uuid, uuid) from public, anon;
grant execute on function public.project_participant(uuid, uuid) to authenticated;

-- The subquery on projects is itself row-level secured, so it only ever finds projects the caller owns or was given.
create policy assets_shared_select on public.assets
  for select to authenticated
  using (exists (select 1 from public.projects p
                  where position(assets.id in p.json::text) > 0
                    and public.project_participant(p.id, assets.owner_id)));
-- The file itself: visible exactly when its library row is visible (that row's own policies decide).
create policy assets_storage_shared_select on storage.objects
  for select to authenticated
  using (bucket_id = 'assets' and exists (select 1 from public.assets a where a.storage_key = storage.objects.name));

-- ---------- sharing ----------
create or replace function public.share_project(p_project uuid, p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  e  text := lower(btrim(coalesce(p_email, '')));
  my_email text;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'bad_role' using errcode = '22023'; end if;
  if char_length(e) > 254 or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'bad_email' using errcode = '22023'; end if;
  if not exists (select 1 from public.projects where id = p_project and owner_id = me) then raise exception 'not_owner' using errcode = '42501'; end if;

  select lower(email) into my_email from auth.users where id = me;
  if my_email is not null and my_email = e then raise exception 'cannot_share_with_self' using errcode = '22023'; end if;

  -- At most 10 people per project (members plus pending invitations), so a project can't be turned into a mailing list.
  if (select count(*) from public.project_members where project_id = p_project)
   + (select count(*) from public.project_invites where project_id = p_project and email <> e) >= 10 then
    raise exception 'too_many_people' using errcode = '54000';
  end if;

  insert into public.project_invites (project_id, email, role, invited_by)
  values (p_project, e, p_role, me)
  on conflict (project_id, email) do update set role = excluded.role, invited_by = excluded.invited_by, created_at = now();
end;
$$;

-- The invited person calls this after signing in. It only ever looks at the caller's own verified email.
create or replace function public.claim_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  e  text;
  n  integer := 0;
begin
  if me is null then return 0; end if;
  select lower(email) into e from auth.users where id = me;
  if e is null then return 0; end if;

  delete from public.project_invites where created_at < now() - interval '30 days'; -- invitations expire

  with moved as (
    insert into public.project_members (project_id, user_id, role, added_by)
    select i.project_id, me, i.role, i.invited_by
      from public.project_invites i
      join public.projects p on p.id = i.project_id
     where i.email = e and p.owner_id <> me
    on conflict (project_id, user_id) do update set role = excluded.role
    returning 1
  )
  select count(*) into n from moved;

  delete from public.project_invites where email = e;
  return n;
end;
$$;

-- Owner removes a person (a member by id, or a pending invitation by email).
create or replace function public.unshare_project(p_project uuid, p_user uuid default null, p_email text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.projects where id = p_project and owner_id = me) then raise exception 'not_owner' using errcode = '42501'; end if;
  if p_user is not null then delete from public.project_members where project_id = p_project and user_id = p_user; end if;
  if p_email is not null then delete from public.project_invites where project_id = p_project and email = lower(btrim(p_email)); end if;
end;
$$;

-- A member leaves on their own.
create or replace function public.leave_project(p_project uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.project_members where project_id = p_project and user_id = (select auth.uid());
$$;

-- The owner's view of who has access (members and pending invitations).
create or replace function public.project_people(p_project uuid)
returns table (kind text, user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.projects where id = p_project and owner_id = (select auth.uid())) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  return query
    select 'member'::text, m.user_id, (select u.email::text from auth.users u where u.id = m.user_id), m.role, m.created_at
      from public.project_members m where m.project_id = p_project
    union all
    select 'invited'::text, null::uuid, i.email, i.role, i.created_at
      from public.project_invites i where i.project_id = p_project
    order by 5;
end;
$$;

-- Projects other people shared with me.
create or replace function public.shared_with_me()
returns table (id uuid, name text, version integer, updated_at timestamptz, role text, owner_email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.version, p.updated_at, m.role, (select u.email::text from auth.users u where u.id = p.owner_id)
    from public.project_members m
    join public.projects p on p.id = m.project_id
   where m.user_id = (select auth.uid())
   order by p.updated_at desc
$$;

revoke execute on function public.project_role(uuid) from public, anon;
revoke execute on function public.share_project(uuid, text, text) from public, anon;
revoke execute on function public.claim_invites() from public, anon;
revoke execute on function public.unshare_project(uuid, uuid, text) from public, anon;
revoke execute on function public.leave_project(uuid) from public, anon;
revoke execute on function public.project_people(uuid) from public, anon;
revoke execute on function public.shared_with_me() from public, anon;
grant execute on function public.project_role(uuid) to authenticated;
grant execute on function public.share_project(uuid, text, text) to authenticated;
grant execute on function public.claim_invites() to authenticated;
grant execute on function public.unshare_project(uuid, uuid, text) to authenticated;
grant execute on function public.leave_project(uuid) to authenticated;
grant execute on function public.project_people(uuid) to authenticated;
grant execute on function public.shared_with_me() to authenticated;

-- ---------- saving: say plainly when someone only has view access ----------
-- Same behaviour as before for owners and editors. A viewer used to look like a version conflict; now they get a clear refusal.
create or replace function public.save_project(p_id uuid, p_base_version integer, p_json jsonb, p_name text default null)
returns table (version integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_version integer;
  v_updated timestamptz;
  v_role text := public.project_role(p_id);
begin
  if v_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  elsif v_role = 'viewer' then
    raise exception 'read_only' using errcode = '42501';
  end if;

  update public.projects p
     set json = p_json,
         name = coalesce(nullif(p_name, ''), p.name),
         platform = coalesce(p_json ->> 'platform', p.platform),
         version = p.version + 1,
         updated_at = now()
   where p.id = p_id and p.version = p_base_version
  returning p.version, p.updated_at into v_version, v_updated;

  if not found then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  return query select v_version, v_updated;
end;
$$;
