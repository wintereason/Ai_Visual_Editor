"use client";
import { useRef } from "react";
import { FONT_PAIRS, PALETTES } from "../lib/brand";
import { newId, useEditor } from "../lib/store";
import { heading, panelStyle, tileBox } from "./Tiles";

const seg = (on: boolean): React.CSSProperties => ({ flex: 1, padding: 6, border: "1px solid #d1d5db", borderRadius: 6, background: on ? "#dbeafe" : "#fff", cursor: "pointer", fontSize: 12 });

const small: React.CSSProperties = { padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 };

/** "Brand kit": the person's own name, logo, colours and font pairs, saved with the project. */
function BrandKit() {
  const { project, commit, assets, assetUrls, addFiles } = useEditor();
  const file = useRef<HTMLInputElement>(null);
  const brand = project.brand ?? {};
  const set = (summary: string, b: object) => commit({ summary, ops: [{ op: "setBrand", brand: b }] as never });
  const logo = brand.logoAssetId ? assets.find((a) => a.id === brand.logoAssetId) : undefined;
  const colors = brand.colors ?? [];
  const fonts = brand.fonts ?? [];
  const cur = project.theme;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    await addFiles(Array.from(files).slice(0, 1));
    const a = useEditor.getState().assets[0];
    if (a) set("Set brand logo", { logoAssetId: a.id });
  };
  const addLogo = () => {
    if (!logo) return;
    const { pageId } = useEditor.getState();
    const page = project.pages.find((p) => p.id === pageId)!;
    const img = { id: newId(), kind: "element", type: "image", props: { assetId: logo.id, alt: (brand.name?.trim() || "Company") + " logo", fit: "contain" }, styles: { base: { normal: { width: { value: 160, unit: "px" } } } } };
    const section = { id: newId(), kind: "container", type: "section", props: {}, children: [img] };
    commit({ summary: "Add logo", ops: [{ op: "insert", parentId: pageId, index: page.nodes.length, node: section }] as never }, { select: img.id });
  };
  const useName = () => {
    const name = brand.name?.trim();
    if (!name) return;
    const ops: object[] = [];
    const walk = (nodes: typeof project.pages[number]["nodes"]) => nodes.forEach((n) => { if (n.type === "navbar") ops.push({ op: "update", id: n.id, props: { brand: name } }); if (n.children) walk(n.children); });
    project.pages.forEach((p) => walk(p.nodes));
    if (ops.length) commit({ summary: "Use brand name in navbars", ops: ops.slice(0, 20) as never });
  };

  return (
    <div data-testid="brand-kit" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 10, border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff" }}>
      <h4 style={heading}>Brand kit</h4>
      <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>Brand name
        <input key={brand.name ?? ""} aria-label="Brand name" defaultValue={brand.name ?? ""} maxLength={60} placeholder="Your school or company" style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (brand.name ?? "")) set("Brand name", { name: v || null }); }} />
      </label>
      {brand.name?.trim() && <button style={small} onClick={useName}>Use this name in my navbars</button>}

      <div style={{ fontSize: 12 }}>Logo</div>
      {logo && assetUrls[logo.id] ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={assetUrls[logo.id]} alt="Your logo" style={{ maxWidth: 110, maxHeight: 56, objectFit: "contain", border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff", padding: 4 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button style={small} onClick={addLogo}>Add logo to page</button>
            <button style={small} onClick={() => set("Remove brand logo", { logoAssetId: null })}>Remove</button>
          </div>
        </div>
      ) : (
        brand.logoAssetId && <div style={{ fontSize: 12, color: "#92400e" }}>The logo file is no longer in your media library.</div>
      )}
      <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Upload logo" hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button style={small} onClick={() => file.current?.click()}>{logo ? "Replace logo…" : "Upload logo…"}</button>
        {assets.length > 0 && (
          <select aria-label="Choose logo from media" value="" onChange={(e) => e.target.value && set("Set brand logo", { logoAssetId: e.target.value })} style={{ ...small, maxWidth: 140 }}>
            <option value="">or pick from Media…</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      <div style={{ fontSize: 12 }}>My colours <span style={{ color: "#6b7280" }}>({colors.length}/12)</span></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {colors.map((c) => (
          <span key={c} style={{ position: "relative" }}>
            <button aria-label={"Use " + c + " as primary colour"} title={c + ": click to make it your primary colour"} onClick={() => commit({ summary: "Brand colour as primary", ops: [{ op: "setTheme", theme: { colors: { primary: c } } }] as never })}
              style={{ width: 30, height: 30, borderRadius: 8, background: c, border: "1px solid rgba(0,0,0,.15)", cursor: "pointer", padding: 0 }} />
            <button aria-label={"Remove " + c} onClick={() => set("Remove brand colour", { colors: colors.filter((x) => x !== c) })} style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 10, lineHeight: "12px", cursor: "pointer", padding: 0 }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input type="color" aria-label="Pick a colour to save" defaultValue="#2563eb" id="brand-pick" style={{ width: 34, height: 28 }} />
        <button style={small} disabled={colors.length >= 12} onClick={() => { const v = (document.getElementById("brand-pick") as HTMLInputElement).value.toUpperCase(); if (!colors.includes(v)) set("Save brand colour", { colors: [...colors, v] }); }}>Save colour</button>
        <button style={small} disabled={colors.length >= 12} onClick={() => { const add = Object.values(cur.colors).map((c) => c.toUpperCase()).filter((c) => /^#[0-9A-F]{6}$/.test(c) && !colors.includes(c)); if (add.length) set("Save theme colours", { colors: [...colors, ...add].slice(0, 12) }); }}>Save current theme colours</button>
      </div>

      <div style={{ fontSize: 12 }}>My fonts <span style={{ color: "#6b7280" }}>({fonts.length}/6)</span></div>
      {fonts.map((f, i) => {
        const on = cur.fonts.heading === f.heading && cur.fonts.body === f.body;
        return (
          <div key={i} style={{ display: "flex", gap: 6 }}>
            <button aria-label={"Use my fonts " + f.heading + " and " + f.body} aria-pressed={on} onClick={() => commit({ summary: "Use brand fonts", ops: [{ op: "setTheme", theme: { fonts: f } }] as never })} style={{ ...small, flex: 1, textAlign: "left", borderColor: on ? "#2563eb" : "#d1d5db", background: on ? "#eff6ff" : "#fff" }}>
              <b style={{ fontFamily: '"' + f.heading + '", sans-serif' }}>{f.heading}</b> + <span style={{ fontFamily: '"' + f.body + '", sans-serif' }}>{f.body}</span>
            </button>
            <button aria-label={"Remove fonts " + f.heading + " and " + f.body} style={small} onClick={() => set("Remove brand fonts", { fonts: fonts.filter((_, j) => j !== i) })}>×</button>
          </div>
        );
      })}
      <button style={small} disabled={fonts.length >= 6 || fonts.some((f) => f.heading === cur.fonts.heading && f.body === cur.fonts.body)} onClick={() => set("Save brand fonts", { fonts: [...fonts, { heading: cur.fonts.heading, body: cur.fonts.body }] })}>Save current fonts ({cur.fonts.heading} + {cur.fonts.body})</button>
    </div>
  );
}

/** Canva-style "Brand": one place to set the site's look: colours, fonts, corners, motion. */
export function BrandPanel() {
  const { project, commit } = useEditor();
  const t = project.theme;
  const set = (summary: string, theme: object) => commit({ summary, ops: [{ op: "setTheme", theme }] as never });
  const same = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).every((k) => a[k]!.toLowerCase() === b[k]!.toLowerCase());
  return (
    <div style={panelStyle} data-testid="brand-panel">
      <BrandKit />
      <h4 style={heading}>Current look</h4>
      <div style={{ display: "flex", gap: 4 }} aria-label="Current colours">
        {Object.entries(t.colors).map(([k, v]) => <span key={k} title={`${k} ${v}`} style={{ flex: 1, height: 26, borderRadius: 6, background: v, border: "1px solid rgba(0,0,0,.12)" }} />)}
      </div>
      <div style={{ fontSize: 12, color: "#4b5563" }}>{t.fonts.heading} + {t.fonts.body}</div>
      <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Changing these restyles every page at once. Fine control is in the <b>Theme</b> tab on the right.</p>

      <h4 style={heading}>Colour palettes</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {PALETTES.map((p) => {
          const on = same(p.colors, t.colors as Record<string, string>);
          return (
            <button key={p.name} aria-label={`Use ${p.name} colours`} aria-pressed={on} onClick={() => set(`Colours: ${p.name}`, { colors: p.colors })}
              style={{ ...tileBox, cursor: "pointer", borderColor: on ? "#2563eb" : "#e5e7eb", boxShadow: on ? "0 0 0 2px #bfdbfe" : "none" }}>
              <div style={{ display: "flex", height: 34 }}>
                {[p.colors.background, p.colors.surface, p.colors.primary, p.colors.secondary, p.colors.text].map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
              </div>
              <div style={{ padding: "4px 8px", fontSize: 11, color: "#374151" }}>{p.name}</div>
            </button>
          );
        })}
      </div>

      <h4 style={heading}>Fonts</h4>
      {FONT_PAIRS.map((f) => {
        const on = t.fonts.heading === f.heading && t.fonts.body === f.body;
        return (
          <button key={f.name} aria-label={`Use ${f.name} fonts`} aria-pressed={on} onClick={() => set(`Fonts: ${f.name}`, { fonts: { heading: f.heading, body: f.body } })}
            style={{ ...tileBox, cursor: "pointer", padding: "8px 12px", borderColor: on ? "#2563eb" : "#e5e7eb", background: on ? "#eff6ff" : "#fff" }}>
            <span style={{ fontFamily: `"${f.heading}", sans-serif`, fontSize: 16, fontWeight: 700, color: "#111827" }}>{f.name}</span>
            <span style={{ fontFamily: `"${f.body}", sans-serif`, fontSize: 12, color: "#4b5563" }}> · {f.heading} / {f.body}</span>
          </button>
        );
      })}

      <h4 style={heading}>Corners</h4>
      <div style={{ display: "flex", gap: 4 }}>{(["none", "sm", "md", "lg", "full"] as const).map((r) => <button key={r} style={seg(t.radius === r)} onClick={() => set(`Corners: ${r}`, { radius: r })}>{r}</button>)}</div>
      <h4 style={heading}>Motion</h4>
      <div style={{ display: "flex", gap: 4 }}>{(["off", "subtle", "full"] as const).map((m) => <button key={m} style={seg(t.motion === m)} onClick={() => set(`Motion: ${m}`, { motion: m })}>{m}</button>)}</div>
    </div>
  );
}
