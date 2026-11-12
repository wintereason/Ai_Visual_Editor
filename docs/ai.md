# AI features

`@avc/ai` (`packages/ai`) adds AI editing to the editor without giving the model any special power. A model can only
propose a **patch**, and a patch is accepted only if it passes the same validator and scope guard as a human edit.

## What exists

| Piece | What it does | Verified how |
|---|---|---|
| **Element prompt** (editor: right panel > AI) | Describe a change to the selected element; the model returns a patch limited to that element | Unit tests (adversarial) + browser tests against a mocked server |
| **Element Creator** (`runElementCreator`) | Prompt -> up to 3 component trees built from existing blocks | Unit tests + browser tests. UI: left panel > ✦ Create > An element (3 sandboxed previews, Add to page) |
| **Layout agent** (`runLayoutAgent`) | Brief -> pages, sections, blocks, theme (with a contrast check) | Unit tests + browser tests. UI: ✦ Create > A whole site (design, review and edit the layout with page previews, approve) |
| **Build agent** (`runBuildPage` / `runBuildAll`) | Writes real copy for an approved structure; rejected unless the structure signature is unchanged | Unit tests (9 kinds of structure violation) + browser tests. UI: per-page progress, retry a failed page alone, stops on no credits; applying is undoable |
| **Registry-generated prompt** (`systemPrompt`) | The model is told exactly what the validator accepts, generated from the same registry, so they cannot drift | Unit tests |
| **Credits** (`CreditsStore`, migration 3) | Reserve before, charge only on success, tokens logged per job, daily cap | 74 SQL tests on real Postgres (PGlite) + unit tests |
| **Live progress** (`handleAiStream`, NDJSON) | Browser sees asking / checking / fixing-and-retrying as they happen; the final result is the last line | Unit tests + browser tests through the real route against a fake model server |
| **HTTP layer** (`handleAiRequest`, `/api/ai/<patch|element|layout|build_page>`) | Auth, validation, rate limit, charging, safe errors | 60 unit tests |
| **Evaluation harness** (`npm run eval -w @avc/ai`) | 37 prompts (English, Hindi, Marathi) incl. 6 injection attempts; reports valid / correct / first-try rate, retries, tokens, dollars | Self-tested offline (references pass their own checks) |

## What has NOT been verified: the real model

**No API key was available while building this, so nothing has run against a real model.** The Claude provider
(`AnthropicProvider`) is written to the documented Messages API and tested against a stubbed `fetch` only. Everything else is
verified with a scripted model that returns exactly what the test says. That proves the guards, the accounting and the UI
behave correctly *given* any model output; it says nothing about how good a real model's output is.

Before trusting it, run the live evaluation (below) and read the numbers.

## Safety checks (moderation)

Every AI request is checked twice by a second, small model call (`AI_MODERATION_MODEL`, default a Haiku-class model): the person's words
before the main model runs, and the AI's answer before it is returned. A flagged request or answer is refused with a generic message
(the flagged text is never echoed) and **is not charged**. It **fails closed**: if the check can't run or its reply can't be understood, nothing is
returned and nothing is charged. Limits worth knowing: it is a classifier, not a guarantee; it can be wrong in both directions; text written to
manipulate a classifier is a known weakness (it is told to treat the text strictly as data and only a fixed JSON shape is accepted); and it
checks text, not the pixels of a picture. It costs a little extra per request and is logged in the job's token usage. Switch off only
deliberately, with `AI_MODERATION=off`.

## Style from a picture

Create panel > Style from a picture. The browser shrinks the chosen image to 1024 px and re-draws it as a JPEG (this removes hidden metadata such as
location), the server verifies it is really a PNG/JPEG/GIF/WebP by its first bytes (SVG is refused because it can carry scripts) and is under 4 MB,
and the model proposes only a **theme** (six colours, two fonts from our list, corner roundness, motion), validated like every other output
including readable contrast. Applying it is one undoable step; content and structure are never touched. It is billed as a layout-sized request.
Verified against a scripted and a fake model only, like the rest of the AI features.

## Setup

1. Apply `supabase/migrations/20250103000000_ai_credits.sql` (after migrations 1 and 2; migration 4 adds account limits).
2. Server environment (**never** `NEXT_PUBLIC_`): add to `apps/editor/.env.local`
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   AI_MODEL=<model id>
   SUPABASE_SERVICE_ROLE_KEY=<service role key from Settings > API>
   ```
   The service-role key lets the server verify sign-ins and charge credits. It bypasses row-level security, so it must exist
   only on the server. After every build run `node scripts/check-secrets.mjs`: it scans the files sent to browsers and fails if
   a secret, a key name or a server-only credits function name is in them.
3. Give a user credits (SQL editor; nothing else can do this):
   `select grant_credits('<user uuid>', 50, 'welcome');`
4. Without Supabase configured, development uses in-memory credits (100 per new user) and accepts the mock backend's tokens
   outside production only.

## Measuring a real model (spends money)

```
ANTHROPIC_API_KEY=sk-ant-... AI_MODEL=<id> EVAL_CONFIRM=yes npm run eval -w @avc/ai
# options: EVAL_ONLY=edit|injection|element|layout  EVAL_LIMIT=5  PRICE_IN=<$/M input tokens>  PRICE_OUT=<$/M output tokens>  EVAL_MIN_VALID=0.9
```
It writes `packages/ai/evals/last-report.json`. The spec (10.4) says to set pass thresholds only after the first
measurements. Look at: valid rate, **correct** rate (valid but wrong is the interesting failure), first-try rate (retries cost
money), and the injection category (anything below 100% "untouched outside the selection" would be a real safety finding).
Prices are never built in; copy them from the provider's pricing page.

## Security model

- **A model can only propose patches.** Output must parse as JSON, match the patch schema (at most 20 operations), apply to the
  project, and leave it valid. A **scope guard** limits an element prompt to the selected node and its descendants: it cannot
  touch other nodes, the theme or the page list, and cannot delete or move the selected node itself.
- **The browser re-checks the server's patch** with the same scope guard before applying it, so even a compromised or buggy
  server cannot change anything outside the selection. (Browser tests include 11 hostile responses.)
- **User text is data.** It sits inside `<instruction>` tags, our own delimiter tags are stripped from it, control characters are
  removed, and the system prompt says to ignore instructions found there. This is a mitigation, not a guarantee; the real
  defence is that the guards above hold even when the model is fooled. Tests prove it with a "gullible" model that obeys every
  attack.
- **Minimal data leaves the browser.** Only the current page is sent, and only the selected node, its parent and the theme go
  to the model. Other pages and sections are never sent. Logs contain job metadata only, never prompts or content.
- **No raw errors.** Provider messages, keys, SQL errors and stack traces never reach the client; each failure maps to a fixed,
  friendly message.
- **Credits cannot be dodged from a browser.** Only the server (service role) can reserve or settle; users can read only their own
  balance. Reservations count against the balance immediately (parallel requests cannot overspend), failures are never charged,
  settling twice never charges twice, and a reservation abandoned for 10 minutes stops holding credits. There is also a daily cap
  per user (default 40 credits) and a per-minute request limit.

## Known limits and next steps

- **Progress is stage-level, not word-by-word.** The browser sees live steps (asking, checking, fixing, try 2 of 3) per page, but the model's text is not streamed token by token: each page needs complete, valid JSON before it can be checked, so partial text would not be usable. The Create UI is verified against a fake model server (`apps/editor/e2e/fake-anthropic.mjs`), not a real model.
- **Layout review** lets you rename and remove pages and reorder or remove sections. It cannot add new pages or sections (design again, or add blocks after applying), and the home page cannot be removed.
- **Rate limiting is per server instance** (in memory). Behind several instances, use a shared store.
- **Prompt caching** is not used. The system prompt is about 12 KB and is sent with every request; with a provider that supports
  caching this is the first cost to cut.
- **If settling fails after a good answer** (database down) the user still gets the result and is not charged; the reservation
  expires on its own. That favours the user; watch the `settle_failed` log events.
- **Moderation of generated text** is not implemented; text is rendered escaped, but nothing screens for harmful content.
- **Image generation, vision (screenshot to blocks) and photo layers** (spec Phase 5) are not started.
