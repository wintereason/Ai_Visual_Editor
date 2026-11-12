"use client";
import { renderDocument } from "@avc/renderer";
import { addDraftPage, addDraftSection, MAX_DRAFT_PAGES, MAX_DRAFT_SECTIONS, moveDraftSection, removeDraftPage, removeDraftSection, renameDraftPage, type Node, type Page, type Project, type Theme } from "@avc/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { askAi, newRequestKey, progressText, type AiProgress, type StyleResponse } from "../lib/ai";
import { prepareStyleImage, StyleImageError, type PreparedImage } from "../lib/styleImage";
import { useCloud } from "../lib/cloud";
import { LIBRARY } from "../lib/library";
import { newId, useEditor } from "../lib/store";

type Option = { name: string; tree: Node };
type Style = "minimal" | "bold" | "playful" | "corporate";
type PageState = { status: "waiting" | "building" | "done" | "failed"; message?: string };

const btn: React.CSSProperties = { padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 };
const primary = (on: boolean): React.CSSProperties => ({ ...btn, flex: 1, background: on ? "#2563eb" : "#e5e7eb", color: on ? "#fff" : "#6b7280", borderColor: on ? "#2563eb" : "#d1d5db" });
const input: React.CSSProperties = { width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13, boxSizing: "border-box" };
const warn: React.CSSProperties = { marginTop: 10, padding: 8, background: "#fef2f2", color: "#b91c1c", borderRadius: 4, fontSize: 12 };

/** A fresh id for every node, so inserting a suggestion twice (or into a project that already has these ids) never collides. */
function reId(n: Node): Node {
  return { ...n, id: newId(), children: n.children?.map(reId) };
}

function Preview({ project, tree }: { project: Project; tree: Node }) {
  const doc = useMemo(() => {
    const p: Project = { ...project, pages: [{ id: "pv", name: "Preview", path: "/", nodes: [{ id: "pvs", kind: "container", type: "section", props: {}, children: [tree] }] }] };
    try { return renderDocument(p, "pv"); } catch { return ""; }
  }, [project.theme, tree]);
  // sandbox="" : generated content never runs script, even though the renderer already escapes it.
  return <iframe title="Preview" sandbox="" srcDoc={doc} style={{ width: "100%", height: 150, border: "1px solid #e5e7eb", borderRadius: 4, background: "#fff" }} />;
}

function Gate({ available, signedIn }: { available: boolean; signedIn: boolean }) {
  if (signedIn) return null;
  return (
    <div role="note" data-testid="create-signin" style={{ padding: 8, background: "#eff6ff", borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
      {available ? "Sign in (top right) to use AI." : "AI needs an account, and this copy has no backend configured."}
    </div>
  );
}

function ElementCreator({ signedIn, available }: { signedIn: boolean; available: boolean }) {
  const { project, pageId, commit } = useEditor();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const t = text.trim();
  const can = signedIn && t.length > 0 && t.length <= 600 && !busy;

  const go = async () => {
    if (!can) return;
    setBusy(true); setError(null); setOptions([]); setAdded(null); setProgress(null);
    ctl.current = new AbortController();
    const r = await askAi<{ options: Option[] }>("element", { theme: project.theme, prompt: t, idempotencyKey: newRequestKey() }, ctl.current.signal, setProgress);
    setBusy(false); setProgress(null);
    if (!r.ok) { if (r.code !== "cancelled") setError(r.message); return; }
    setOptions(r.data.options);
  };

  const insert = (o: Option) => {
    const page = project.pages.find((p) => p.id === pageId);
    const section: Node = { id: newId(), kind: "container", type: "section", props: {}, children: [reId(o.tree)] };
    const ok = commit({ summary: `Add ${o.name}`, ops: [{ op: "insert", parentId: pageId, index: page?.nodes.length ?? 0, node: section }] }, { select: section.id });
    if (ok) setAdded(o.name);
  };

  return (
    <div>
      <Gate available={available} signedIn={signedIn} />
      <textarea aria-label="Describe the element" value={text} maxLength={800} disabled={busy} onChange={(e) => setText(e.target.value)}
        placeholder="e.g. a pricing card with three plans" style={{ ...input, minHeight: 70, resize: "vertical" }} />
      <div style={{ fontSize: 11, color: "#6b7280", textAlign: "right" }}>{t.length} / 600</div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button style={primary(can)} disabled={!can} onClick={() => void go()}>{busy ? progressText(progress) : "✦ Suggest 3 options"}</button>
        {busy && <button style={btn} onClick={() => ctl.current?.abort()}>Cancel</button>}
      </div>
      {error && <div role="alert" data-testid="create-error" style={warn}>⚠ {error}</div>}
      {added && <div role="status" style={{ marginTop: 8, fontSize: 12, color: "#166534" }}>✔ Added “{added}” at the end of the page. You can undo it.</div>}
      {options.map((o, i) => (
        <div key={i} data-testid="element-option" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{o.name}</div>
          <Preview project={project} tree={o.tree} />
          <button style={{ ...btn, marginTop: 4 }} onClick={() => insert(o)}>Add to page</button>
        </div>
      ))}
    </div>
  );
}

const BLOCKS = LIBRARY.filter((i) => i.group === "Blocks");
/** A fresh top-level section holding one block of the given type. */
const sectionOf = (type: string): Node => ({ id: newId(), kind: "container", type: "section", props: {}, children: [BLOCKS.find((b) => b.type === type)!.make()] });

const sectionLabel = (s: Node) => (s.children ?? []).map((c) => c.type).join(" · ") || s.type;

/** A scaled-down, script-free picture of a page. Sandboxed, so generated content can never run code here. */
function PagePreview({ project, pageId }: { project: Project; pageId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setScale(Math.max(0.05, el.clientWidth / 1280)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const doc = useMemo(() => { try { return renderDocument(project, pageId); } catch { return ""; } }, [project, pageId]);
  return (
    <div ref={box} data-testid="page-preview" style={{ width: "100%", height: 900 * scale, overflow: "hidden", border: "1px solid #e5e7eb", borderRadius: 4, marginTop: 6, background: "#fff" }}>
      <iframe title="Page preview" sandbox="" srcDoc={doc} tabIndex={-1} style={{ width: 1280, height: 900, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }} />
    </div>
  );
}

function SiteBuilder({ signedIn, available }: { signedIn: boolean; available: boolean }) {
  const { loadProject } = useEditor();
  const [step, setStep] = useState<"brief" | "review" | "build">("brief");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("minimal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Project | null>(null);
  const [states, setStates] = useState<Record<string, PageState>>({});
  const [applied, setApplied] = useState(false);
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const [open, setOpen] = useState<string | null>(null); // page whose preview is showing
  const ctl = useRef<AbortController | null>(null);
  const t = prompt.trim();
  const can = signedIn && t.length > 0 && t.length <= 1500 && !busy;
  const brief = { prompt: t, style };

  const design = async () => {
    if (!can) return;
    setBusy(true); setError(null); setProgress(null);
    ctl.current = new AbortController();
    const r = await askAi<{ project: Project }>("layout", { brief, idempotencyKey: newRequestKey() }, ctl.current.signal, setProgress);
    setBusy(false); setProgress(null);
    if (!r.ok) { if (r.code !== "cancelled") setError(r.message); return; }
    setDraft(r.data.project); setStates({}); setApplied(false); setStep("review");
  };

  /** Builds every page in turn; a page that fails keeps its approved structure and can be retried alone. */
  const build = async (only?: string[]) => {
    if (!draft) return;
    setStep("build"); setBusy(true); setError(null);
    ctl.current = new AbortController();
    let current = draft;
    const ids = only ?? draft.pages.map((p) => p.id);
    for (const id of ids) {
      if (ctl.current.signal.aborted) break;
      setProgress(null);
      setStates((s) => ({ ...s, [id]: { status: "building" } }));
      // The server needs the approved project (for the structure lock) but only builds the one page.
      const r = await askAi<{ page: Page }>("build_page", { project: current, pageId: id, brief, idempotencyKey: newRequestKey() }, ctl.current.signal, setProgress);
      if (r.ok) {
        current = { ...current, pages: current.pages.map((p) => (p.id === id ? r.data.page : p)) };
        setDraft(current);
        setStates((s) => ({ ...s, [id]: { status: "done" } }));
      } else {
        setStates((s) => ({ ...s, [id]: { status: r.code === "cancelled" ? "waiting" : "failed", message: r.message } }));
        // Out of credits or signed out: the remaining pages would fail the same way, so stop here.
        if (["insufficient_credits", "daily_cap", "unauthorized", "signin", "rate_limited"].includes(r.code) || r.status === 401 || r.status === 402 || r.status === 429) { setError(r.message); break; }
      }
    }
    setBusy(false); setProgress(null);
  };

  const edit = (fn: (p: Project) => Project) => setDraft((d) => (d ? fn(d) : d));
  const [newPage, setNewPage] = useState("");
  /** A new page starts as navbar, hero, footer; the build step then writes real content for it like any other page. */
  const addPage = () => {
    edit((d) => addDraftPage(d, newPage, newId("pg"), [sectionOf("navbar"), sectionOf("hero"), sectionOf("footer")]));
    setNewPage("");
  };

  const apply = () => {
    if (!draft) return;
    loadProject(draft, "AI site"); // undoable, and the previous project is snapshotted
    setApplied(true);
  };

  const failed = draft ? draft.pages.filter((p) => states[p.id]?.status === "failed" || states[p.id]?.status === "waiting").map((p) => p.id) : [];
  const allDone = !!draft && draft.pages.every((p) => states[p.id]?.status === "done");
  const anyDone = !!draft && draft.pages.some((p) => states[p.id]?.status === "done");

  if (step === "brief") {
    return (
      <div>
        <Gate available={available} signedIn={signedIn} />
        <textarea aria-label="Describe the website" value={prompt} maxLength={1700} disabled={busy} onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. a website for a Pune coaching class for class 10 maths, with admissions and contact" style={{ ...input, minHeight: 90, resize: "vertical" }} />
        <div style={{ fontSize: 11, color: "#6b7280", textAlign: "right" }}>{t.length} / 1500</div>
        <label style={{ fontSize: 12 }}>Style{" "}
          <select aria-label="Style" value={style} onChange={(e) => setStyle(e.target.value as Style)} style={{ fontSize: 12 }}>
            {(["minimal", "bold", "playful", "corporate"] as const).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button style={primary(can)} disabled={!can} onClick={() => void design()}>{busy ? progressText(progress, "Designing") : "✦ Design layout"}</button>
          {busy && <button style={btn} onClick={() => ctl.current?.abort()}>Cancel</button>}
        </div>
        <p style={{ fontSize: 11, color: "#6b7280" }}>Step 1 designs the structure only. You approve it before any text is written, and nothing in your project changes until you choose to apply it.</p>
        {error && <div role="alert" data-testid="create-error" style={warn}>⚠ {error}</div>}
      </div>
    );
  }

  return (
    <div data-testid="site-builder">
      <div style={{ fontSize: 12, fontWeight: 600 }}>{step === "review" ? "Review the layout" : "Writing the pages"}</div>
      {draft?.pages.map((p) => {
        const s = states[p.id];
        return (
          <div key={p.id} data-testid="site-page" style={{ marginTop: 8, padding: 8, border: "1px solid #e5e7eb", borderRadius: 4, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
              {step === "review"
                ? <input aria-label={`Name of page ${p.path}`} key={p.id} defaultValue={p.name} maxLength={60} onBlur={(e) => { const next = renameDraftPage(draft, p.id, e.target.value); if (next === draft) e.target.value = p.name; else edit((d) => renameDraftPage(d, p.id, e.target.value)); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} style={{ ...input, padding: 4, fontWeight: 600, flex: 1 }} />
                : <b>{p.name}</b>}
              <span data-testid="page-status" style={{ whiteSpace: "nowrap" }}>{s?.status === "building" ? progressText(progress, "Writing") : s?.status === "done" ? "✔ Done" : s?.status === "failed" ? "✖ Failed" : step === "build" ? "Waiting" : ""}</span>
            </div>
            <ol style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
              {p.nodes.map((n, i) => (
                <li key={n.id} data-testid="section-row" style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0", color: "#4b5563" }}>
                  <span style={{ flex: 1 }}>{sectionLabel(n)}</span>
                  {step === "review" && <>
                    <button style={{ ...btn, padding: "1px 6px" }} aria-label={`Move ${sectionLabel(n)} up`} disabled={i === 0} onClick={() => edit((d) => moveDraftSection(d, p.id, n.id, -1))}>↑</button>
                    <button style={{ ...btn, padding: "1px 6px" }} aria-label={`Move ${sectionLabel(n)} down`} disabled={i === p.nodes.length - 1} onClick={() => edit((d) => moveDraftSection(d, p.id, n.id, 1))}>↓</button>
                    <button style={{ ...btn, padding: "1px 6px" }} aria-label={`Remove ${sectionLabel(n)}`} disabled={p.nodes.length <= 1} onClick={() => edit((d) => removeDraftSection(d, p.id, n.id))}>✕</button>
                  </>}
                </li>
              ))}
            </ol>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button style={btn} aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Hide preview" : "Preview"}</button>
              {step === "review" && <button style={btn} disabled={p.path === "/" || draft.pages.length <= 1} title={p.path === "/" ? "The home page can't be removed" : undefined} onClick={() => edit((d) => removeDraftPage(d, p.id))}>Remove page</button>}
            </div>
            {step === "review" && (
              <select aria-label={`Add a section to ${p.name}`} value="" disabled={p.nodes.length >= MAX_DRAFT_SECTIONS} style={{ ...input, padding: 4, marginTop: 6, fontSize: 12 }}
                onChange={(e) => { if (e.target.value) edit((d) => addDraftSection(d, p.id, sectionOf(e.target.value))); }}>
                <option value="">＋ Add a section…</option>
                {BLOCKS.map((b) => <option key={b.type} value={b.type}>{b.label}</option>)}
              </select>
            )}
            {open === p.id && draft && <PagePreview project={draft} pageId={p.id} />}
            {s?.status === "failed" && <div style={{ color: "#b91c1c", marginTop: 4 }}>{s.message}</div>}
          </div>
        );
      })}
      {step === "review" && draft && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input aria-label="New page name" value={newPage} maxLength={60} placeholder="New page name" onChange={(e) => setNewPage(e.target.value)} style={{ ...input, padding: 4, flex: 1 }}
            onKeyDown={(e) => { if (e.key === "Enter") addPage(); }} />
          <button style={btn} disabled={!newPage.trim() || draft.pages.length >= MAX_DRAFT_PAGES} onClick={addPage}>Add page</button>
        </div>
      )}
      {error && <div role="alert" data-testid="create-error" style={warn}>⚠ {error}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {step === "review" && <button style={primary(true)} onClick={() => void build()}>Approve &amp; write text</button>}
        {step === "review" && <button style={btn} onClick={() => setStep("brief")}>Back</button>}
        {step === "build" && busy && <button style={btn} onClick={() => ctl.current?.abort()}>Stop</button>}
        {step === "build" && !busy && failed.length > 0 && <button style={btn} onClick={() => void build(failed)}>Retry {failed.length} page{failed.length === 1 ? "" : "s"}</button>}
        {step === "build" && !busy && anyDone && !applied && <button style={primary(true)} onClick={apply}>{allDone ? "Use this site" : "Use what's done"}</button>}
        {step === "review" && !busy && !applied && <button style={btn} onClick={apply}>Use layout only</button>}
      </div>
      {applied && <div role="status" data-testid="site-applied" style={{ marginTop: 8, fontSize: 12, color: "#166534" }}>✔ Applied. Use Undo (Ctrl+Z) to go back; your previous version is saved in History.</div>}
      {(step === "build" || applied) && !busy && <button style={{ ...btn, marginTop: 8 }} onClick={() => { setStep("brief"); setDraft(null); setStates({}); setApplied(false); }}>Start over</button>}
    </div>
  );
}

const COLOR_NAMES: [keyof Theme["colors"], string][] = [["primary", "Main"], ["secondary", "Accent"], ["background", "Page"], ["surface", "Cards"], ["text", "Text"], ["muted", "Soft text"]];
const RADIUS_PX: Record<Theme["radius"], number> = { none: 0, sm: 4, md: 8, lg: 16, full: 999 };

/** A tiny sample of what a theme looks like. Every value was validated (hex colours, fonts from a fixed list), and it only sets inline styles. */
function ThemeSample({ theme }: { theme: Theme }) {
  const c = theme.colors;
  return (
    <div data-testid="theme-sample" style={{ background: c.background, color: c.text, fontFamily: theme.fonts.body, padding: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}>
      <div style={{ fontFamily: theme.fonts.heading, fontSize: 18, fontWeight: 700 }}>Welcome</div>
      <div style={{ color: c.muted, fontSize: 12, margin: "2px 0 8px" }}>A short line of supporting text.</div>
      <div style={{ background: c.surface, padding: 8, borderRadius: RADIUS_PX[theme.radius], fontSize: 12, marginBottom: 8 }}>A card on your page</div>
      <span style={{ background: c.primary, color: "#fff", padding: "5px 12px", borderRadius: RADIUS_PX[theme.radius], fontSize: 12, display: "inline-block" }}>Get started</span>
      <span style={{ background: c.secondary, width: 14, height: 14, borderRadius: RADIUS_PX[theme.radius], display: "inline-block", marginLeft: 8, verticalAlign: "middle" }} />
    </div>
  );
}

function StyleFromPicture({ signedIn, available }: { signedIn: boolean; available: boolean }) {
  const { commit } = useEditor();
  const [picked, setPicked] = useState<PreparedImage | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StyleResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const can = signedIn && !!picked && !busy;

  const choose = async (file: File | undefined) => {
    setError(null); setResult(null); setApplied(false);
    if (!file) { setPicked(null); return; }
    try { setPicked(await prepareStyleImage(file)); }
    catch (e) { setPicked(null); setError(e instanceof StyleImageError ? e.message : "That picture couldn't be used."); }
  };
  const go = async () => {
    if (!can || !picked) return;
    setBusy(true); setError(null); setResult(null); setApplied(false); setProgress(null);
    ctl.current = new AbortController();
    const r = await askAi<StyleResponse>("style", { image: { mediaType: picked.mediaType, data: picked.data }, ...(hint.trim() ? { hint: hint.trim() } : {}), idempotencyKey: newRequestKey() }, ctl.current.signal, setProgress);
    setBusy(false); setProgress(null);
    if (!r.ok) { if (r.code !== "cancelled") setError(r.message); return; }
    setResult(r.data);
  };
  const apply = () => {
    if (!result) return;
    // The server's answer is untrusted input: it goes through the same write path as every other change.
    const ok = commit({ summary: "Apply style from picture", ops: [{ op: "setTheme", theme: { colors: result.theme.colors, fonts: result.theme.fonts, radius: result.theme.radius, motion: result.theme.motion } }] });
    if (ok) setApplied(true); else setError("I couldn't apply that style safely. Nothing was changed.");
  };

  return (
    <div>
      <Gate available={available} signedIn={signedIn} />
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 8px" }}>Choose a website screenshot, poster, logo or photo you like. The AI suggests colours and fonts in that style. Only the look changes, never your content, and you can undo it.</p>
      <input type="file" aria-label="Choose a picture" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} style={{ fontSize: 12, maxWidth: "100%" }} />
      {picked && <img data-testid="style-preview" src={picked.preview} alt="The picture you chose" style={{ display: "block", maxWidth: "100%", maxHeight: 140, marginTop: 8, borderRadius: 4, border: "1px solid #e5e7eb" }} />}
      <input aria-label="Style note (optional)" value={hint} maxLength={200} disabled={busy} placeholder="Optional: e.g. more playful" onChange={(e) => setHint(e.target.value)} style={{ ...input, marginTop: 8, padding: 6 }} />
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button style={primary(can)} disabled={!can} onClick={() => void go()}>{busy ? progressText(progress, "Looking at it") : "✦ Find the style"}</button>
        {busy && <button style={btn} onClick={() => ctl.current?.abort()}>Cancel</button>}
      </div>
      <p style={{ fontSize: 11, color: "#6b7280" }}>The picture is shrunk in your browser, its hidden details are removed, and it is used only for this request.</p>
      {error && <div role="alert" data-testid="create-error" style={warn}>⚠ {error}</div>}
      {result && (
        <div data-testid="style-result" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>{result.notes}</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            {COLOR_NAMES.map(([k, label]) => (
              <div key={k} style={{ flex: 1, textAlign: "center", fontSize: 10 }}>
                <div data-testid={`swatch-${k}`} title={result.theme.colors[k]} style={{ height: 24, background: result.theme.colors[k], border: "1px solid #d1d5db", borderRadius: 4 }} />{label}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>Fonts: {result.theme.fonts.heading} / {result.theme.fonts.body} · Corners: {result.theme.radius} · Motion: {result.theme.motion}</div>
          <ThemeSample theme={result.theme} />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button style={primary(!applied)} disabled={applied} onClick={apply}>{applied ? "✔ Applied" : "Apply to my site"}</button>
            <button style={btn} onClick={() => void go()} disabled={busy}>Try again</button>
          </div>
          {applied && <div role="status" style={{ marginTop: 6, fontSize: 12, color: "#166534" }}>Applied. You can undo it with Ctrl+Z or fine-tune it in the Theme tab.</div>}
        </div>
      )}
    </div>
  );
}

export function CreatePanel() {
  const { available, user } = useCloud();
  const signedIn = available && !!user;
  const [mode, setMode] = useState<"element" | "site" | "style">("element");
  return (
    <div style={{ padding: 12, fontSize: 13 }} data-testid="create-panel">
      <div style={{ fontWeight: 600 }}>✦ Create with AI</div>
      <div role="group" aria-label="What to create" style={{ display: "flex", gap: 4, margin: "8px 0" }}>
        {([["element", "An element"], ["site", "A whole site"], ["style", "Style from a picture"]] as const).map(([k, l]) => (
          <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)} style={{ ...btn, flex: 1, background: mode === k ? "#eff6ff" : "#fff", borderColor: mode === k ? "#2563eb" : "#d1d5db" }}>{l}</button>
        ))}
      </div>
      {mode === "element" ? <ElementCreator signedIn={signedIn} available={available} /> : mode === "site" ? <SiteBuilder signedIn={signedIn} available={available} /> : <StyleFromPicture signedIn={signedIn} available={available} />}
    </div>
  );
}
