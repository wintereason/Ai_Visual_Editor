# AI Visual Creator: what it is, how it works, and which AI agents do what

## 1. What it does
A web app where someone with no coding skill designs and publishes a website or an installable mobile app by **dragging things onto a canvas**, with **AI help** when they want it.

- **Start** from a template (schools, coaching, college, online academy, preschool, plus two starter mobile apps), mix pages from different templates, or start blank.
- **Build** with drag and drop: 20+ blocks (hero, pricing, FAQ, forms...), basic elements, 26 shapes, 49 icons, charts, tables, photo-layer compositions, app screens (header, tab bar, lists), 60+ ready-made sections, backgrounds, colour palettes and font pairs, animations, and a brand kit (name, logo, saved colours and fonts).
- **Edit** per device (desktop, tablet, phone), with undo/redo, history, and non-destructive image edits.
- **Use AI** (optional, paid in credits): rewrite one element, create a small component from a sentence, plan and build a whole site from a brief, or take a theme from a picture.
- **Publish**: download a zip, or publish to the user's **own** Cloudflare account; custom domains, contact-form inbox, optional cookie-less analytics, and an installable-app (PWA) build with offline use.
- **Collaborate**: share a project with up to 10 people as editors or viewers.
- **Pay**: buy AI credit packs with Razorpay.

## 2. How it works (the main idea)
**The whole project is one JSON document** (`@avc/schema`): pages, a tree of nodes, a theme, a brand kit, app settings. Everything else reads or changes that document.

```
 person ──drag/click──┐
 AI agent ──proposes──┼─► PATCH (max 20 operations) ─► validated against the registry ─► new project JSON
 template/mix ────────┘                                        │ rejected? nothing changes
                                                              ▼
                              renderer ─► canvas preview (editor)  and  static HTML/CSS (published site)
```

- **One write path.** Every change, by hand or by AI, is a *patch* checked by the same rules (allowed block types, allowed props, allowed style keys, valid links). Invalid changes are refused, never half-applied. That is what makes AI safe to let loose: it can only propose patches.
- **Undo** is a stack of earlier project documents, so any change, including an AI one, is one undo step.
- **Renderer** (`@avc/renderer`) turns the JSON into plain HTML and CSS. No framework runs on the published site; only small, fingerprint-allowed scripts for animations and forms.
- **Publisher** (`@avc/publisher`) builds the site files: re-verifies every image from its bytes, adds SEO tags, a strict Content Security Policy, security headers, sitemap, and (for apps) manifest, icons and an offline worker. Deterministic: same input, same files.
- **Cloud** (`@avc/cloud`): sign in by emailed link (Supabase), projects and images saved per account with row-level security, versions history, optimistic concurrency (two saves can't silently overwrite each other), sharing by invitation.
- **Billing** (`@avc/billing`): Razorpay orders; credits are granted exactly once per verified payment.
- **Where code runs.** Browser: editor, rendering, building exports. Server (Next.js routes): AI calls (the API key never reaches the browser), publish to Cloudflare (the user's token is used once and never stored), payments, account deletion. Database: Supabase Postgres with security rules enforced by the database itself.

## 3. The AI agents: what each is for
"Agent" here means **one focused AI job**: a prompt built from the schema's own registry, a call to a Claude model, and a strict check of what comes back. None of them acts on its own; each produces a *proposal* that is validated before anyone sees or applies it.

| Agent | Where the user meets it | What it receives | What it may return | Guard rails |
|---|---|---|---|---|
| **Patch agent** (element prompt) | AI tab: "make this heading shorter", "change this to a 3-column grid" | The selected element, its theme and a short context | A patch limited to that element's own subtree | Scope-checked: it cannot touch anything outside the selection; max 20 operations; instruction capped at 1000 chars |
| **Element creator** | Create > element | A sentence (max 600 chars) | Up to 3 small component options (a node tree each), shown as previews | Each option validated; the user picks one to insert |
| **Layout agent** (Agent 1) | Create > site | A brief: what the site is for, optional style (minimal / bold / playful / corporate), pages, language | A *structure only*: up to 8 pages, 12 sections per page, 160 nodes | Shown to the user to **approve and edit** before any content is written |
| **Build agent** (Agent 2) | Create > site, after approval | The approved structure, one page at a time | The page filled with real content | Must keep the approved structure (checked by a structure signature); pages build one by one with live progress; a failed page can be retried alone without redoing the others |
| **Style agent** | Create > style from a picture | A picture (re-drawn as a JPEG in the browser; verified by its first bytes; max 4 MB; SVG refused) | A **theme only**: six colours, two fonts from our list, corner roundness, motion | Colours checked for readable contrast; applies as one undoable step; content and structure are never touched |
| **Moderator** | Invisible: wraps every AI request | The person's words, then the AI's answer | allow / refuse by category (hate, sexual, violence, self-harm, illegal, harassment, deceptive, spam) | Uses a second, small model call; **fails closed** (if it can't decide, nothing is returned and nothing is charged); a flagged request is not charged and the flagged text is never echoed |

**Shared machinery around all of them (plain code, not AI):**
- **Validate-and-retry loop.** If the model's answer fails validation, the exact errors are sent back and it tries again (a few attempts), otherwise the request fails cleanly.
- **Credits.** Reserve before the call, settle after, refund on failure; only the server can change balances.
- **Streaming progress** to the screen while a site builds.
- **Provider abstraction.** The agents talk to an interface, so the model can be changed without touching them. Today it speaks to Anthropic's Claude models. Which model runs each job is set by configuration (`AI_MODEL`, `AI_MODERATION_MODEL`) and is **meant to be chosen from the cost-and-quality evaluation (`npm run eval -w @avc/ai`), which has not been run yet.**
- **Limits:** rate limits, size limits, and a server-side check that images really are images.

## 4. What is NOT AI
Drag and drop, templates, mixing pages, the style panel, image edits (rotate, crop, brightness...), animations, charts, backgrounds, palettes, publishing, sharing, and billing are all ordinary deterministic code. AI is an optional layer on top; the product works fully without it.

## 5. Honest status
- Built and tested: everything above except as listed here.
- Tested only against stand-ins (not yet against the real services): Claude (including pictures and moderation), Razorpay, Cloudflare custom domains and analytics, and the sharing/payments database migrations on your real Supabase. Real Cloudflare publishing is confirmed working.
- Not built: automatic photo cut-outs (needs a hosted model), email notifications, real-time co-editing, native app-store apps, image generation, subscriptions.
- See `docs/` for details: `ai.md`, `backend.md`, `billing.md`, `publishing.md`, `editor.md`, `mobile.md`.
