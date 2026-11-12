# Drag-and-Drop Frontend Design Platform: Final Project Specification

**Working title:** [Project Name]
**Document status:** v1.0, planning stage (no code beyond the schema prototype exists yet)
**Companion files:** `schema.ts`, `apply-patch.ts`, `example-project.json`, `example-patch.json` (prototype v1, see section 9.9 for its known limits)

---

## 0. How to read this document (important)

Every claim in this document carries one of these labels. Treat them differently.

| Label | Meaning | What you should do |
|---|---|---|
| **[DECIDED]** | A design decision made in this document | Change it only deliberately |
| **[ESTIMATE]** | My best estimate. Not measured, not market data | Re-estimate after Phase 0; expect wide error |
| **[TARGET]** | A goal to aim for, not a prediction | Use as an acceptance criterion |
| **[VERIFY]** | A fact or assumption not confirmed here | Confirm before depending on it |
| **[CHECKED]** | Confirmed by a web search while writing this document | Still re-check before committing money |

### Corrections to earlier messages in this conversation

These earlier statements were wrong, too optimistic, or incomplete. This document replaces them.

1. **"MVP in 2-3 months"** was optimistic. Section 17 gives a revised range with the assumptions behind it.
2. **"Start with Craft.js or GrapesJS"** was too casual. Both bring their own internal state model that conflicts with the JSON schema here, and Craft.js showed weak maintenance signals in the checks made for this document (section 12.2). This document recommends a custom editor on dnd-kit instead.
3. **The v1 `Style` schema (7 properties)** is too thin for a "professional" style panel. Section 9.3 defines v2.
4. **The v1 schema mixes "elements" and "blocks"** in one registry. v2 separates them (section 9.2).
5. **The v1 patch applier cannot unset a style key** and replaces array props wholesale on update. Section 9.9 lists these and other limits.

### Pre-build checklist: things this document cannot decide for you

Answer these before writing code. They change the plan.

1. **Who is the first user?** Pick one niche. The plan assumes education or local businesses in India **[DECIDED, changeable]**.
2. **Team size.** All timelines assume 2-3 experienced full-stack developers. A solo developer should multiply by roughly 2-3 **[ESTIMATE]**.
3. **Who designs the templates?** Template quality decides first impressions. If nobody on the team can design well, budget for a designer.
4. **Budget for AI and storage.** Section 18 gives a method to calculate it, not numbers.
5. **Legal review** of terms, privacy and upload rules before public launch (section 15.4).

---

## Table of contents

1. Product definition
2. Feature inventory and phase map
3. Content inventory: templates, elements, blocks, animations
4. Core concepts and layout model
5. Master algorithm (user journey)
6. Complete wireframes (W01-W26)
7. Style panel specification
8. Drag-and-drop specification
9. Data model
10. AI system
11. Element Creator and image intelligence
12. Architecture and tech stack
13. API surface
14. Database schema
15. Security, privacy and legal
16. Performance, accessibility and quality targets
17. Roadmap, team and effort
18. Cost model and monetization
19. Risks
20. Testing strategy
21. Success metrics
22. Glossary

---

## 1. Product definition

### 1.1 One-line description
An online visual design platform where people with no frontend knowledge build professional web (and app-style) frontends using drag-and-drop, templates, or AI, with photos, video and animation, and then publish them.

### 1.2 Three ways to build, one project
| Mode | How it starts | Result |
|---|---|---|
| **Custom** | Blank canvas | Everything placed by hand |
| **Template** | Topic-wise templates, mixed page by page | Pre-designed starting point |
| **AI** | Text prompt, then approve a layout, then AI builds | Full site in editable blocks |

All three produce the same thing: one **project JSON document**. A user can switch between modes at any time. Manual editing, AI generation and element-level prompts are only three ways of changing that one document **[DECIDED]**.

### 1.3 Target users
| User | Need |
|---|---|
| Small business owners | Website without hiring a developer |
| Schools, colleges, coaching centers | Admissions, courses, events pages |
| Students and freelancers | Portfolio and project sites |
| Agencies (later) | Fast first drafts for clients |

### 1.4 Differentiators (and honest limits)
| Claim | Honest limit |
|---|---|
| AI output is editable blocks, not a code dump | Only as good as the block library; the AI cannot make things the library cannot express |
| Two-step AI with approval before the expensive build | Adds a step; some users want one click |
| Element-level prompting on a selected element | Competitors may offer similar; execution quality decides |
| Functional blocks (WhatsApp, forms, booking) for small businesses | Forms and bookings require backend work (spam, email delivery) |
| Regional-language content for India | Needs native-speaker review; machine translation alone is not enough |

**Competition exists and is strong.** Webflow, Framer, Wix, Figma, Builder.io, Bubble, and prompt-based tools (v0, Lovable, Bolt) overlap with large parts of this idea **[CHECKED earlier in conversation; re-check current features before positioning]**. The plan survives only through a narrow niche and finishing a smaller scope well.

### 1.5 Non-goals (first version)
- Pixel-perfect free-form positioning everywhere (section 4.1)
- Native iOS/Android app output
- Real-time multi-user collaboration
- E-commerce checkout with inventory
- Arbitrary custom code (JavaScript) in sites

---

## 2. Feature inventory and phase map

| # | Feature | Phase | Notes |
|---|---|---|---|
| F1 | Platform choice (Web / Mobile / Web+Mobile) | 1 | Mobile = app-style frame + blocks; output is responsive web/PWA first |
| F2 | Template gallery (topic-wise) | 2 | Mix pages and sections across templates |
| F3 | Drag-and-drop blocks and elements | 1 | Section 8 |
| F4 | Style panel (simple + advanced, per device, hover) | 1 | Section 7 |
| F5 | Animation presets | 2 | Section 3.4 |
| F6 | Undo/redo, autosave | 1 | Patch-based history |
| F7 | Multi-page projects | 2 | |
| F8 | Media upload, per-user storage | 2 | Section 11.2 |
| F9 | Non-destructive image editing | 2 | Section 11.2 |
| F10 | Element-level AI prompt | 3 | Patch agent |
| F11 | Element Creator (prompt to small component) | 3 | Tier A first |
| F12 | Style-reference from image | 3 | Section 11.3 |
| F13 | AI two-step full generation (Agent 1, approve, Agent 2) | 3-4 | Section 10 |
| F14 | Publish to subdomain | 1 (basic) / 4 (full) | |
| F15 | Custom domain, code export | 4 | Paid |
| F16 | Version history | 2 | |
| F17 | Image to elements (screenshot) | 5 | Hard, optional |
| F18 | Photo to layers (segmentation) | 5 | Optional, GPU cost |
| F19 | Brand kit, translation agent, collaboration, native mobile | 5+ | |

---

## 3. Content inventory: templates, elements, blocks, animations

All counts below are **[ESTIMATE]/[DECIDED] proposals**, not market benchmarks. They are sized for a small team.

### 3.1 Definitions
| Term | Meaning | Example |
|---|---|---|
| **Element** | Smallest unit; cannot contain other elements (except layout containers) | Heading, button, image |
| **Block** | Compound, pre-designed section made of elements, with variants | Hero (split), Pricing (3 cards) |
| **Section preset** | A saved block arrangement, extracted from templates | "Hero + features" |
| **Page template** | A full page made of sections | Home, About |
| **Full-site template** | Multi-page project in one topic | "Coaching Institute" |

### 3.2 Count table
| Item | MVP | Version 1 | Later |
|---|---|---|---|
| Full-site templates | 5 (one niche) | 24 (6 topics x 4) | 60+ |
| Page templates | 15 (from the 5) | about 96 (extracted) | 300+ |
| Section presets | about 30 (extracted) | about 120 (extracted) | 300+ |
| Elements | 12 | about 20 | 30+ |
| Block types | 12 | about 40 | 60+ |
| Block variants | about 30 | about 100 | 200+ |
| Animation presets | 8-10 | about 28, plus 30 curated Lottie files | 40+ |

Page templates and section presets are **extracted from full-site templates**, so designers only build full sites.

**Design effort for templates [ESTIMATE]:** roughly 3-5 designer-days per polished, responsive, multi-page template. 24 templates is therefore about 3-4 months of design work. Prefer fewer, better templates.

### 3.3 Elements
**MVP (12):** heading, text, button, image, video, icon, divider, spacer, link, input field, list, embed (map or YouTube).
**Version 1 adds (about 8):** shape, gradient box, avatar, badge, textarea, select/checkbox, svg (sanitized), lottie.

### 3.4 Blocks (Version 1, about 40 types)
| Category | Count | Block types |
|---|---|---|
| Navigation | 4 | Navbar, mobile bottom nav, sidebar, breadcrumb |
| Hero | 6 | Centered, split, video background, with form, minimal, announcement hero |
| Content | 8 | Feature grid, split content, timeline, stats, steps, FAQ, tabs, logo strip |
| Listings | 5 | Course/product cards, team, blog list, gallery, pricing |
| Social proof | 3 | Testimonial, reviews, counters |
| Forms and actions | 6 | Contact, newsletter, booking, WhatsApp button, payment link, login |
| Media | 3 | Video section, carousel, lightbox |
| Footer | 3 | Simple, columns, with newsletter |
| Misc | 2 | Map, announcement bar |

Mobile projects also need about 10 app-style blocks (bottom tab bar, app header, list cell, bottom sheet, card list, segmented control, floating action button, search bar, profile header, settings list) **[ESTIMATE]**.

### 3.5 Animation presets (Version 1, about 28)
| Group | Count | Presets |
|---|---|---|
| Entrance | 8 | Fade, slide (4 directions), zoom, rotate, blur-in |
| Scroll | 5 | Parallax, reveal, pin, progress bar, counter |
| Hover | 6 | Lift, glow, scale, tilt, color shift, underline |
| Attention | 3 | Float, pulse, marquee |
| Text | 3 | Typewriter, word-by-word, gradient shimmer |
| Page transition | 3 | Fade, slide, wipe |

Rules **[DECIDED]**:
- Animate only `transform` and `opacity` where possible (smooth on phones).
- Respect `prefers-reduced-motion`: disable or simplify all animation.
- Load the Lottie runtime only on pages that use a Lottie animation.
- Every extra preset multiplies cross-device testing.

---

## 4. Core concepts and layout model

### 4.1 Layout model [DECIDED]: structured flow, not absolute positioning

```
Project
 └─ Page
     └─ Section            (full-width band; top-level only)
         └─ Container      (row / column / grid; nestable)
             └─ Block or Element
```

**Why not free-form absolute positioning everywhere:**
1. It breaks on small screens.
2. AI patches become unreliable (coordinates instead of structure).
3. Templates cannot be merged cleanly.

**Cost of this choice:** users cannot place things pixel-perfectly, and some will ask for it. The controlled exception is `layerGroup` (section 11.4): a fixed-aspect container whose children are absolutely positioned and scale together. It is allowed only for image-layer compositions.

### 4.2 One source of truth
```
        Project JSON  (single source of truth)
          ▲        ▲          ▲
   Manual edits  AI agents  Element prompts
          └──── all changes are PATCHES ────┘
```
Every change, human or AI, is a patch applied by one function (`commit`). That is why undo, autosave and AI edits share one history **[DECIDED]**.

### 4.3 Breakpoints [DECIDED]
Desktop-first cascade (like most visual builders): `base` (desktop), `tablet`, `mobile`. A property set on `tablet` overrides `base` at tablet width and below; `mobile` overrides both at mobile width and below. Default widths **[VERIFY against your analytics]**: tablet 1024 px and below, mobile 640 px and below.

---

## 5. Master algorithm (user journey)

```
STATE: project (JSON), history[], redoStack[], selection, breakpoint, mode

──────────────── 1. START ────────────────────────────────────────────
login → dashboard                                 SEES: project cards, credits, storage
on [New Project]:
    platform = choose(web | mobile | web+mobile)   SEES: 3 cards
    project  = emptyProject(platform)              // default theme, 1 empty page
    mode     = choose(custom | template | ai)

──────────────── 2. BRANCH BY MODE ───────────────────────────────────
CUSTOM:
    goto EDITOR                                    SEES: blank canvas + block panel

TEMPLATE:
    topic = choose(topic)                          SEES: gallery
    if whole template:
        project = clone(template, freshIds)
    else:  // mix
        for slot in [Home, About, Courses, Contact]:
            project.pages.add(clone(chosenPage(slot), freshIds))
    goto EDITOR

AI:
    input = {prompt, style, pages, language, brandLogo?, referenceImage?}
    if user has credits < estimatedCost(input): show upgrade or reduce scope; stop
    draft = Agent1(input, registry)                SEES: "designing layout..."
    loop:
        res = validate(draft)
        if invalid:
            if retries < 3: draft = Agent1.fix(draft, res.errors); continue
            else: show friendly failure + [Try again] [Start from template]; stop
        show renderedPreview(draft), variants A/B/C      SEES: layout preview
        action = user chooses:
            approve      → break
            refine(sec)  → draft = Agent1.refine(draft, sectionId, text)
            regenerate   → draft = Agent1(input)
            edit by hand → project = draft; goto EDITOR
    signature = structureSignature(draft)          // lock approved structure
    for page in draft.pages:                       SEES: page-by-page build
        built = Agent2(page, input, theme)
        if structureSignature(built) != signature(page): reject, retry (max 3)
        validate(built), retry (max 3)
        project.pages.add(built)
    optional: patches = Reviewer(project); apply those the user accepts
    goto EDITOR

──────────────── 3. EDITOR LOOP ──────────────────────────────────────
render(project, breakpoint)
on event:
    click element              → selection = id
    drag and drop              → commit(patchFromDrop)
    style / props change       → commit(update)
    inline text edit           → commit(update), debounced 500 ms
    choose animation           → commit(update animation)
    upload / drop image        → upload flow (11.2), then commit(insert | update)
    element prompt (text)      → ctx = {theme, node, parent}
                                 patch = PatchAgent(text, ctx, registry)
                                 try commit(patch, scope = selection)
                                 catch err → PatchAgent.fix(err), max 2 retries
                                 SEES: summary + [Undo] [Keep]
    element creator            → section 11.1
    undo / redo                → move one snapshot between stacks
    device switch              → breakpoint changes; edits write breakpoint overrides

commit(patch, scope?):
    next = applyPatch(project, patch, scope)       // schema + registry + scope guard
    history.push(project); redoStack.clear()
    project = next
    render(project); autosaveDebounced(project, version)

──────────────── 4. PUBLISH ──────────────────────────────────────────
checks = [alt text, contrast, mobile layout, broken links, empty required fields]
SEES: checklist with [Fix automatically] for fixable items
if fix: commit(patch per issue)
site = renderStatic(project)                        // JSON → HTML/CSS/minimal JS
deploy(site) → URL                                   SEES: live link
optional: export(project, html | react)
```

Two details matter most:
- **`structureSignature`** compares approved structure (page list, section order, block types and variants) with Agent 2's output. Without it the AI can silently change what the user approved.
- **`commit`** is the only write path. Do not add side doors.

---

## 6. Complete wireframes

Notation: `[ ]` button, `( )` option, `▾` dropdown, `▸` more, `░` image placeholder, `⊕` drop zone. View in a monospace font.

### W01. Dashboard
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Logo]  Projects   Templates   My Elements   Assets      AI 42/100  [👤▾]│
├──────────────────────────────────────────────────────────────────────────┤
│  My Projects                  [Search______]  Sort: [Recent ▾] [+ New]   │
│                                                                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│  │ ░░░░░░░░░░ │ │ ░░░░░░░░░░ │ │ ░░░░░░░░░░ │ │            │             │
│  │ ░ thumb ░░ │ │ ░ thumb ░░ │ │ ░ thumb ░░ │ │     +      │             │
│  ├────────────┤ ├────────────┤ ├────────────┤ │  New       │             │
│  │ School Site│ │ Cafe Menu  │ │ Portfolio  │ │  project   │             │
│  │ Web · Draft│ │ Mobile·Live│ │ Web · Live │ │            │             │
│  │ 2h ago  ⋯  │ │ 1d ago  ⋯  │ │ 5d ago  ⋯  │ │            │             │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘             │
│  Storage: [██████░░░░] 1.2 / 2 GB                    Plan: Free [Upgrade]│
└──────────────────────────────────────────────────────────────────────────┘
```
Menu `⋯`: Rename, Duplicate, Download JSON backup, Delete (with confirm).

### W02. New project, step 1: platform
```
┌──────────────────────────────────────────────────────────────────────────┐
│  New Project                                                  Step 1 / 3 │
│  What are you building?                                                  │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐            │
│  │   ┌────────┐   │   │      ┌──┐      │   │  ┌────────┐┌─┐ │            │
│  │   │  Web   │   │   │      │  │      │   │  │  Web   ││ │ │            │
│  │   └────────┘   │   │      └──┘      │   │  └────────┘└─┘ │            │
│  │      Web       │   │     Mobile     │   │  Web + Mobile  │            │
│  │ Responsive site│   │ App-style UI   │   │ Two layouts,   │            │
│  │                │   │ (PWA output)   │   │ one project    │            │
│  └────────────────┘   └────────────────┘   └────────────────┘            │
│        ( • )                (   )                (   )                   │
│  Project name: [ My new project__________________ ]                      │
│                                          [ Cancel ]  [ Next → ]          │
└──────────────────────────────────────────────────────────────────────────┘
```
Note on "Mobile": in the first versions this sets a phone-sized frame and enables app-style blocks. The output is a responsive web app/PWA, not a native app **[DECIDED]**.

### W03. New project, step 2: how to start
```
┌──────────────────────────────────────────────────────────────────────────┐
│  New Project                                                  Step 2 / 3 │
│  How do you want to start?                                               │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐          │
│  │   ✏  Custom      │ │   ▦  Template    │ │   ✦  AI Prompt   │          │
│  │ Blank canvas,    │ │ Topic-wise       │ │ Describe it. AI  │          │
│  │ design yourself  │ │ templates, mix   │ │ designs, you     │          │
│  │                  │ │ pages from many  │ │ approve, AI      │          │
│  │                  │ │                  │ │ builds           │          │
│  │   [ Choose ]     │ │   [ Choose ]     │ │   [ Choose ]     │          │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘          │
│                                                   [ ← Back ]             │
└──────────────────────────────────────────────────────────────────────────┘
```

### W04. Template gallery and mixer
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Templates                              [ Search templates...       🔍 ]  │
├───────────────┬──────────────────────────────────────────────────────────┤
│ TOPIC         │ Education (4)                         Platform: Web      │
│ ● Education   │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│ ○ Business    │ │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░░░ │      │
│ ○ Restaurant  │ │ ░ prev ░ │ │ ░ prev ░ │ │ ░ prev ░ │ │ ░ prev ░ │      │
│ ○ Shop        │ │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░░░ │ │ ░░░░░░░░ │      │
│ ○ Portfolio   │ │ School   │ │ College  │ │ Coaching │ │ Online   │      │
│ ○ Event       │ │ 5 pages  │ │ 6 pages  │ │ 4 pages  │ │ 5 pages  │      │
│               │ │[Preview] │ │[Preview] │ │[Preview] │ │[Preview] │      │
│ STYLE         │ │ [Use ▸]  │ │ [Use ▸]  │ │ [Use ▸]  │ │ [Use ▸]  │      │
│ ☐ Minimal     │ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│ ☐ Bold        │                                                          │
│               │ ── Or mix page by page ─────────────────────────────     │
│               │ Home:    [School ▾]     About:   [College ▾]             │
│               │ Courses: [Coaching ▾]   Contact: [School ▾]              │
│               │ Theme from: [ Coaching ▾ ]  (colors and fonts unified)   │
│               │ Result: Home · About · Courses · Contact  [ Use mix → ]  │
└───────────────┴──────────────────────────────────────────────────────────┘
```
Mixing rule: pages from different templates are re-themed to one chosen theme so colors and fonts stay consistent **[DECIDED]**.

### W05. AI prompt
```
┌──────────────────────────────────────────────────────────────────────────┐
│  ✦ Describe your project                                    Step 3 / 3   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ A website for my coaching institute with courses, fee structure,   │  │
│  │ teacher profiles and a contact form. Modern look, blue and white.  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  Examples: [Coaching site] [Cafe + menu] [Portfolio] [Event page]        │
│  Style:    ( Minimal ) ( Bold ) ( Playful ) ( Corporate )                │
│  Pages:    [Home ✕] [Courses ✕] [Teachers ✕] [Contact ✕] [+ Add]         │
│  Language: [English ▾]                                                   │
│  Reference (optional): [ ⬆ Drop an image for style ]  (W18)              │
│  Brand: [ ⬆ Upload logo ] (optional)                                     │
│                                    Cost: ~1 credit   [ ✦ Generate layout ]│
└──────────────────────────────────────────────────────────────────────────┘
```

### W06. AI step 1: review and approve (Agent 1 output)
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Review layout           Variant: ( A ) ( B ) ( C )     [↻ Regenerate all]│
├────────────────┬─────────────────────────────────────────────────────────┤
│ PAGES          │ Home                                          💻 📱     │
│ ▸ Home         │ ┌─────────────────────────────────────────────────────┐ │
│   Courses      │ │ [Logo]            Courses Teachers Contact  [CTA]   │ │
│   Teachers     │ ├─────────────────────────────────────────────────────┤ │
│   Contact      │ │ Learn skills that get you hired       ┌──────────┐  │ │
│                │ │ Live classes, real projects           │  image   │  │ │
│ THEME          │ │ [ Start free trial ]                  └──────────┘  │ │
│ ■ ■ ■ ■ ■      │ ├─────────────────────────────────────────────────────┤ │
│ Poppins/Inter  │ │ ┌────────┐  ┌────────┐  ┌────────┐                  │ │
│ Rounded: md    │ │ │feature │  │feature │  │feature │                  │ │
│ Motion: subtle │ │ └────────┘  └────────┘  └────────┘                  │ │
│ [Change theme] │ │ Testimonials · Courses preview · Footer             │ │
│                │ └─────────────────────────────────────────────────────┘ │
│ Placeholder    │ Click a section to refine only that section ▸           │
│ text shown;    │                                                         │
│ real copy is   │                                                         │
│ written next.  │                                                         │
├────────────────┴─────────────────────────────────────────────────────────┤
│ Refine: [ make the hero more minimal_______ ] [Apply to: Hero ▾]         │
│ [ ✎ Edit manually ]                           [ ✔ Approve and build ]    │
└──────────────────────────────────────────────────────────────────────────┘
```

### W07. AI step 2: building (and failure state)
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Building your project...                                                │
│  ✔ Layout locked (approved)                                              │
│  ✔ Page content: Home                                                    │
│  ✔ Page content: Courses                                                 │
│  ◐ Page content: Teachers ...                                            │
│  ○ Images   ○ Animations   ○ Mobile layout   ○ Accessibility check       │
│  [██████████████░░░░░░░░░░░░]  52%       [ Cancel ]                      │
│  Live preview appears page by page ▸                                     │
└──────────────────────────────────────────────────────────────────────────┘

  Failure state (after retries are exhausted):
┌──────────────────────────────────────────────────────────────────────────┐
│  ⚠ We could not finish the "Teachers" page.                              │
│  Your approved layout and completed pages are saved. No credits charged  │
│  for the failed step.                                                    │
│  [ Retry this page ]  [ Skip, build it manually ]  [ Open in editor ]    │
└──────────────────────────────────────────────────────────────────────────┘
```

### W08. Main editor
```
┌──────────────────────────────────────────────────────────────────────────┐
│[Logo] School Site ▾  Page:[Home ▾][+]  ⟲ ⟳  💻 📱 🖥  Saved ✓  [👁 Preview]│
│                                                         [History] [Publish▸]│
├─────────┬──────────────────────────────────────────────┬─────────────────┤
│ LEFT    │ CANVAS                                       │ RIGHT           │
│[Blocks] │ ┌──────────────────────────────────────────┐ │[Style][Layout]  │
│[Elems]  │ │ Logo     Courses About Contact    [CTA]  │ │[Anim][Content]  │
│[Layers] │ ├──────────────────────────────────────────┤ │[AI]             │
│[Media]  │ │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │ │                 │
│[Mine]   │ │ │ Learn skills that get you hired    │ │ │ Selected: Hero  │
│[Pages]  │ │ │ Live classes, real projects        │ │ │ ─────────────── │
│         │ │ │ [ Start free trial ]      [image]  │ │ │ (see W10)       │
│ ▾ Hero  │ │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │ │                 │
│  Split  │ │   ▲ selected: handles + floating toolbar │ │                 │
│  Center │ ├──────────────────────────────────────────┤ │                 │
│  Video  │ │ ┌───────┐ ┌───────┐ ┌───────┐            │ │                 │
│ ▾ Cards │ │ │feature│ │feature│ │feature│            │ │                 │
│ ▾ Forms │ │ └───────┘ └───────┘ └───────┘            │ │                 │
│ ...     │ ├──────────────────────────────────────────┤ │                 │
│         │ │ Footer                                   │ │                 │
│         │ └──────────────────────────────────────────┘ │                 │
│         │        ⊕ Drop blocks here to add a section   │                 │
├─────────┴──────────────────────────────────────────────┴─────────────────┤
│ Home › Hero section › Hero                       Zoom [ − 100% + ]  Fit  │
└──────────────────────────────────────────────────────────────────────────┘
```
Floating toolbar on selection: `[⠿ drag] [✦ AI] [⧉ duplicate] [↑↓ move] [🗑 delete]`.

### W09. Left panel tabs
```
 BLOCKS                      ELEMENTS                  LAYERS
┌──────────────────────┐   ┌──────────────────────┐  ┌──────────────────────┐
│ [Search blocks...  ] │   │ [Search elements...] │  │ ▾ Home               │
│ ▾ Navigation         │   │ Text                 │  │  ▾ ▢ Navigation   👁 │
│  [Simple][Center][CTA]│  │ [Heading] [Text]     │  │     ▢ Navbar      👁 │
│ ▾ Hero               │   │ [List] [Link]        │  │  ▾ ▢ Hero         👁 │
│  [Center][Split][Vid]│   │ Media                │  │     ▢ Hero        👁 │
│ ▾ Content            │   │ [Image] [Video]      │  │  ▾ ▢ Features     👁 │
│  [Features][Steps]   │   │ [Icon] [Embed]       │  │     ▢ FeatureGrid 👁 │
│  [Stats][FAQ]        │   │ Basics               │  │  ▸ ▢ Footer       👁 │
│ ▾ Social proof       │   │ [Button] [Divider]   │  │                      │
│ ▾ Forms and actions  │   │ [Spacer]             │  │ Drag to reorder      │
│ ▾ Footer             │   │ Forms                │  │ 👁 hide  🔒 lock     │
│                      │   │ [Input] [Textarea]   │  │ Double-click: rename │
│ Drag onto canvas or  │   │ ✦ Create element...  │  │                      │
│ click to append.     │   │   (opens W14)        │  │                      │
└──────────────────────┘   └──────────────────────┘  └──────────────────────┘
```
Other tabs: **Media** (W19), **Mine** (saved custom elements and components), **Pages** (W21).

### W10. Right panel: Style tab (simple mode, with advanced drawer)
```
┌─────────────────────────────┐   ┌─────────────────────────────┐
│ Hero            [Style ▾]   │   │ ADVANCED          [ ✕ close]│
│ Device: (🖥)(▭)(📱)  ● dot= │   │ Size                        │
│ State:  (Normal)(Hover)     │   │  W [ 100 ][%▾]  H [auto  ]  │
│ ─────────────────────────── │   │  Max W [ 1200 ][px▾]        │
│ Background                  │   │ Spacing                     │
│  ■ ■ ■ ■ ■ ■  [ + custom ]  │   │  Pad  T[ 24] R[ 24]         │
│  ( Color | Gradient | Image)│   │       B[ 24] L[ 24]  [🔗]   │
│ Text color                  │   │  Margin T[ 0] B[ 0]         │
│  ■ ■ ■ ■                    │   │ Border                      │
│ Spacing                     │   │  [1px▾][solid▾][■ color]    │
│  Padding ( S ) M ( L ) ( XL)│   │  Radius TL[8] TR[8]         │
│ Align    ( ◀ ) ( ■ ) ( ▶ )  │   │         BL[8] BR[8]         │
│ Corners  ( ▢ ) ( ▢ ) ( ◯ )  │   │ Gradient                    │
│ Shadow   ( none  S  M  L )  │   │  [linear▾] 135°             │
│ Font size ( S M L XL 2XL )  │   │  stop1 ■ 0%   stop2 ■ 100%  │
│ Visibility                  │   │ Effects                     │
│  ☐ Hide on mobile           │   │  Opacity [━━━━●━] 100%      │
│                             │   │  Backdrop blur [ 0 ]        │
│ [ Advanced ▸ ]              │   │ Typography                  │
│ [ Reset to theme ]          │   │  Weight, line-height,       │
│                             │   │  letter-spacing, transform  │
└─────────────────────────────┘   └─────────────────────────────┘
```
Rules: a dot beside a property means "overridden at this device size". `Reset to theme` removes overrides. Full property list: section 7.

### W11. Right panel: Layout and Content tabs
```
 LAYOUT (containers)              CONTENT (selected block)
┌─────────────────────────────┐  ┌─────────────────────────────┐
│ Direction ( ↔ row | ↕ col ) │  │ Variant: [ Split ▾ ]        │
│ Columns   [ 3 ▾ ]  (grid)   │  │ Headline                    │
│ Gap       ( S ) M ( L )     │  │ [ Learn skills that get... ]│
│ Align     ( top mid bottom )│  │ Subheadline                 │
│ Justify   ( start center    │  │ [ Live classes, real...   ] │
│            end between )    │  │ Button label [ Start free ] │
│ Wrap      [ on ]            │  │ Button link  [ #contact   ] │
│ Min height [ 480 ][px▾]     │  │ Image  [ ░ change ]         │
│ Sticky     [ off ]          │  │ ✦ Rewrite text with AI      │
└─────────────────────────────┘  └─────────────────────────────┘
```

### W12. Right panel: Animation tab
```
┌─────────────────────────────┐
│ ANIMATION          [ Hero ] │
│ Preset  (hover a card = live│
│          preview)           │
│ ┌──────┐ ┌──────┐ ┌──────┐  │
│ │ Fade │ │Slide │ │ Zoom │  │
│ │  in  │ │  up  │ │  in  │  │
│ └──────┘ └──────┘ └──────┘  │
│ ┌──────┐ ┌──────┐ ┌──────┐  │
│ │Slide │ │Paral-│ │Hover │  │
│ │ left │ │ lax  │ │ lift │  │
│ └──────┘ └──────┘ └──────┘  │
│ ┌──────┐ ┌──────┐           │
│ │Hover │ │Lottie│           │
│ │ glow │ │ file │           │
│ └──────┘ └──────┘           │
│ Trigger  (Load|Scroll|Hover)│
│ Duration [━━━━●━━━] 600 ms  │
│ Delay    [●━━━━━━━]   0 ms  │
│ ☑ Disable for reduced-motion│
│ [ ▶ Play ]        [ Remove ]│
└─────────────────────────────┘
```

### W13. AI tab and element prompt
```
 Selected element: Hero section
┌────────────────────────────────────────────────────────────────────┐
│ ✦ Ask AI about this section                                        │
│ [ make this darker and add a testimonial card__________ ]  [ ▸ ]  │
│ Suggestions: [Make bolder] [Add animation] [Simplify] [Translate]  │
└────────────────────────────────────────────────────────────────────┘
        │ after sending (scope = this section only)
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ ✔ Dark background, slide-left animation, testimonial added.        │
│   Changed: Hero section, Hero, + 1 new block.                      │
│        [ Undo ]    [ Keep ]    [ Ask again ]                       │
└────────────────────────────────────────────────────────────────────┘
        │ on rejection by validator after retries
        ▼
┌────────────────────────────────────────────────────────────────────┐
│ ⚠ I could not apply that change safely. Nothing was changed.       │
│   Try rephrasing, or edit manually.                [ OK ]          │
└────────────────────────────────────────────────────────────────────┘
```

### W14. Element Creator
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ✦ Create an element                                          [ ✕ close ] │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ A pricing card with a "Popular" badge and three features             │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│ Reference image: [ ⬆ Drop image here ]   (break it down / use as style)  │
│                                          [ ✦ Generate 3 options ]        │
│ Options (rendered with real blocks):                                     │
│ ┌────────────┐  ┌────────────┐  ┌────────────┐                           │
│ │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │                           │
│ │ │ POPULAR│ │  │ │ Basic  │ │  │ │ Pro    │ │                           │
│ │ │  ₹499  │ │  │ │  ₹299  │ │  │ │  ₹999  │ │                           │
│ │ │ ✔ ✔ ✔  │ │  │ │ ✔ ✔    │ │  │ │ ✔ ✔ ✔  │ │                           │
│ │ └────────┘ │  │ └────────┘ │  │ └────────┘ │                           │
│ │ [ Insert ] │  │ [ Insert ] │  │ [ Insert ] │   drag any card to canvas │
│ └────────────┘  └────────────┘  └────────────┘                           │
│ Refine selected option: [ make it rounder and add a hover lift ] [ ▸ ]   │
│ [ ★ Save to My Elements ]                                                │
└──────────────────────────────────────────────────────────────────────────┘
```
Scope of "small stuff": Tier A (compositions of existing elements) first; Tier B (new SVG shapes, animated dividers) later (section 11.1).

### W15. Image drop dialog (image dropped on the Element Creator)
```
┌──────────────────────────────────────────────────────────────────────────┐
│  What should I do with this image?                                       │
│  ┌──────────┐                                                            │
│  │ ░ image ░│  landing-page.png  (1440 x 2400, 1.8 MB)  stored in My Assets│
│  └──────────┘                                                            │
│  ( • ) Use as style reference                                            │
│         Extract colors, mood, spacing. Does not copy its text or images. │
│  (   ) Break into elements                                               │
│         Rebuild its layout with our blocks. Approximate, not exact.      │
│  (   ) Just use as an image                                              │
│  ☑ I own this image or have the right to use it                          │
│                                          [ Cancel ]   [ Continue → ]     │
└──────────────────────────────────────────────────────────────────────────┘
```
The ownership checkbox is required. See section 15.4.

### W16. Result: Break into elements (UI screenshot)
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Rebuilt from your image                      Compare: [Slider ▾] [Overlay]│
├───────────────────────────────┬──────────────────────────────────────────┤
│ ORIGINAL                      │ REBUILT (editable)                       │
│ ┌───────────────────────────┐ │ ┌──────────────────────────────────────┐ │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░ │ │ │ [Navbar]                             │ │
│ │ ░  original screenshot  ░ │ │ │ [Hero · split]                       │ │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░ │ │ │ [Feature grid · 3]                   │ │
│ └───────────────────────────┘ │ │ [Image: cropped asset ⚠]             │ │
│                               │ └──────────────────────────────────────┘ │
├───────────────────────────────┴──────────────────────────────────────────┤
│ Detected: 4 sections · 11 elements · palette ■ ■ ■ ■ ■                   │
│ ⚠ 2 items low confidence (flagged on the rebuilt view)                   │
│ ☑ Navbar  ☑ Hero  ☑ Features  ☐ Decorative illustration (kept as image)  │
│ [ Insert selected as sections ]   [ Add elements to tray ]   [ Cancel ]  │
└──────────────────────────────────────────────────────────────────────────┘
```
Expect approximate output. Anything with no block equivalent is cropped as an image asset (section 11.3).

### W17. Result: Photo to layers
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Photo layers                                                             │
│ ┌──────────────────────────────┐   LAYERS                                │
│ │  composite preview           │   ☑ 👁 Person (transparent PNG)         │
│ │  (layerGroup, fixed aspect)  │   ☑ 👁 Plant   (transparent PNG)        │
│ │                              │   ☑ 👁 Background                       │
│ └──────────────────────────────┘   [Move] [Scale] [Delete] [Restyle]     │
│ ⚠ Removing an object leaves a gap. [ Fill gap with AI (extra credits) ]  │
│                                       [ Insert group ]   [ Cancel ]      │
└──────────────────────────────────────────────────────────────────────────┘
```

### W18. Result: Style reference
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Style reference extracted (stored as a small profile, not copied content)│
│  Palette:   ■ #0F172A  ■ #2563EB  ■ #F59E0B  ■ #F8FAFC  ■ #94A3B8        │
│  Font mood: ( Geometric )     Corners: ( Rounded )                       │
│  Spacing:   ( Airy )          Shadows: ( Soft )                          │
│  Layout pattern: split hero, 3-column cards                              │
│  [ Apply to theme ]  [ Use for this element ]  [ Save as Brand Kit ]     │
└──────────────────────────────────────────────────────────────────────────┘
```

### W19. Media library and image editor
```
 MEDIA (left tab)                       IMAGE EDITING (right panel, image selected)
┌──────────────────────────┐          ┌────────────────────────────────┐
│ [ ⬆ Upload ] [Search___] │          │ Image                          │
│ Filter: All Img Vid SVG  │          │ [ Replace ]  [ Crop ]          │
│ ┌────┐ ┌────┐ ┌────┐     │          │ Fit ( Cover | Contain )        │
│ │ ░  │ │ ░  │ │ ░  │     │          │ Rotate  [ ⟲ ] [ ⟳ ]            │
│ └────┘ └────┘ └────┘     │          │ Brightness [━━●━━]             │
│ hero  team  logo         │          │ Contrast   [━━●━━]             │
│ ┌────┐ ┌────┐            │          │ Saturation [━━●━━]             │
│ │ ░  │ │ ▶  │ ⋯ rename  │          │ Blur       [●━━━━]             │
│ └────┘ └────┘   delete  │          │ Mask ( none ◯ ▢ )              │
│ Free stock ▸             │          │ [ Remove background ] (credits)│
│ Used in: 2 pages         │          │ Alt text [ Students in class ] │
│ Storage 1.2 / 2 GB       │          │ ✦ Suggest alt text             │
└──────────────────────────┘          │ [ Reset edits ]                │
                                      └────────────────────────────────┘
```
Edits are stored as parameters; the original file is never changed (section 11.2).

### W20. Theme panel (global)
```
┌─────────────────────────────┐
│ THEME                       │
│ Colors                      │
│  Primary    [■ #2563EB]     │
│  Secondary  [■ #F59E0B]     │
│  Background [■ #FFFFFF]     │
│  Surface    [■ #F3F4F6]     │
│  Text       [■ #111827]     │
│  Muted      [■ #6B7280]     │
│  [ ✦ Suggest palette ]      │
│ Fonts                       │
│  Heading [ Poppins ▾ ]      │
│  Body    [ Inter ▾ ]        │
│ Corners  ( none S M L full )│
│ Motion   ( off subtle full )│
│ ⚠ 2 color pairs fail contrast│
└─────────────────────────────┘
```

### W21. Page manager
```
┌─────────────────────────────┐
│ PAGES                [ + ]  │
│ ⠿ Home        /       ⋯     │
│ ⠿ Courses     /courses ⋯    │
│ ⠿ Teachers    /teachers ⋯   │
│ ⠿ Contact     /contact ⋯    │
│ ⋯ menu: Rename, Duplicate,  │
│   Set as home, SEO, Delete  │
│ [ + From template ▸ ]       │
│ [ + AI page ▸ ]             │
│ SEO (selected page)         │
│  Title [ Home | BrightPath ]│
│  Description [ ... ]        │
│  Social image [ ░ ]         │
└─────────────────────────────┘
```

### W22. Mobile and tablet editing
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Editor · Mobile view                          ( 💻 )( ▭ )( 📱 ● )        │
├────────┬────────────────────────────────┬────────────────────────────────┤
│ Blocks │          ┌─────────┐           │ Style · Mobile overrides       │
│ Layers │          │ ▭ ▭ ▭ ≡ │           │ Stack columns   [ on  ]        │
│ Pages  │          ├─────────┤           │ Hide image      [ off ]        │
│        │          │ Headline│           │ Font size       [ L ▾ ]        │
│        │          │ [Button]│           │ Padding         [ M ▾ ]        │
│        │          ├─────────┤           │ ● = differs from desktop       │
│        │          │ [image] │           │ Bottom tab bar  [ on  ]        │
│        │          ├─────────┤           │  Tabs: Home · Courses · Contact│
│        │          │ ▢ ▢ ▢   │           │ [ Reset to desktop ]           │
│        │          └─────────┘           │                                │
└────────┴────────────────────────────────┴────────────────────────────────┘
```

### W23. Version history
```
┌─────────────────────────────┐
│ HISTORY            [ ✕ ]    │
│ ● Now                       │
│ ○ Today 14:20  AI: dark hero│
│ ○ Today 14:05  Manual edits │
│ ○ Today 13:40  AI build done│
│ ○ Today 13:32  Layout approved│
│ [ Preview ] [ Restore ]     │
│ Restore creates a new       │
│ version; nothing is lost.   │
└─────────────────────────────┘
```

### W24. Pre-publish check and publish
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Publish                                                                  │
│ ( • ) Platform subdomain    https://school-site.yourplatform.app         │
│ (   ) Custom domain         [ www.myschool.in____ ]   (Pro)  setup guide ▸│
│ (   ) Export code           [ HTML/CSS ▾ ]  [ React ▾ ]      (Pro)       │
│ Pre-publish check                                                        │
│  ✔ All images have alt text                                              │
│  ✔ Mobile layout reviewed                                                │
│  ⚠ 2 buttons have low contrast            [ Fix automatically ]          │
│  ⚠ Contact form has no destination email  [ Set email ]                  │
│ Forms: submissions go to [ you@example.com ]  Spam protection: [ on ]    │
│                                       [ Cancel ]          [ Publish now ]│
└──────────────────────────────────────────────────────────────────────────┘
```

### W25. Empty, error and limit states
```
 Empty canvas                              Upload blocked
┌──────────────────────────────────┐    ┌───────────────────────────────────┐
│ Your page is empty               │    │ ⚠ This file cannot be used.       │
│ ⊕ Drag a block from the left     │    │ Reason: file type not allowed /   │
│ or  [ ✦ Generate with AI ]       │    │ over 20 MB / failed safety check  │
│ or  [ ▦ Start from a template ]  │    │                         [ OK ]    │
└──────────────────────────────────┘    └───────────────────────────────────┘
 Out of credits                            Offline / save failed
┌──────────────────────────────────┐    ┌───────────────────────────────────┐
│ You have used all AI credits.    │    │ ⚠ Not saved. Retrying...          │
│ Resets on <date> or [ Upgrade ]  │    │ Your changes stay in this tab.    │
│ Manual editing still works.      │    │ [ Download JSON backup ]          │
└──────────────────────────────────┘    └───────────────────────────────────┘
```

### W26. Drag states on the canvas
```
 Valid drop (blue insertion line)       Invalid drop (not allowed here)
┌────────────────────────────────┐    ┌────────────────────────────────────┐
│ ┌────────────────────────────┐ │    │ ┌────────────────────────────────┐ │
│ │ Hero                       │ │    │ │ Navbar    ✖ Cannot place Footer │ │
│ └────────────────────────────┘ │    │ │           inside a Navbar       │ │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │    │ └────────────────────────────────┘ │
│ ┌────────────────────────────┐ │    │ The line snaps to the nearest      │
│ │ Features                   │ │    │ valid position instead.            │
│ └────────────────────────────┘ │    └────────────────────────────────────┘
└────────────────────────────────┘
 Ghost preview follows the pointer; Esc cancels the drag.
```

---

## 7. Style panel specification

### 7.1 Design [DECIDED]
- **Location:** contextual right panel, tabs **Style | Layout | Animation | Content | AI**.
- **Two levels:** *Simple mode* (default) uses theme tokens and presets. *Advanced drawer* exposes exact values.
- **Two switches at the top:** device (desktop/tablet/mobile) and state (normal/hover).
- **Override dot:** shown next to any property that differs from the cascade above it.
- **Global Theme panel (W20)** controls colors, fonts, corner style and motion for the whole site.

### 7.2 Property catalogue (style v2)
| Group | Simple controls | Advanced controls |
|---|---|---|
| Background | Theme swatches, color/gradient/image toggle | Hex, gradient stops and angle, image fit/position, overlay opacity |
| Text | Theme text colors, font size S-2XL | Font family, weight, line-height, letter-spacing, transform, decoration |
| Spacing | Padding S/M/L/XL | Per-side padding and margin in px/rem/% |
| Size | Width: auto / fill / fixed preset | Width, height, min/max, aspect ratio |
| Layout (containers) | Row/column, gap S-L, align, justify | Grid columns, wrap, per-breakpoint reflow |
| Border and corners | Corner presets | Per-corner radius, border width/style/color |
| Effects | Shadow presets, opacity | Custom shadow, backdrop blur |
| Visibility | Hide on tablet/mobile | |
| Position | | Sticky/fixed (navbar-type blocks only) |

Not offered in v2 **[DECIDED]**: arbitrary CSS, `z-index` beyond a small set, custom code.

### 7.3 Which controls appear for which node
Controls are driven by the block registry: each element/block lists which style groups it supports. A divider does not show typography; an image does not show text color. This also constrains what the AI is allowed to set.

---

## 8. Drag-and-drop specification

### 8.1 What can be dragged
| Source | Target | Patch op |
|---|---|---|
| Block/element from library | Canvas position | `insert` |
| Template section/page | Canvas / page list | `insert` (clone with fresh IDs) |
| Existing node | Another position, same parent | `move` |
| Existing node | Different container | `move` |
| Layers panel item | Another layers position | `move` |
| Resize handle (column, width) | | `update` (style) |
| Spacing handle | | `update` (style) |
| Image file from desktop | Canvas / image node | upload, then `insert` / `update` |
| Media item | Image/video node | `update` (props.assetId) |
| Image file | Element Creator | opens W15 |
| Creator option | Canvas | `insert` |
| My Elements item | Canvas | `insert` (componentRef) |
| Animation preset card | Element | `update` (animation) |
| Layer in layerGroup | | `update` (position) |
| Alt/Option-drag, Ctrl+D | | `insert` (duplicate) |
| Delete key | | `remove` |

Every drag ends as a patch, so manual and AI edits share one undo history.

### 8.2 Drop algorithm
```
onDragStart(source): record source (library item | node id); show ghost

onDragOver(pointer):
    target = deepest container under pointer
    while target does not allow dragged.type (registry.children):
        target = target.parent              // walk up to a valid container
    if no valid target: show ✖ state (W26); return
    index = position among target.children by comparing pointer to sibling midpoints
                (vertical axis for column containers, horizontal for rows)
    show insertion line at (target, index)
    autoscroll canvas near its top/bottom edge

onDrop():
    if source is library: patch = insert(target.id, index, newNode(source))
    else:                 patch = move(source.id, target.id, index)
    forbid moving a node into its own descendant
    commit(patch)

onKeyboard (accessibility): Space to pick up, arrows to move between valid slots,
                            Space to drop, Esc to cancel
```

### 8.3 Library recommendation [CHECKED, with caveats]
- **Recommended: `@dnd-kit` (stable: `@dnd-kit/core` plus `@dnd-kit/sortable`).** At the time of checking, `@dnd-kit/core` was at v6.3.1 with a large user base and good health scores **[CHECKED]**.
- **Caveat:** the maintainer is building a ground-up rewrite (`@dnd-kit/react`, versions 0.x/beta at the time of checking). Its API is **not backwards-compatible** with the stable package **[CHECKED]**. Start on the stable package and isolate DnD code behind your own thin interface so a later migration is contained.
- Alternative: Atlassian's `pragmatic-drag-and-drop` (smaller, lower-level, more DIY) **[CHECKED]**.
- **`react-beautiful-dnd` is deprecated; do not use it for a new project** **[CHECKED]**.
- Nested containers, multi-select drag and an iframe canvas are harder than demos suggest; prototype these early (Phase 0).

---

## 9. Data model

### 9.1 Hierarchy
```
Project { schemaVersion, id, name, platform, theme, pages[], assetsIndex }
 └─ Page { id, name, path, seo, nodes[] }          // nodes[] are sections
     └─ Node { id, kind, type, props, styles, animation?, children[] }
```

### 9.2 Elements vs blocks (v2) [DECIDED]
`kind: "element" | "block" | "container" | "componentRef" | "layerGroup"`. The registry defines for every `type`: props schema, allowed children, supported style groups, available variants, and animation support.

### 9.3 Style v2
```ts
type Breakpoint = "base" | "tablet" | "mobile";          // base = desktop
type StyleState = "normal" | "hover";

type StyleProps = {
  // layout (containers)
  display?: "block" | "flex" | "grid";
  direction?: "row" | "column";
  gap?: Token | number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  columns?: 1 | 2 | 3 | 4 | 5 | 6;
  wrap?: boolean;
  // size
  width?: "auto" | "fill" | { value: number; unit: "px" | "%" | "rem" };
  maxWidth?: { value: number; unit: "px" | "%" | "rem" };
  minHeight?: { value: number; unit: "px" | "vh" | "rem" };
  aspectRatio?: string;
  // spacing
  padding?: Sides<Token | number>;
  margin?: Sides<Token | number>;
  // background
  background?: ColorRef | Gradient | { assetId: string; fit: "cover" | "contain"; overlay?: number };
  // border
  border?: { width: number; style: "solid" | "dashed"; color: ColorRef };
  radius?: Corners<Token | number>;
  // effects
  shadow?: "none" | "sm" | "md" | "lg" | CustomShadow;
  opacity?: number;                                      // 0..1
  backdropBlur?: number;
  // typography
  fontFamily?: "heading" | "body" | string;              // from allowed font list
  fontSize?: Token | number;
  fontWeight?: 300 | 400 | 500 | 600 | 700 | 800;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  color?: ColorRef;
  // visibility / position
  hidden?: boolean;
  position?: "static" | "sticky" | "fixed";              // restricted by registry
};

type Styles = Partial<Record<Breakpoint, Partial<Record<StyleState, StyleProps>>>>;
// Cascade (desktop-first): mobile ⟵ tablet ⟵ base; hover layers on top of normal at each level.
```
Unsetting a property: patch value `null` removes the override (not supported in prototype v1).

### 9.4 Animation
```ts
type Animation = {
  preset: "fade-in" | "slide-up" | "slide-left" | "slide-right" | "slide-down"
        | "zoom-in" | "rotate-in" | "blur-in" | "parallax" | "reveal" | "pin"
        | "hover-lift" | "hover-glow" | "hover-scale" | "hover-tilt"
        | "float" | "pulse" | "marquee" | "typewriter" | "word-by-word" | "shimmer"
        | "lottie";
  trigger?: "load" | "scroll" | "hover";                 // default "scroll"
  durationMs?: number;                                   // 100..3000, default 600
  delayMs?: number;                                      // 0..3000, default 0
  lottieAssetId?: string;                                // for "lottie"
};
```

### 9.5 Assets
```ts
type Asset = {
  id: string; ownerId: string;
  kind: "image" | "video" | "svg" | "lottie";
  originalKey: string;            // users/{ownerId}/assets/{id}/original.ext (private)
  width?: number; height?: number; bytes: number; mime: string;
  hash: string;                   // sha256, dedupe per user
  alt?: string;
  moderation: "pending" | "ok" | "blocked";
  derivedFrom?: { assetId: string; op: "crop" | "segment" | "vectorize" };
  createdAt: string;
};

type ImageEdit =
  | { type: "crop"; x: number; y: number; w: number; h: number }
  | { type: "rotate"; deg: 90 | 180 | 270 | number }
  | { type: "filter"; brightness?: number; contrast?: number; saturation?: number; blur?: number }
  | { type: "mask"; shape: "circle" | "rounded" }
  | { type: "removeBg" };
// Image node props: { assetId, alt, fit, edits: ImageEdit[] } (original never modified)
```

### 9.6 Components (Element Creator results)
```ts
type Component = {
  id: string; ownerId: string; name: string;
  tree: Node;                         // validated tree
  source: "ai" | "manual" | "image";
  prompt?: string; createdAt: string;
};
// Used in a project as: { kind:"componentRef", type:"componentRef",
//                         props:{ componentId, overrides } }
```
Publishing inlines the component tree into the published site so a deleted component cannot break a live page **[DECIDED]**.

### 9.7 Reference profile (style from image)
```ts
type ReferenceProfile = {
  palette: string[];                       // k-means colors, hex
  fontMood: "geometric" | "serif" | "rounded" | "mono" | "humanist";
  radius: "none" | "sm" | "md" | "lg" | "full";
  spacing: "tight" | "normal" | "airy";
  shadowStyle: "none" | "soft" | "hard";
  layoutPattern?: string;
};
```

### 9.8 Patch format
```ts
type Patch = {
  summary: string;                         // shown to the user
  ops: Array<
    | { op: "update"; id: string; props?: object; styles?: object | null;
        animation?: Animation | null }
    | { op: "insert"; parentId: string; index: number; node: Node }
    | { op: "remove"; id: string }
    | { op: "move"; id: string; parentId: string; index: number }
  >;                                       // 1..20 ops
};
```
Rules: operations are ID-based (not array-index paths), applied in order, all-or-nothing, validated after application, scope-guarded when produced by an element prompt.

### 9.9 Known limits of the prototype files (v1)
The companion files are a prototype, not production code. They were **not compiled or run** while writing this document; only the two JSON files were checked for valid syntax. Known gaps:
1. `Style` has only 7 properties, no breakpoints, no hover state.
2. Elements and blocks are not separated.
3. `update` merges `style` shallowly and cannot unset a key; `props` merge is shallow, so array props are replaced entirely.
4. No `componentRef`, `layerGroup`, assets or `ImageEdit` types.
5. The applier validates the whole project after each patch, which is fine for small projects but may be slow for large ones; validate only affected subtrees later.
6. Generated IDs from the AI are checked for uniqueness only after applying; use server-side ID generation for inserted nodes in production.
7. History stores full snapshots; switch to diffs or structural sharing (for example Immer patches) when projects get large.

---

## 10. AI system

### 10.1 Agents
| Agent | Input | Output | Model tier **[ESTIMATE]** |
|---|---|---|---|
| **Agent 1: Designer** | Prompt, registry, theme options, optional reference profile | Pages, block order and variants, theme, motion style, placeholder text | Fast, cheaper |
| **Agent 2: Builder** | Approved Agent 1 JSON (locked), prompt, brand kit | Real copy, images, animations, breakpoint overrides | Stronger |
| **Patch agent** | Selected node, parent, theme, registry, user text | Patch (≤ 20 ops) | Fast |
| **Element agent** | Prompt, theme, registry, optional reference profile | 3 component trees | Fast |
| **Vision agent (11.3)** | Image, OCR text boxes, registry | Layout hierarchy with boxes | Vision-capable |
| **Reviewer (optional)** | Whole project | Accessibility and spacing patches | Fast |

Do not hard-code model names; put the provider behind an abstraction and select models by evaluation results on your own prompt set **[DECIDED]**.

### 10.2 Hard rules [DECIDED]
1. Agents return **structured JSON only**. Use the provider's structured-output or tool-use feature where available **[VERIFY per provider]**.
2. Only registry blocks, variants, style groups and animation presets are allowed.
3. **Validator** (plain code) runs after every agent output; errors go back to the agent for a retry (max 2-3).
4. Element prompts receive only the selected node, its parent and the theme, and return a patch.
5. Agent 2 may not change approved structure (`structureSignature` check).
6. Every AI change is undoable.
7. The AI never returns raw HTML, CSS or JavaScript.
8. User-supplied text and image content is treated as data, never as instructions to the agent (prompt-injection defense, section 15.2).

### 10.3 `structureSignature`
```
signature(page) = hash of ordered list of:
    [section id, section name, and for each child: type + variant (recursive)]
Excluded: text content, images, animations, style tweaks.
Agent 2 output is rejected if signature(output) != signature(approved).
```

### 10.4 Quality and cost control
- Build an **evaluation set** of 30-50 representative prompts before tuning anything; score schema-valid rate, user-approval rate, and retries per generation **[TARGET: define thresholds after first measurements]**.
- Cache by input hash where safe; downscale images before vision calls.
- Credits per action (generate layout, build, patch, creator, vision) with plan limits and a hard per-user daily cap.
- Log tokens and cost per call from day one.

### 10.5 Prompt design notes
- Put the block registry (types, props, variants, allowed children, animation presets) in the system prompt as a compact schema, generated from the registry code so docs and code never drift.
- Provide 2-3 gold examples per agent.
- State the language of the output explicitly (English/Hindi/etc.).
- Ask for `summary` in every patch so the UI can tell the user what changed.

---

## 11. Element Creator and image intelligence

### 11.1 Element Creator (prompt to small component)
| Tier | Makes | Method | Phase |
|---|---|---|---|
| **A: Compositions** | Pricing card, stat counter, badge, banner, step list | Node tree from existing elements, fully validated | 3 |
| **B: New visuals** | Custom SVG shape, gradient blob, animated divider | New node types `svg`, `shape`, `lottie`; SVG sanitized | 5 |

Flow: prompt (and optional image) → 3 options rendered with real blocks → insert by click or drag, refine by prompt (same patch flow), or save to **My Elements** (stored per user).
**Never** let the AI emit arbitrary HTML/JS. A custom-code element, if ever added, runs in a sandboxed iframe and is paid-only **[DECIDED]**.

### 11.2 Uploads, per-user storage and editing
**Upload flow**
```
on file(file, dropTarget):
    reject if size > LIMIT or magic bytes not in ALLOWED
    if svg: sanitize(file)            // strip scripts, handlers, external refs
    strip EXIF (GPS etc.)
    hash = sha256(file)
    asset = existing(user.id, hash) ?? store(users/{id}/assets/..., file)
    queue moderation(asset)            // blocked assets cannot be inserted
    quota check (storage and rate)
    route by dropTarget: empty container → insert image node
                         image node     → update props.assetId
                         Element Creator → open W15
```
**Editing is non-destructive:** edits are parameters (`ImageEdit[]`) applied by an image transform service (for example sharp, imgproxy or a hosted image CDN **[VERIFY pricing and limits]**) and cached by an edits hash. Reset clears the edits.

**Storage rules**
- Direct-to-storage upload with signed URLs (do not stream files through your API).
- Original files are private (`users/{ownerId}/...`). At publish, copy only the used assets to a public, hashed path.
- Reference counting: warn before deleting an asset a published site still uses.
- Suggested limits **[TARGET, tune with data]:** 20 MB per image, larger for video on paid plans; per-plan storage quota.

### 11.3 Image dropped on the Element Creator: three modes
| Mode | What it does | Difficulty | Output |
|---|---|---|---|
| **Use as style reference** | Extract palette, font mood, radius, spacing, shadow, layout pattern into `ReferenceProfile` | Easy-medium | Constraints for agents; never copies text/logos/images |
| **Break into elements** (UI screenshot or sketch) | OCR + vision model proposes a layout hierarchy; map to registry; crop non-mappable regions as assets | Hard | Approximate rebuild with low-confidence flags |
| **Break into elements** (photo) | Segmentation into object layers as transparent PNG assets in a `layerGroup` | Medium, needs a hosted model | Image layers, not code elements |
| **Break into elements** (logo/icon) | Vectorize simple logos; extract palette | Easy-medium | SVG + palette; complex logos fail |

**Break-down algorithm for UI screenshots**
```
type   = classify(image)                          // cheap vision call
textBoxes = OCR(image)
layout = VisionModel(image, textBoxes, registry)  // hierarchy + normalized boxes + types
palette = kmeans(image) → map to theme tokens or hex
for region with no block equivalent: crop → new Asset (owned by user)
tree = mapToRegistry(layout, crops, palette)      // prefer blocks, else elements
validate(tree), retry up to 2
show original ↔ rebuilt (W16) with low-confidence flags
user inserts selected parts
```
**Honest limits:** font identification is unreliable; spacing and sizes are estimated; illustrations and custom icons stay images; removing an object from a photo leaves a gap unless generative inpainting (extra model, extra cost) is used.
**Placement in the plan:** style reference in Phase 3; screenshot-to-blocks and photo layers in Phase 5, optional.

### 11.4 `layerGroup`
Fixed-aspect container; children are absolutely positioned using percentages of the group so they scale together. It is the only absolute-positioning exception, used for photo-layer compositions and similar artwork.

---

## 12. Architecture and tech stack

### 12.1 Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER (Next.js / React)                   │
│ ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐ ┌──────────┐  │
│ │Editor UI │ │ Renderer │ │ Templates │ │ AI panels │ │ Media UI │  │
│ └────┬─────┘ └────┬─────┘ └─────┬─────┘ └─────┬─────┘ └────┬─────┘  │
│      └────────────┴──────┬──────┴─────────────┴────────────┘        │
│               Project JSON store (+ history, patches)               │
└──────────────────────────┼──────────────────────────────────────────┘
                           │ HTTPS (REST) + streaming (SSE/WebSocket)
┌──────────────────────────▼──────────────────────────────────────────┐
│ API: auth · projects · versions · uploads · publish · billing        │
│ AI service: agents · validator · credits · evals · queue             │
│ Workers: image transform · moderation · vision · export · publish    │
├───────────────┬──────────────────┬──────────────────┬───────────────┤
│ PostgreSQL    │ Redis (cache,    │ Object storage + │ LLM / vision  │
│               │ queues, limits)  │ CDN              │ providers     │
└───────────────┴──────────────────┴──────────────────┴───────────────┘
        Publisher: JSON → static site → hosting (subdomain / custom domain)
```

### 12.2 Stack choices
| Layer | Choice | Status |
|---|---|---|
| Editor app | Next.js, React, TypeScript, Tailwind CSS | [DECIDED] |
| State | Zustand (or Redux Toolkit) with patch history; Immer for structural sharing | [DECIDED] |
| Drag and drop | `@dnd-kit` stable packages behind your own interface | [DECIDED, see 8.3] |
| Schema/validation | Zod (shared package used by editor, API and AI) | [DECIDED] |
| Animation | CSS + IntersectionObserver for most presets; Framer Motion/GSAP only where needed; Lottie runtime loaded on demand | [DECIDED] |
| Backend | Node.js (NestJS or Express) or Python (FastAPI) | pick one; team skill decides |
| Database | PostgreSQL; Redis | [DECIDED] |
| Storage and CDN | S3-compatible object storage (AWS S3 or Cloudflare R2) with CDN | [VERIFY pricing] |
| Auth | Managed auth (Clerk or Supabase Auth) or self-built | [VERIFY pricing and India data rules] |
| Payments | Razorpay (India), Stripe (global) | [VERIFY availability and fees for your entity] |
| Site hosting | Static hosting (Cloudflare Pages/Vercel/own) with custom-domain support | [VERIFY custom-domain automation cost and limits] |
| Monorepo | Turborepo or Nx | [DECIDED] |

**Base editor decision [VERIFY before committing]:**
- **Craft.js:** a framework for building page editors (no ready-made UI) **[CHECKED]**. In the checks made while writing this document, its repository showed large open-issue counts and an npm health score with low maintenance marks, and its docs/issues discuss it being years old **[CHECKED, indicative only]**. It also keeps its own node state model, which would need an adapter to your schema.
- **GrapesJS:** mature HTML-oriented builder, but its model is HTML/CSS-centric, which conflicts with the token-based JSON schema here.
- **Puck:** an open-source React visual editor that is built on dnd-kit **[CHECKED]**; worth a one-week evaluation as a base or reference. Its data model also differs from this schema; test whether an adapter is cheaper than building the canvas yourself.
- **Recommendation:** build the canvas yourself on dnd-kit with your own schema, and spend one week in Phase 0 comparing against Puck. Decide by prototype, not by reading.

### 12.3 Monorepo layout
```
/apps
  /editor         Next.js app (dashboard, editor, gallery)
  /api            Backend
  /worker         Queue workers (image, moderation, vision, publish)
/packages
  /schema         Zod schemas, registry, validators, patch types, applyPatch
  /blocks         React components for every element/block (renderer)
  /renderer       JSON → React tree, breakpoint cascade, animation runtime
  /ai             Agents, prompts, retry logic, evals
  /templates      Template JSON + thumbnails
  /export         JSON → HTML/CSS, JSON → React code
  /ui             Shared editor UI components
```

### 12.4 Publishing
Published output is **static HTML/CSS plus minimal JavaScript** compiled from the project JSON (tokens resolve to CSS variables). Forms post to a platform endpoint that emails the owner (needs spam protection and an email delivery service). Custom domains need DNS verification and automatic TLS certificates **[VERIFY chosen provider's custom-domain feature, limits and cost]**.

---

## 13. API surface (REST, indicative)

```
Auth        POST /auth/*  (via provider)
Projects    GET/POST /projects            GET/PATCH/DELETE /projects/:id
            PUT /projects/:id/autosave    (body: json, baseVersion → 409 on conflict)
Versions    GET /projects/:id/versions    POST /projects/:id/versions/:v/restore
Templates   GET /templates?topic=&type=   GET /templates/:id
Assets      POST /assets/sign-upload      POST /assets/:id/complete
            GET /assets  DELETE /assets/:id  GET /assets/:id/usage
Components  GET/POST /components          DELETE /components/:id
AI          POST /ai/layout               (Agent 1)
            POST /ai/build                (Agent 2, streams page by page)
            POST /ai/patch                (element prompt)
            POST /ai/element              (Element Creator)
            POST /ai/reference            (style profile from image)
            POST /ai/breakdown            (image → elements, async job)
            GET  /ai/jobs/:id             (status/result)
Publish     POST /projects/:id/publish    GET /projects/:id/site
            POST /projects/:id/domain     GET /projects/:id/domain/status
Export      POST /projects/:id/export?format=html|react
Billing     POST /billing/checkout  POST /billing/webhook  GET /usage
Forms       POST /f/:siteId/:formId       (public, rate-limited, spam-checked)
```
Concurrency: autosave sends `baseVersion`; the server rejects stale writes with 409 and the editor offers reload or merge. Real-time collaboration (CRDT such as Yjs) is out of scope for now; ID-based patches keep that door open **[DECIDED]**.

---

## 14. Database schema (core tables)

```
users(id, email, name, plan, created_at)
projects(id, owner_id, name, platform, json, version, thumb_key, status, updated_at)
project_versions(id, project_id, version, json_or_diff, reason, created_at)
templates(id, title, topic, style, platform, json, thumb_key, pages_count, published)
template_tags(template_id, tag)
assets(id, owner_id, kind, original_key, bytes, mime, width, height, hash,
       alt, moderation, derived_from, created_at)   -- unique(owner_id, hash)
asset_usage(asset_id, project_id)                   -- reference counts
components(id, owner_id, name, tree_json, source, prompt, created_at)
brand_kits(id, owner_id, name, palette, fonts, reference_profile, logo_asset_id)
ai_jobs(id, user_id, project_id, kind, status, input_hash, result_ref,
        tokens_in, tokens_out, cost_estimate, created_at)
credits_ledger(id, user_id, delta, reason, ai_job_id, created_at)
sites(id, project_id, subdomain, published_version, published_at)
domains(id, site_id, hostname, status, verified_at)
form_submissions(id, site_id, form_id, payload, ip_hash, created_at)
subscriptions(id, user_id, provider, plan, status, current_period_end)
```
Store form payloads minimally and define a retention period **[VERIFY legal requirement]**.

---

## 15. Security, privacy and legal

### 15.1 Published-site safety
- No user/AI-supplied JavaScript in published sites. The renderer emits only its own scripts.
- Text content is escaped; URLs are validated (allow `http`, `https`, `mailto`, `tel`, `#`; reject `javascript:`).
- Embeds limited to an allow-list (maps, YouTube, etc.) with sandboxed iframes.
- Content Security Policy on published sites and the editor.

### 15.2 AI-specific
- Treat all user content (prompts, uploaded image text, reference pages) as untrusted data; instructions found inside images or text must not change agent behavior.
- Validator and scope guard are the real defenses: even a manipulated agent can only emit registry-valid patches within scope.
- Rate-limit and cap spend per user; alert on abnormal usage.
- Do not send private uploads to third-party providers without stating this in the privacy policy **[VERIFY provider data-use terms]**.

### 15.3 Uploads
Magic-byte type checks, size caps, SVG sanitization, EXIF stripping, moderation before use, signed URLs, private originals, per-user quotas, rate limits, malware scanning for non-image types **[VERIFY tooling]**.

### 15.4 Legal and policy (get professional review) [VERIFY]
- Terms of Service and Privacy Policy before public launch.
- **Copyright:** users upload images that may belong to others, including competitors' sites. Require an ownership confirmation (W15), publish a takedown process, and keep "style reference" as extraction of style only.
- **Asset licenses:** check licenses for bundled fonts, stock photos and Lottie files; prefer permissively licensed sources and record each license.
- **Data protection:** check obligations under India's data-protection law and, if you have EU/UK users, GDPR; define data export and deletion.
- **Payments:** comply with the payment provider's requirements and local tax rules for SaaS.
- **Generated content:** state who owns outputs and that AI output may need review before publishing.

---

## 16. Performance, accessibility and quality targets

All values are **[TARGET]**, not measured.

| Area | Target |
|---|---|
| Editor interaction | Drag feedback under 100 ms; 60 fps drag on a mid-range laptop for 300 nodes |
| Autosave | Debounced; visible "Saved" state; retry on failure |
| Published sites | Good Core Web Vitals scores on mobile; images served in modern formats with responsive sizes |
| Accessibility (output) | Aim for WCAG 2.1 AA: contrast, alt text required, focus order, keyboard-operable components, reduced-motion respected |
| Accessibility (editor) | Keyboard drag-and-drop, screen-reader labels on panels |
| AI | Layout preview returned within a user-acceptable wait (set the number after measuring); streaming progress for builds |
| Reliability | Autosave plus version history; local copy kept if the server is unreachable |

---

## 17. Roadmap, team and effort

### 17.1 Assumptions
Team of 2-3 experienced full-stack developers plus part-time design. All durations are **[ESTIMATE]**, with wide error bars. A solo beginner should multiply by roughly 2-3. **Re-estimate after Phase 0.**

### 17.2 Phases
| Phase | Scope | Duration **[ESTIMATE]** |
|---|---|---|
| **0. Foundations** | Schema v2, registry, renderer, 8-10 blocks, DnD prototype (nesting, iframe canvas, undo), 1-week base-editor comparison | 3-4 weeks |
| **1. MVP editor** | Single/multi-page editor, style panel (simple), undo/redo, autosave, live preview, basic publish to subdomain, 5 templates (one niche) | 8-10 weeks |
| **2. Projects and media** | Template gallery and mixing, asset upload, image editing, animation presets, version history | 5-7 weeks |
| **3. AI (focused)** | Element prompt, Element Creator Tier A, style reference, then Agent 1 + approval + Agent 2 | 6-8 weeks |
| **4. Launch readiness** | Billing, custom domains, quotas, moderation, legal pages, analytics, export | 4-6 weeks |
| **5. Advanced** | Screenshot-to-blocks, photo layers, Tier B creator, collaboration, brand kit, native mobile | ongoing |

Rough total to a public launch: about 26-35 weeks (6-8 months) for a small experienced team **[ESTIMATE]**. The earlier "MVP in 2-3 months" corresponds only to Phases 0-1 without templates, publishing polish or AI.

### 17.3 MVP definition (first thing to show real users)
**In:** web projects; one niche; 12 elements; 12 block types (about 30 variants); 5 templates; drag-and-drop; simple style panel with device switch; 8-10 animation presets; autosave and undo; publish to subdomain.
**Out:** AI generation, Element Creator, image intelligence, mobile-specific output, custom domains, code export, collaboration.

Why AI is not in the MVP: it depends on a stable registry and patch system, and it adds cost and quality risk. Ship the editor first so the AI has something solid to modify.

---

## 18. Cost model and monetization

### 18.1 How to calculate costs (no invented numbers)
```
AI cost per action  = (input tokens x input price) + (output tokens x output price)
                      + vision/image model cost (if used)
Per-user monthly AI cost = sum over actions (count x cost per action)
Storage cost        = stored GB x storage price + egress GB x CDN price
Image transform     = requests x transform price (or self-hosted compute)
Hosting             = published sites x per-site/bandwidth cost
```
Get current prices from each provider's pricing page **[VERIFY]**, measure real token counts from your own evaluation set, and set credit allowances so the **gross margin per paying user stays positive at the plan's limits**.

### 18.2 Pricing structure (proposal, **[DECIDED, numbers open]**)
| Plan | Includes |
|---|---|
| Free | 1-2 projects, subdomain, platform badge, small storage, limited AI credits, basic templates |
| Pro | More projects, no badge, custom domain, code export, more AI credits and storage, premium templates |
| Team/Agency | Collaboration, shared brand kits, client handoff |
| Add-ons | AI credit packs, template marketplace (creator revenue share) |

Local pricing for India and payment via local methods are a stated differentiator; test willingness to pay with real users before fixing prices **[VERIFY]**.

---

## 19. Risks

| # | Risk | Likelihood / impact **[ESTIMATE]** | Mitigation |
|---|---|---|---|
| 1 | Strong, well-funded competitors | High / High | Narrow niche, finish a small scope, local language and pricing |
| 2 | Scope too large for the team | High / High | Follow the phase plan; no AI in MVP; cut Phase 5 first |
| 3 | Editor complexity (nesting, responsive, undo, performance) | High / High | Phase 0 prototypes; small block set; structured layout model |
| 4 | Template quality is weak | Medium / High | Fewer, better templates; hire/contract design |
| 5 | AI output unreliable or low quality | Medium / High | Registry-only output, validator, retries, evaluation set, niche-tuned prompts |
| 6 | AI and vision costs exceed revenue | Medium / High | Credit limits, caching, cheaper models for simple steps, vision behind credits |
| 7 | Image-to-elements disappoints users | High / Medium | Position as "approximate starting point"; ship style-reference first; low-confidence flags |
| 8 | Abuse (copyright, harmful content, spam sites) | Medium / High | Moderation, ownership confirmation, takedown process, rate limits, report button |
| 9 | Security (XSS, malicious SVG, prompt injection) | Medium / High | Section 15 controls; security review before launch |
| 10 | DnD library churn | Medium / Medium | Stable package behind own interface |
| 11 | Custom-domain and hosting complexity | Medium / Medium | Start with subdomains; evaluate provider features early |
| 12 | Legal exposure (privacy, licenses) | Medium / High | Professional review; license tracking |
| 13 | Founder/team burnout, single point of failure | Medium / High | Smaller milestones, written docs, version control discipline |

---

## 20. Testing strategy

| Layer | What | How |
|---|---|---|
| Schema and patches | Valid/invalid projects, every patch op, scope guard, undo | Unit tests, property-based tests (random patches never produce an invalid project) |
| Renderer | Each block and variant at 3 breakpoints | Snapshot and visual regression tests |
| Editor | Drag, drop, nesting, keyboard DnD, undo/redo | End-to-end tests (Playwright or similar) |
| AI | Schema-valid rate, structure lock, patch scope, regression on evaluation set | Offline evals on 30-50 prompts; re-run on every prompt/model change |
| Uploads | Malicious SVG, wrong MIME, oversized, EXIF | Dedicated security test files |
| Published sites | Accessibility, performance, link checks | Automated audits on a template sample |
| Billing and limits | Quotas, credits, webhooks | Sandbox provider tests |
| Usability | Can a non-technical user publish a site in 15 minutes? | 5-8 moderated sessions per phase |

---

## 21. Success metrics [TARGET]

| Metric | Initial goal (set baselines after first cohort) |
|---|---|
| Time from sign-up to first published site | Under 15 minutes |
| Share of projects that get published | Track; improve each release |
| AI layouts approved on first or second try | Track after launch of AI |
| Valid-and-kept rate of AI patches | Track |
| Week-4 retention | Track |
| Free-to-paid conversion | Track |
| Support burden per 100 users | Track |

---

## 22. Glossary

| Term | Meaning |
|---|---|
| **Block** | Compound pre-designed section with variants |
| **Element** | Smallest unit (heading, button, image) |
| **Registry** | The code definition of all allowed elements/blocks, props, variants, children, style groups |
| **Patch** | A small list of operations that changes the project JSON |
| **Scope guard** | Rule that limits an element prompt's patch to the selected element and its subtree |
| **structureSignature** | Hash of approved structure used to stop Agent 2 changing the layout |
| **Token** | A named design value (for example `padding: "lg"`, `color: "theme.primary"`) |
| **Breakpoint** | Screen-width range with its own style overrides |
| **layerGroup** | Fixed-aspect container with absolutely positioned layers |
| **Reference profile** | Small extracted style summary from an image |
| **PWA** | Installable web app (mobile output in early versions) |

---

## Appendix A. Recommended immediate next steps

1. Answer the **pre-build checklist** in section 0.
2. Write schema v2 (sections 9.2-9.8) and fix the limits in 9.9; add tests that random patches never yield an invalid project.
3. Build the renderer so the example project renders at three breakpoints.
4. Prototype nested drag-and-drop with undo on `@dnd-kit` stable; spend one week comparing against Puck.
5. Design the first 5 templates in the block system.
6. Verify every **[VERIFY]** item that affects cost or legality (pricing pages, provider data terms, custom-domain provider, payment availability).
7. Re-estimate the roadmap with real data from steps 2-4.
