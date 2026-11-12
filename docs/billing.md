# Billing (credit packs with Razorpay)

People buy **packs of AI credits** (one-off payments, no subscriptions). Credits are spent by AI requests (see `docs/ai.md`).

## How a purchase works

1. The editor asks `POST /api/billing/order` with only a **pack id**. The server looks the price up in **its own list** (never from the browser),
   creates a Razorpay order for exactly that amount, and records it in `payments` as `created`.
2. Razorpay Checkout opens in the browser with that order and the **public** key id.
3. When the person pays, two independent messages tell us:
   - the browser calls `POST /api/billing/verify` with Razorpay's signature (instant feedback), and
   - Razorpay calls `POST /api/billing/webhook` (the source of truth: it works even if the browser was closed).
4. Both end in the database function `apply_payment()`, which locks the order row, checks the amount and currency against what was recorded,
   and grants the credits **at most once**, however many times, in whatever order, or at the same instant, they are reported.

## Safety properties (each has tests)

- The price and number of credits can't be influenced by the browser. A response from Razorpay is only trusted if it is the order we asked for.
- Signatures are HMAC-SHA256 (hex) compared in constant time, checked against Node's own HMAC in tests. The webhook signature covers the raw
  body and is verified before the body is read; the webhook secret is separate from the API key secret.
- A payment of the wrong amount or currency grants nothing and is logged for a human.
- Someone else's order is indistinguishable from a missing one. Browsers can't read other people's payments, or insert/edit any payment (row-level security),
  and can't call `apply_payment` (explicitly revoked from `anon` and `authenticated`).
- Logs and error messages never contain keys, signatures, order/payment ids or amounts. Razorpay's own error text is never repeated to users.
- Account deletion removes a person's payment records (foreign-key cascade). Note: **you may be required to keep invoices/tax records** for some years;
  decide with your accountant before relying on this and adjust.

## Set up (when you are ready to take real money)

1. Apply `supabase/migrations/20250105000000_payments.sql` (see `docs/backend.md`).
2. Create a Razorpay account and use **test mode** first. Add to `apps/editor/.env.local` (server-only): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
3. In the Razorpay dashboard add a webhook to `https://<your-site>/api/billing/webhook` with the events **payment.captured** (and optionally **order.paid**) and a secret;
   put the same secret in `RAZORPAY_WEBHOOK_SECRET`. The webhook must be reachable from the internet (a deployed site, or a tunnel while testing).
4. Set **your real prices** in `BILLING_PACKS` (JSON). The built-in packs (50 credits for 99 rupees, and so on) are **placeholders**; the spec leaves pricing open
   and says to set it from measured AI cost per request (run the evaluation, `docs/ai.md`). An invalid `BILLING_PACKS` switches purchases **off** rather than guessing.
5. Make a test purchase with Razorpay's test card/UPI and confirm the credits arrive, then repeat after closing the browser right after paying (the webhook path).
6. Switch to live keys only after the launch checklist below.

## NOT verified against the real Razorpay

Built from Razorpay's published documentation and tested against fakes (a fake order API and a stub of the checkout window). Field names in the
webhook payload (`payload.payment.entity.{id, order_id, amount, currency, status}`) follow the docs but have not been seen from the live service.
Do the test-mode purchase above before trusting it.

## Launch checklist (not code; you must do these)

- Fill in the **Terms, Privacy and Refund pages** (`/terms`, `/privacy`, `/refunds`): set `NEXT_PUBLIC_BUSINESS_NAME`, `NEXT_PUBLIC_SUPPORT_EMAIL` etc., replace every
  highlighted [[blank]], and have a lawyer review them. They show a **DRAFT** banner until no blanks remain.
- A registered business, a Razorpay account activated for live payments, and **GST/invoice** handling as your accountant advises. Razorpay processes
  payments; it does not issue your tax invoices.
- Decide whether credits expire, and your refund rules; put them in the policy pages.
- Not built: subscriptions, coupons, automatic refunds, invoices, a payments history screen, and email receipts (needs an email provider).
