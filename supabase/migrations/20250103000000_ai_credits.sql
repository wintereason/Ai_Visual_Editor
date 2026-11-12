-- Migration 3: AI credits and job accounting (spec sections 10.4, 14, 18). Apply AFTER migrations 1 and 2.
--
-- Model: a job RESERVES credits before it runs, and is SETTLED afterwards. Success charges (writes a negative ledger row);
-- failure releases the reservation and charges nothing. Reservations count against the balance while they are active, so
-- many parallel requests cannot overspend, and a reservation abandoned for 10 minutes stops counting on its own.
--
-- Only the server may reserve or settle (it holds the service-role key). Signed-in users can read their own jobs and
-- ledger and call ai_balance(). They can never write credits, which is what makes "free generation" impossible from a client.

create table public.ai_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('patch', 'element', 'layout', 'build')),
  status          text not null default 'reserved' check (status in ('reserved', 'succeeded', 'failed')),
  credits         integer not null check (credits between 1 and 100),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  tokens_in       integer check (tokens_in >= 0),
  tokens_out      integer check (tokens_out >= 0),
  model           text check (char_length(model) <= 80),
  error_kind      text check (char_length(error_kind) <= 40),
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  unique (user_id, idempotency_key)
);
create index ai_jobs_user_created_idx on public.ai_jobs (user_id, created_at desc);

create table public.credits_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  delta      integer not null check (delta <> 0 and delta between -100000 and 100000),
  reason     text not null check (char_length(reason) <= 80),
  job_id     uuid references public.ai_jobs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index credits_ledger_user_idx on public.credits_ledger (user_id, created_at desc);

create table public.credit_limits (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  daily_cap integer not null default 40 check (daily_cap between 0 and 10000)
);

alter table public.ai_jobs        enable row level security;
alter table public.credits_ledger enable row level security;
alter table public.credit_limits  enable row level security;
create policy ai_jobs_owner_read   on public.ai_jobs        for select to authenticated using (user_id = (select auth.uid()));
create policy ledger_owner_read    on public.credits_ledger  for select to authenticated using (user_id = (select auth.uid()));
create policy limits_owner_read    on public.credit_limits   for select to authenticated using (user_id = (select auth.uid()));
-- No insert / update / delete policies anywhere: clients cannot write credits or jobs, only the functions below can.

-- Credits a user can spend right now: ledger total minus still-active reservations.
create or replace function public.ai_available(p_user uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select sum(delta) from public.credits_ledger where user_id = p_user), 0)::integer
       - coalesce((select sum(credits) from public.ai_jobs
                    where user_id = p_user and status = 'reserved' and created_at > now() - interval '10 minutes'), 0)::integer;
$$;

-- What the signed-in user sees (their own balance only).
create or replace function public.ai_balance()
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select public.ai_available((select auth.uid()));
$$;

create or replace function public.ai_reserve(p_user uuid, p_kind text, p_credits integer, p_key text)
returns table (job_id uuid, status text, available integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.ai_jobs%rowtype;
  v_cap      integer;
  v_today    integer;
  v_avail    integer;
  v_id       uuid;
begin
  if p_user is null then raise exception 'invalid_user' using errcode = '22023'; end if;
  -- one request at a time per user for the balance check, so parallel calls cannot both pass it
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  select * into v_existing from public.ai_jobs j where j.user_id = p_user and j.idempotency_key = p_key;
  if found then
    return query select v_existing.id, v_existing.status, public.ai_available(p_user);
    return;
  end if;

  v_avail := public.ai_available(p_user);
  if v_avail < p_credits then raise exception 'insufficient_credits' using errcode = 'P0402'; end if;

  select coalesce((select daily_cap from public.credit_limits where user_id = p_user), 40) into v_cap;
  -- columns are qualified with the alias: this function's OUT columns are also called "status" and "available"
  select coalesce(sum(j.credits), 0)::integer into v_today from public.ai_jobs j
   where j.user_id = p_user and j.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
     and (j.status = 'succeeded' or (j.status = 'reserved' and j.created_at > now() - interval '10 minutes'));
  if v_today + p_credits > v_cap then raise exception 'daily_cap' using errcode = 'P0429'; end if;

  insert into public.ai_jobs (user_id, kind, credits, idempotency_key) values (p_user, p_kind, p_credits, p_key) returning id into v_id;
  return query select v_id, 'reserved'::text, v_avail - p_credits;
end;
$$;

create or replace function public.ai_settle(p_job uuid, p_success boolean, p_tokens_in integer, p_tokens_out integer, p_model text, p_error text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.ai_jobs%rowtype;
begin
  select * into j from public.ai_jobs where id = p_job for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if j.status <> 'reserved' then return j.status; end if; -- settling twice never charges twice

  update public.ai_jobs
     set status = case when p_success then 'succeeded' else 'failed' end,
         tokens_in = greatest(coalesce(p_tokens_in, 0), 0), tokens_out = greatest(coalesce(p_tokens_out, 0), 0),
         model = left(p_model, 80), error_kind = case when p_success then null else left(coalesce(p_error, 'unknown'), 40) end,
         finished_at = now()
   where id = p_job;
  if p_success then
    insert into public.credits_ledger (user_id, delta, reason, job_id) values (j.user_id, -j.credits, 'ai:' || j.kind, j.id);
  end if;
  return case when p_success then 'succeeded' else 'failed' end;
end;
$$;

create or replace function public.grant_credits(p_user uuid, p_amount integer, p_reason text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  insert into public.credits_ledger (user_id, delta, reason) values (p_user, p_amount, left(coalesce(p_reason, 'grant'), 80));
  return public.ai_available(p_user);
end;
$$;

-- Locked down: users may only read their own balance. The server (service role) does everything else.
revoke execute on function public.ai_available(uuid), public.ai_reserve(uuid, text, integer, text),
  public.ai_settle(uuid, boolean, integer, integer, text, text), public.grant_credits(uuid, integer, text), public.ai_balance() from public, anon, authenticated;
grant execute on function public.ai_balance() to authenticated;
grant execute on function public.ai_available(uuid), public.ai_reserve(uuid, text, integer, text),
  public.ai_settle(uuid, boolean, integer, integer, text, text), public.grant_credits(uuid, integer, text) to service_role;
