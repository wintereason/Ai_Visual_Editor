# Backend: Supabase setup

The editor works with no backend (local-only). With Supabase configured it adds sign-in, cloud projects with conflict-safe
autosave, version snapshots and synced media.

## 1. Create the project

1. Create a project at supabase.com. Choose the region closest to your users (for India: Mumbai, `ap-south-1`).
2. **SQL editor**: paste and run `supabase/migrations/20250101000000_init.sql`.
   (Or with the CLI: `supabase link` then `supabase db push`.)
3. **Authentication > URL configuration**: set *Site URL* to where the editor runs (`http://localhost:3000` for dev) and add
   the same to *Redirect URLs*. Magic links will not work until this is set.
4. **Authentication > Providers**: Email is on by default. For production, set up a real SMTP provider
   (the built-in mailer is heavily rate-limited and meant for testing).
5. **Settings > API**: copy the Project URL and the `anon` public key.

## 2. Connect the editor

```
cp apps/editor/.env.example apps/editor/.env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev -w @avc/editor
```

Never put the `service_role` key in the editor or any `NEXT_PUBLIC_*` variable. The anon key is safe in the browser
**only because every table has row level security**, which is what the tests below verify.

## 2b. Apply migration 2 (sites, forms, derived images)

Run `supabase/migrations/20250102000000_sites_forms_derived.sql` in the SQL editor, the same way as the first one
(it must come after the first). It adds:

- `assets.derived_from_asset / derived_op`: so a rotated or cropped image remembers its original on every device.
- `sites`: one published site per project (slug, optional notification email, forms on/off).
- `form_submissions` and the `submit_form()` function: the **only** way a visitor of a published site can store a form
  submission. Visitors have no table access at all. The function validates everything (plain-text fields only, at most 20
  fields, 2000 characters each, 8000 total), drops submissions that fill the hidden "honeypot" field, and limits abuse:
  5 per visitor per 10 minutes and 30 per site per minute. The visitor's address is only ever stored as a per-site salted
  hash. Site owners can read and delete their own submissions; nobody else can read them.

The editor works **before** you apply it (it falls back to the old columns); you just won't get derived-image links or
forms until you do.

Calling it from a page (this is what the published form script will do; it is not wired into the renderer yet):

```
POST {SUPABASE_URL}/rest/v1/rpc/submit_form
apikey: {ANON_KEY}   Content-Type: application/json
{ "p_site_slug": "my-school", "p_form_id": "contact", "p_fields": {"name": "Asha", "message": "Hi"}, "p_honeypot": "" }
```

## 2c. Apply migration 3 (AI credits)

Run `supabase/migrations/20250103000000_ai_credits.sql` after the other two. It adds `ai_jobs`, `credits_ledger`,
`credit_limits` and the functions the AI server uses. Users can only read their own jobs and ledger and call `ai_balance()`;
only the server's service-role key can reserve credits, settle a job, or grant credits. See `docs/ai.md`.

## 2d. Apply migration 4 (limits)

Run `supabase/migrations/20250104000000_quotas.sql` after the other three. It enforces, inside the database, 25 projects per account,
200 MB of media per account and 5000 saved messages per published site, and adds `my_usage()` so the editor can show usage. The editor
works without it (it just shows no usage meters). To change a limit, edit the number in the matching function and run that function again.

## 2e. Account export and deletion

Projects dialog > Your account: **Download all my data** (a .zip of every project, every image and any form messages, built in the
browser from what the signed-in person can already read) and **Delete my account** (type DELETE). Deletion calls `DELETE /api/account`,
which verifies the sign-in, removes the person's stored files, then deletes the auth user; foreign-key cascades remove everything else.
It needs `SUPABASE_SERVICE_ROLE_KEY` on the server; without it the route answers 503 and nothing is deleted.

## 2f. Apply migration 5 (payments)

Run `supabase/migrations/20250105000000_payments.sql` after the other four. It adds the `payments` table (people can read only their own) and
`apply_payment()`, which grants credits **exactly once** per order and only when the amount and currency match what the server recorded.
It is callable only by the service role. See `docs/billing.md`.

## 2g. Apply migration 6 (sharing / collaboration)

Run `supabase/migrations/20250106000000_collaboration.sql` after the other five. It adds `project_members` and `project_invites`, the functions `share_project`,
`claim_invites`, `unshare_project`, `leave_project`, `project_people`, `shared_with_me`, `project_role` and `project_participant`, and the row-level-security rules that let
members read a project (and the pictures it uses) and let editors save it. It also replaces `save_project` so a view-only person gets a clear refusal instead of a fake "conflict".
Until it is applied the editor simply behaves as before (nobody can be given access, and the Share button reports that only owners can do that).

How it works, in one paragraph: the owner shares by email as **editor** or **viewer**. That only creates an *invitation*; the invited person turns it into access themselves by
calling `claim_invites()` after signing in with that email (the editor does this automatically whenever it opens or the Projects window is opened). Because of this, sharing can't reveal whether an
email has an account, and nobody can be added without signing in. Invitations expire after 30 days. At most 10 people per project. Only the owner can share, unshare, delete the project,
publish it, or read its form inbox. Pictures are visible to a member only if the project uses them **and** the picture belongs to someone taking part in that project.

## 3. What is verified, and what is not

| Layer | How it is tested | Status |
|---|---|---|
| SQL migrations 1, 2 and 3 (tables, constraints, RLS, `save_project`, `snapshot_project`, storage policies, sites, `submit_form`) | `packages/db`: runs the real migrations on a real Postgres engine (PGlite) with stubbed `auth`/`storage` schemas. 74 tests across the three migrations: ownership isolation, anonymous denial, concurrent saves, retention, constraints, form validation and rate limits, the site-ownership rule | Verified locally |
| Supabase adapter (`packages/cloud/src/supabase.ts`) | Unit tests against a scripted client: error mapping, validation of returned data, owner id, idempotent uploads, no leaking of raw errors | Verified against a stub only |
| Editor behaviour (sign-in, sync, conflicts, fresh-device open, media sync) | Playwright against the in-memory adapter, which implements the same contract | Verified |
| **Real Supabase** (Auth emails, PostgREST, Storage API, real policies on real `storage.objects`) | **Not run.** No credentials were available while building this | **Needs a smoke test, see below** |

### Automated smoke test against your real project

`scripts/smoke-supabase.mjs` runs 25 checks (plus 12 for sites and forms once migration 2 is applied) with two accounts (saves, conflict rejection, history, image storage,
11 cross-account isolation checks) using only the public anon key, then deletes everything it created and revokes
its two test sessions. It works with Supabase's **default** email sender and templates: no custom SMTP and no
`{{ .Token }}` edit.

```
node scripts/smoke-supabase.mjs run you+a@example.com you+b@example.com
```

Run it in an interactive terminal (in Claude Code: prefix with `!`). It emails a magic link to each address; for each,
right-click the sign-in button in the email, choose **Copy link address** (do not click it; links are single-use), and
paste it at the hidden prompt. The script redeems the link itself, so the editor does not need to be running and your
Site URL / Redirect URLs do not matter. It only ever requests links pointing at your own project's `/auth/v1/verify`
endpoint, and never prints or stores links or tokens. Use two test addresses you control; the built-in sender allows
only a few emails per hour, so if you see a rate-limit message, wait and re-run.

### Manual smoke test (about 10 minutes)

1. Sign in with a real email; the link must arrive and return you to the editor signed in.
2. *Projects > Save to cloud*; check the row in *Table editor > projects*.
3. Edit; `version` should increase and the edit appear in `json`.
4. Open the app in a second browser profile with the same account, edit in both, and confirm the conflict banner appears.
5. Upload an image; check *Storage > assets* has `<your user id>/asset_...` and the `assets` table has a row.
6. With a **second account**, confirm it sees none of the above (projects, assets, storage objects).
7. Run `select * from projects` from the SQL editor as `anon` (`set role anon;`): it must return no rows.

If step 6 or 7 shows another user's data, stop and fix the policies before going further.

## 4. Known gaps (do these before a public launch)

- **Server-side validation and image checks: done in `@avc/publisher`** (see `docs/publishing.md`). The database still only
  checks basic shape, so **a publish server must call `buildSite` and never serve a stored project directly**.
  Asset bytes are re-verified (type by magic bytes, size, SHA-256) at publish time. Still missing: re-encoding on upload
  server-side and moderation/malware scanning (spec 15.3).
- **Quotas and rate limits.** None yet (storage per user, projects per user, AI credits).
- **Forms are not wired into published pages yet.** The database side (`submit_form`) is built and tested, but the
  published form block still submits nowhere: it needs a small platform-owned script (a new hash in the CSP, and
  `connect-src` for your Supabase URL), a published site record, and email delivery of submissions (an Edge Function
  or a queue; the built-in sender is not suitable). Old submissions are not purged automatically; add a scheduled
  delete (for example after 90 days) to match your privacy policy.
- **Alt text** syncs between devices, but there are no timestamps: if two devices describe the same image differently, the
  last device to sync wins.
- **Realtime** is not used; two tabs find out about each other's changes on the next save (conflict banner).
- **Account deletion / data export** (privacy law, spec 15.4) is not implemented.

## 5. Publishing

Building the site is done (`docs/publishing.md`). Deploying it from the product (a Publish button) is not: it needs a
Cloudflare account + API token on a server, a `sites` table and a queue.
