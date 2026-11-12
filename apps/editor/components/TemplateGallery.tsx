"use client";
import { renderDocument } from "@avc/renderer";
import { APP_TEMPLATES, blankProject, cloneProject, mixTemplates, TEMPLATES, type PageRef } from "@avc/templates";
import type { Project } from "@avc/schema";
import { useMemo, useState } from "react";
import { newId, useEditor } from "../lib/store";
import { useCloud } from "../lib/cloud";

function Thumb({ html }: { html: string }) {
  // Real render of the template's home page, scaled down; not interactive.
  return (
    <div style={{ width: "100%", height: 170, overflow: "hidden", position: "relative", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
      <iframe title="preview" srcDoc={html} tabIndex={-1} style={{ width: 1200, height: 900, border: 0, transform: "scale(0.185)", transformOrigin: "0 0", pointerEvents: "none" }} />
    </div>
  );
}

/** A new mobile app with one screen: a header and a tab bar, ready to fill. */
function blankApp(): Project {
  const p = blankProject();
  p.name = "My app";
  p.platform = "mobile";
  const sec = p.pages[0]!.nodes[0]!;
  sec.children = [
    { id: "app_header", kind: "block", type: "appHeader", variant: "colored", props: { title: "My app", subtitle: "Edit me" } },
    { id: "app_tabs", kind: "block", type: "tabBar", variant: "bottom", props: { items: [{ label: "Home", href: "/", icon: "home" }, { label: "More", href: "#more", icon: "menu" }] } },
  ];
  return p;
}

const chip = (on: boolean): React.CSSProperties => ({ padding: "3px 10px", border: "1px solid " + (on ? "#2563eb" : "#d1d5db"), borderRadius: 999, background: on ? "#dbeafe" : "#fff", cursor: "pointer", fontSize: 12 });
const tabBtn = (on: boolean): React.CSSProperties => ({ padding: "6px 14px", border: 0, borderBottom: on ? "2px solid #2563eb" : "2px solid transparent", background: "transparent", cursor: "pointer", fontWeight: on ? 600 : 400 });

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  const loadProject = useEditor((s) => s.loadProject);
  const [tab, setTab] = useState<"templates" | "mix">("templates");
  const [kind, setKind] = useState<Project["platform"]>("web"); // what is being made: a website, a mobile app, or both
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("All");
  const [picked, setPicked] = useState<PageRef[]>([]);
  const [chosenTheme, setChosenTheme] = useState<string | null>(null); // null = follow the home page's template

  const items = useMemo(
    () => TEMPLATES.map((t) => { const p = t.make(); return { meta: t, html: renderDocument(p, p.pages[0]!.id), pages: p.pages, name: p.name }; }),
    [],
  );
  const appItems = useMemo(
    () => APP_TEMPLATES.map((t) => { const p = t.make(); return { meta: t, html: renderDocument(p, p.pages[0]!.id), pages: p.pages, name: p.name }; }),
    [],
  );
  const topics = useMemo(() => ["All", ...new Set(TEMPLATES.map((t) => t.topic))], []);
  const q = query.trim().toLowerCase();
  const visible = (kind === "mobile" ? appItems : items).filter(({ meta, name }) => (topic === "All" || meta.topic === topic) && (!q || [meta.title, meta.description, meta.topic, name, ...meta.tags].some((s) => s.toLowerCase().includes(q))));
  const showBlank = topic === "All" && (!q || "blank empty scratch".includes(q));

  const start = (project: ReturnType<typeof blankProject>, label: string) => {
    // "Website + app" keeps the website's pages and makes them installable; "Mobile app" templates are already apps.
    const typed = kind === "web" || project.platform === "mobile" ? project : { ...project, platform: kind };
    loadProject(cloneProject(typed, () => newId("n")), label);
    useCloud.getState().unlink(); // a new project is a different project: it must not overwrite the one that was linked
    onClose();
  };

  // ---- mix ----
  const key = (r: PageRef) => `${r.templateId}:${r.pageId}`;
  const isPicked = (t: string, p: string) => picked.some((r) => r.templateId === t && r.pageId === p);
  const pathOf = (r: PageRef) => items.find((i) => i.meta.id === r.templateId)!.pages.find((p) => p.id === r.pageId)!.path;
  const usedPaths = new Map(picked.map((r) => [pathOf(r), key(r)]));
  // Until the user picks one, colors/fonts/name follow the template that supplies the home page (else the first page chosen).
  const homeRef = picked.find((r) => pathOf(r) === "/") ?? picked[0];
  const themeFrom = chosenTheme ?? homeRef?.templateId ?? TEMPLATES[0]!.id;
  const toggle = (t: string, p: string) => setPicked((cur) => (cur.some((r) => r.templateId === t && r.pageId === p) ? cur.filter((r) => !(r.templateId === t && r.pageId === p)) : [...cur, { templateId: t, pageId: p }]));
  const mixed = useMemo(() => (picked.length ? mixTemplates(picked, themeFrom, (() => { let n = 0; return () => `pv_${++n}`; })()) : null), [picked, themeFrom]);

  const createMix = () => {
    const r = mixTemplates(picked, themeFrom, () => newId("n"));
    if (r.ok) start(r.project, "a mixed site");
  };

  const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column" };
  const btn: React.CSSProperties = { margin: 10, padding: "6px 12px", border: "1px solid #2563eb", borderRadius: 4, background: "#2563eb", color: "#fff", cursor: "pointer" };

  return (
    <div role="dialog" aria-label="New project" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#f9fafb", borderRadius: 8, padding: 20, width: 760, maxHeight: "88vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h3 style={{ margin: 0, flex: 1 }}>Start a new project</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0" }}>Your current project is kept in History, and you can undo this.</p>

        <div role="radiogroup" aria-label="Project type" style={{ display: "flex", gap: 8, margin: "8px 0 12px", flexWrap: "wrap" }}>
          {([["web", "Website"], ["mobile", "Mobile app"], ["web+mobile", "Website + app"]] as const).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={kind === k} data-testid={`kind-${k}`} onClick={() => { setKind(k); if (k === "mobile") setTab("templates"); }} style={{ padding: "6px 14px", border: "1px solid " + (kind === k ? "#2563eb" : "#d1d5db"), borderRadius: 8, background: kind === k ? "#eff6ff" : "#fff", cursor: "pointer", fontWeight: kind === k ? 600 : 400 }}>{label}</button>
          ))}
        </div>
        <div role="tablist" style={{ display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: 12 }}>
          <button role="tab" aria-selected={tab === "templates"} style={tabBtn(tab === "templates")} onClick={() => setTab("templates")}>Templates</button>
          {kind !== "mobile" && <button role="tab" aria-selected={tab === "mix"} style={tabBtn(tab === "mix")} onClick={() => setTab("mix")}>Mix pages</button>}
        </div>

        {tab === "templates" && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input aria-label="Search templates" placeholder="Search templates (e.g. school, green, pricing)" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 220, padding: 6, border: "1px solid #d1d5db", borderRadius: 4 }} />
              {topics.map((t) => <button key={t} aria-pressed={topic === t} style={chip(topic === t)} onClick={() => setTopic(t)}>{t}</button>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 }}>
              {showBlank && (
                <div style={card}>
                  <div style={{ height: 170, display: "grid", placeItems: "center", color: "#9ca3af", borderBottom: "1px solid #e5e7eb" }}>Blank canvas</div>
                  <div style={{ padding: "8px 10px 0" }}><b>Blank project</b><div style={{ fontSize: 12, color: "#6b7280" }}>Start from scratch</div></div>
                  <button style={{ ...btn, background: "#fff", color: "#2563eb" }} onClick={() => start(kind === "mobile" ? blankApp() : blankProject(), "blank project")}>Use blank</button>
                </div>
              )}
              {visible.map(({ meta, html, pages }) => (
                <div key={meta.id} style={card} data-testid={`template-${meta.id}`}>
                  <Thumb html={html} />
                  <div style={{ padding: "8px 10px 0" }}>
                    <b>{meta.title}</b> <span style={{ fontSize: 11, color: "#6b7280" }}>· {pages.length} pages · {meta.topic}</span>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{meta.description}</div>
                  </div>
                  <button style={btn} onClick={() => start(meta.make(), meta.title)}>Use template</button>
                </div>
              ))}
            </div>
            {visible.length === 0 && !showBlank && <p role="status" style={{ color: "#6b7280" }}>No templates match "{query}". Try a different word, or clear the filters.</p>}
          </>
        )}

        {tab === "mix" && (
          <div data-testid="mix">
            <p style={{ fontSize: 13, color: "#374151", margin: "0 0 10px" }}>
              Pick pages from any templates. They are combined into one site with a single look, one name, and navigation built from the pages you choose.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {items.map(({ meta, pages }) => (
                <fieldset key={meta.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", padding: "6px 10px 8px", margin: 0 }}>
                  <legend style={{ fontWeight: 600, fontSize: 13, padding: "0 4px" }}>{meta.title}</legend>
                  {pages.map((p) => {
                    const mine = isPicked(meta.id, p.id);
                    const taken = !mine && usedPaths.has(p.path); // another page already uses this address
                    return (
                      <label key={p.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, padding: "2px 0", opacity: taken ? 0.5 : 1 }} title={taken ? `Another page already uses ${p.path}` : undefined}>
                        <input type="checkbox" aria-label={`${meta.title}: ${p.name}`} checked={mine} disabled={taken} onChange={() => toggle(meta.id, p.id)} />
                        {p.name} <span style={{ color: "#9ca3af", fontSize: 11 }}>{p.path}</span>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "14px 0 6px", flexWrap: "wrap" }}>
              <label style={{ fontSize: 13 }}>
                Colors, fonts and name from{" "}
                <select aria-label="Theme from" value={themeFrom} onChange={(e) => setChosenTheme(e.target.value)} style={{ padding: 4 }}>
                  {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </label>
              <span style={{ flex: 1 }} />
              <span data-testid="mix-summary" style={{ fontSize: 12, color: "#6b7280" }}>
                {picked.length === 0 ? "No pages chosen" : mixed?.ok ? `${mixed.project.pages.length} pages: ${mixed.project.pages.map((p) => p.name).join(" · ")}` : ""}
              </span>
              <button style={{ ...btn, margin: 0, opacity: mixed?.ok ? 1 : 0.5 }} disabled={!mixed?.ok} onClick={createMix}>
                Create site
              </button>
            </div>
            {mixed && !mixed.ok && <div role="alert" data-testid="mix-error" style={{ color: "#b91c1c", fontSize: 13 }}>{mixed.error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
