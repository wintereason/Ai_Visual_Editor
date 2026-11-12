-- Migration 5: payments for credit packs (Razorpay). Apply AFTER migrations 1 to 4. Safe to run once.
--
-- Money rules enforced HERE, not in app code:
--   * a payment row is created by the server BEFORE the customer pays (the amount and credits come from the server's own price list);
--   * credits are granted by apply_payment(), which checks the amount and currency Razorpay reports against that row, and grants
--     AT MOST ONCE however many times it is called (webhooks are delivered more than once, and the browser also reports success);
--   * nothing here is writable by a browser: users can only READ their own payments.

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  provider     text not null default 'razorpay' check (provider = 'razorpay'),
  order_id     text not null unique check (order_id ~ '^[A-Za-z0-9_]{8,64}$'),
  payment_id   text unique check (payment_id is null or payment_id ~ '^[A-Za-z0-9_]{8,64}$'),
  pack_id      text not null check (pack_id ~ '^[a-z0-9_-]{1,30}$'),
  credits      integer not null check (credits between 1 and 100000),
  amount_paise integer not null check (amount_paise between 100 and 100000000),
  currency     text not null check (currency = 'INR'),
  status       text not null default 'created' check (status in ('created', 'paid')),
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  constraint payments_paid_has_payment check ((status = 'paid') = (payment_id is not null and paid_at is not null))
);
create index payments_user_idx on public.payments (user_id, created_at desc);

alter table public.payments enable row level security;
create policy payments_owner_read on public.payments for select to authenticated using (user_id = (select auth.uid()));
-- No insert / update / delete policy: a browser can never create, change or fake a payment.

-- Returns 'granted' (credits added now), 'already' (this order was already paid, nothing changes),
-- 'mismatch' (amount or currency differ from what we expected: NOTHING is granted) or 'unknown' (no such order).
create or replace function public.apply_payment(p_order_id text, p_payment_id text, p_amount integer, p_currency text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.payments%rowtype;
begin
  if p_payment_id is null or p_payment_id !~ '^[A-Za-z0-9_]{8,64}$' then
    raise exception 'invalid_payment_id' using errcode = '22023';
  end if;
  -- lock the row so two simultaneous calls (webhook + browser) cannot both grant
  select * into v from public.payments where order_id = p_order_id for update;
  if not found then return 'unknown'; end if;
  if v.status = 'paid' then return 'already'; end if;
  if v.amount_paise is distinct from p_amount or v.currency is distinct from p_currency then return 'mismatch'; end if;

  update public.payments set status = 'paid', payment_id = p_payment_id, paid_at = now() where id = v.id;
  perform public.grant_credits(v.user_id, v.credits, 'purchase ' || left(v.pack_id, 30));
  return 'granted';
end;
$$;

-- Server only. Explicitly revoked from anon and authenticated: Supabase grants new functions to them by default.
revoke execute on function public.apply_payment(text, text, integer, text) from public, anon, authenticated;
grant  execute on function public.apply_payment(text, text, integer, text) to service_role;
