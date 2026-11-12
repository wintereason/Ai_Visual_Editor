# Publishing

`@avc/publisher` (`packages/publisher`) turns a project and its images into the exact files to host. It is pure and
deterministic and runs the same in the browser (the editor's **Export** button) and on a server, so what you preview and
export is what a server would publish.

```ts
import { buildSite } from "@avc/publisher";

const result = await buildSite(projectJson, [{ asset, bytes }, ...], { baseUrl: "https://school.example.com" });
if (!result.ok) throw new Error(result.errors.join("\n")); // nothing is produced on failure
// result.files: Record<path, Uint8Array>   result.manifest: pages, assets, warnings, buildHash
```

## What it checks before producing anything

1. **Full registry validation** of the project (unknown blocks, bad props, disallowed styles, unsafe URLs, embeds outside
   the allow-list). This is the server-side check the database cannot do.
2. **Pre-publish lint errors** block the build (missing alt text, missing image source, no home page, files no longer in
   the media library). Warnings (no SEO title, dead internal links) are returned in `manifest.warnings`.
3. **Every published image is verified from its bytes**, not from its recorded metadata: size, magic-byte type (SVG,
   HTML or script labelled as `.png` is rejected), type label, and SHA-256 against the recorded hash. One bad image
   fails the whole build.
4. A supplied site address must be a full `https` URL.

## What it produces

| File | Purpose |
|---|---|
| `index.html`, `<path>/index.html` | One standalone page per project page, with title, description, canonical, Open Graph tags |
| `assets/<hash12>.<ext>` | Only images the site uses, content-addressed so they can be cached forever |
| `404.html` | Not-found page (`noindex`) |
| `_headers` | Security headers + immutable caching for `/assets/*` (Cloudflare Pages / Netlify format) |
| `robots.txt` | Allow all; points at the sitemap when an address is given |
| `sitemap.xml` | Only when a site address is given |

**Security headers (spec 15.1):** a deny-by-default Content-Security-Policy. The only inline script allowed is the
platform's own animation runtime, by SHA-256 hash. Also: no `unsafe-eval`, no `unsafe-inline` for scripts, `frame-src`
limited to the embed allow-list (generated from the same list the validator uses, so they cannot drift),
`frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. The same policy is
also in each page's `<meta>` so it still applies on hosts that ignore `_headers`.

Verified in a real browser (`apps/editor/e2e/publish.spec.ts`): a built site loads its images and runs its scroll
animation under its own CSP with zero violations, while an injected inline script, an inline event handler, a
`javascript:` link and a foreign iframe are all blocked.

## Contact forms

Export > Contact form delivery: choose a site name (3 to 40 lowercase letters, digits, hyphens; unique across the platform), keep
"Deliver form messages to my inbox" ticked, and the exported pages carry a small script (allowed by its SHA-256 hash in the CSP, plus
`connect-src` for your backend only) that posts to the database function `submit_form` with the public anon key. A service-role key is
refused by the build. Without a site name, the build warns that forms will not deliver.

## One-click publish to your own Cloudflare account

Export > Publish to Cloudflare. The person pastes their Cloudflare **Account ID** and an **API token** (permission: Account > Cloudflare Pages > Edit) and
a project name; the site goes live at `<project>.pages.dev` in THEIR account. Their token is sent once, in a request header, to our
`/api/publish`, used for that one deployment and discarded: it is never stored on the server, never logged, never placed in an error message, and
is only kept in the browser if they tick "Remember until I close this tab" (sessionStorage, not long-lived storage). Only signed-in people can
use the endpoint and it is rate limited (6 per minute), so it can't be used as an open proxy.

How it works (the same steps wrangler performs): create the project if needed, get a short-lived upload token, ask Cloudflare which files it lacks,
upload those (batched), register the hashes, create the deployment with a manifest plus `_headers`, wait for it to finish, then **fetch the live
pages to confirm they load**.

**Verification status:** a real publish to a real Cloudflare Pages account has been reported working by the project owner (2026-11-10). The automated tests still run against a fake of the service, so a change in Cloudflare's undocumented upload protocol would only show up in a real publish or in the live-site check described below. Originally this was built from Cloudflare's documentation and consistent third-party descriptions of the protocol and tested
against a strict fake of the service, NOT against the real Cloudflare. The file hash (BLAKE3 of the base64 text plus the extension, cut to 32 hex
characters) is not in Cloudflare's official docs, and a wrong hash is accepted silently and then 404s. That is why the final step checks the live
site and says plainly when pages don't load. Do one real publish before relying on it. If it reports "published but the pages didn't load", use the
.zip and tell us.

## Deploying (Cloudflare Pages)

The output is a plain static folder, so any static host works. With Cloudflare Pages:

1. Write `result.files` to a directory (the Export button gives a `.zip` of the same files).
2. `npx wrangler pages deploy <dir> --project-name <site-slug>`.
3. Custom domains are attached in the Cloudflare dashboard (or API). **[VERIFY]** current limits and pricing first.

Automating this from the product (a Publish button that deploys for the user) needs a Cloudflare account and API token
held on a server, plus a `sites` table and a publish queue. That is the next step and is not built yet.

## Known limits

- Image **dimensions** are recorded at upload but not re-derived from the bytes at publish time.
- Not scanned for malware or moderated (spec 15.3); only structurally verified.
- **Contact forms deliver to an in-app inbox, not to email.** Email notifications need an email provider (SMTP/API key) and are not set up. Visitors who submit see a thank-you message; you read messages in Export > Contact form delivery > View messages.
- Form delivery needs migration 2 applied and the project saved to your account (Projects > Save to cloud). The public submit function is rate limited (30 per minute per site, 5 per 10 minutes per visitor) and drops submissions that fill the hidden honeypot field.
- The CSP allows any `https:` image/media source, because owners may link external images. Tighten this if you decide
  to require uploads only.
- Web fonts are not loaded, so theme fonts fall back to system fonts unless installed on the visitor's device.
