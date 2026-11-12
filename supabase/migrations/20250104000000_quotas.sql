-- Migration 4: per-account limits, enforced in the database so no client can skip them.
-- Apply AFTER migrations 1 to 3. Safe to run once. To change a limit, edit the number in its function and re-run that function.
--
--   projects per account ............ 25
--   media storage per account ....... 200 MB (sum of asset bytes)
--   saved messages per published site 5000  (the owner deletes old ones; a full inbox rejects new messages)
--
-- Errors use the message text quota_projects / quota_storage / quota_submissions, which the app turns into friendly wording.

create or replace function public.enforce_project_quota() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.projects where owner_id = new.owner_id) >= 25 then
    raise exception 'quota_projects' using errcode = 'R0413';
  end if;
  return new;
end;
$$;
create trigger projects_quota before insert on public.projects
  for each row execute function public.enforce_project_quota();

-- Re-uploading an asset that already exists is an upsert, and a BEFORE INSERT trigger runs before the conflict is
-- detected. So an existing id is never counted twice, and replacing a file only has to fit the difference.
create or replace function public.enforce_storage_quota() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_used bigint;
begin
  select coalesce(sum(bytes), 0) into v_used from public.assets where owner_id = new.owner_id and id <> new.id;
  if v_used + new.bytes > 200 * 1024 * 1024 then
    raise exception 'quota_storage' using errcode = 'R0413';
  end if;
  return new;
end;
$$;
create trigger assets_quota before insert or update of bytes on public.assets
  for each row execute function public.enforce_storage_quota();

create or replace function public.enforce_submission_quota() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.form_submissions where site_id = new.site_id) >= 5000 then
    raise exception 'quota_submissions' using errcode = 'R0413';
  end if;
  return new;
end;
$$;
create trigger submissions_quota before insert on public.form_submissions
  for each row execute function public.enforce_submission_quota();

-- What an account is using, for the editor to show. Callable only as the signed-in user, and only reveals their own numbers.
create or replace function public.my_usage() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'projects',      (select count(*) from public.projects where owner_id = (select auth.uid())),
    'projectsLimit', 25,
    'storageBytes',  (select coalesce(sum(bytes), 0) from public.assets where owner_id = (select auth.uid())),
    'storageLimit',  200 * 1024 * 1024
  );
$$;
revoke execute on function public.my_usage() from public, anon;
grant  execute on function public.my_usage() to authenticated;
