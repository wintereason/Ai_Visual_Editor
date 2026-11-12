# Editor: panels, brand kit and photo layers

## The left tool strip
Templates (page templates, with live previews), Elements (search plus 11 categories), Text, Brand, Blocks, Media, Background, Charts, Layers, Pages, Create (AI).
Everything you can add is built from the page format's own element types, so it validates, exports and can be edited and undone like anything else.
The catalogue lives in `apps/editor/lib/catalog.ts` (add an item = one line); palettes, font pairs and gradients in `lib/brand.ts`.

## New element types
`shape` (26 built-in shapes), `icon` (48 line icons), `chart` (bar, row, line, area, pie, donut from a list of label/value pairs) and `table`
(columns plus rows written as `cell | cell | cell`). All are drawn as plain SVG/HTML: no scripts, no outside requests, fine under the strict page policy.
Charts take one series of non-negative numbers (up to 12). Shapes and icons take their colour from the "Text colour" style.

## Brand kit (Brand tab)
Stored in the project as `brand`: a name, a logo (a Media file), up to 12 saved colours and up to 6 saved font pairs. Names, saved swatches and saved fonts are
editor-only: they are **not** written into a published site unless you use them. The logo file is protected from deletion in Media, but is only
published once you place it on a page ("Add logo to page").

## Photo layers (`layerGroup`)
A fixed-shape canvas (1:1, 4:3, 3:2, 16:9, 3:4, 2:3 or 9:16) whose children are **layers** placed by percentage (`place`: left, top, width, rotation).
Because everything is a percentage, the whole composition scales together on any screen. Later layers sit on top.
- Add a starter from Elements > Photo layers, then drag layers to move them, drag a layer's corner to resize, or type exact numbers in the Inspector.
- Stacking (to front / forward / backward / to back), hide, and the Layers tab work on layers like on anything else.
- A layer's width always comes from its placement. Text inside a layer keeps its own size (it does not shrink with the canvas); size it for the canvas you chose.
- Moving a layer out of a group removes its placement; moving one in gives it a visible starting position.

### Not built: cutting a photo into object layers
The spec lists "break a photo into object layers (transparent PNGs)" as needing a **hosted segmentation model**. There is none connected, so this is not built
and nothing pretends to do it. Today you build layers yourself (pictures, text, shapes, icons). Adding automatic cut-outs needs a model provider chosen and tested first.

## Collaboration (sharing a project)
Needs migration 6 (`docs/backend.md`, section 2g) and a signed-in account. Save the project to the cloud, then **Share** (top bar): invite people by email as **Can edit** or **Can view**.
- The invited person gets access the next time they sign in (or open Projects) with that email, and sees it under "Projects > Shared with you". Up to 10 people.
- **Editors** change the project like the owner. **Viewers** see everything but every change is refused (the editor locks, with a "View only" badge).
- Only the **owner** can publish, share, delete, set up contact-form delivery, or read the form inbox. A collaborator's AI requests use their own credits.
- Other people's saves show up on their own within about 15 seconds (the editor checks every 15 s, only while the project is actually shared). If you have unsaved edits at that moment you are asked
  which version to keep; nothing is overwritten silently. Undo does not step back across someone else's changes.
- If the owner removes you, or changes you from editor to viewer, you are told and the editor adjusts. Your copy stays on your device.
- Pictures used by a shared project are visible to everyone on it; a picture a collaborator adds becomes visible to the others once the project uses it.

### Not built (honest limits)
- **Not live typing.** There are no shared cursors and no character-by-character co-editing. It is "last save wins, with a prompt if two people overlap". Truly simultaneous editing of the same page
  would need a real-time engine (Supabase Realtime plus a merge strategy such as CRDTs): a much larger piece of work.
- There is no activity log ("who changed what"), no comments, and no ownership transfer.
- "Download all my data" includes only projects you own, not ones shared with you.
- Not verified against a real Supabase: the SQL runs against an in-memory Postgres (PGlite) with the same row-level-security rules, and the editor against a stand-in server. After applying migration 6, run the two-account smoke test once (`node scripts/smoke-supabase.mjs run <emailA> <emailB>`); it now includes sharing checks.
