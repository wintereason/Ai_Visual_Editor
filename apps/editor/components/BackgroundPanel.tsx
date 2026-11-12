"use client";
import { useState } from "react";
import { getDef } from "@avc/schema";
import { GRADIENTS, PALETTES, readableTextOn, SOLIDS, type GradientDef } from "../lib/brand";
import { findNode, useEditor } from "../lib/store";
import { chipStyle, heading, panelStyle } from "./Tiles";

const css = (g: GradientDef) => `linear-gradient(${g.angle}deg, ${g.stops.map((s) => `${s.color} ${s.at}%`).join(", ")})`;
const swatch: React.CSSProperties = { width: "100%", aspectRatio: "1 / 1", borderRadius: 8, border: "1px solid rgba(0,0,0,.12)", cursor: "pointer", padding: 0 };

/** Canva-style "Background": colours, gradients and your own pictures, for the selected box, or every section on the page. */
export function BackgroundPanel() {
  const { project, pageId, selection, device, commit, assets, assetUrls } = useEditor();
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const found = selection ? findNode(project, selection) : null;
  const canSelected = !!found && !!getDef(found.node.type)?.styleGroups.includes("background");
  const page = project.pages.find((p) => p.id === pageId)!;
  const targets = scope === "selected" && canSelected ? [found!.node] : page.nodes.filter((n) => n.type === "section");
  const effective = scope === "selected" && canSelected ? "selected" : "all";

  const apply = (background: unknown, textOn: string | null, summary: string) => {
    if (!targets.length) return;
    const style: Record<string, unknown> = { background };
    if (background !== null) style.color = textOn; // keep words readable on the new background (null = leave as it was)
    if (background === null) delete style.color;
    commit({ summary, ops: targets.map((n) => ({ op: "update", id: n.id, styles: { [device]: { normal: style } } })) as never });
  };
  const solid = (hex: string) => apply(hex, readableTextOn([hex]), "Background colour");
  const themed = (token: string, hex: string) => apply(`theme.${token}`, readableTextOn([hex]), "Background colour");
  const gradient = (g: GradientDef) => apply({ type: "linear", angle: g.angle, stops: g.stops }, readableTextOn(g.stops.map((s) => s.color)), `Background: ${g.name}`);
  const picture = (id: string) => apply({ assetId: id, fit: "cover", overlay: 0.35 }, "#FFFFFF", "Background picture");

  return (
    <div style={panelStyle} data-testid="background-panel">
      <h4 style={heading}>Background</h4>
      <div role="group" aria-label="Apply to" style={{ display: "flex", gap: 5 }}>
        <button style={chipStyle(effective === "selected")} aria-pressed={effective === "selected"} disabled={!canSelected} onClick={() => setScope("selected")}>Selected box</button>
        <button style={chipStyle(effective === "all")} aria-pressed={effective === "all"} onClick={() => setScope("all")}>Every section on this page</button>
      </div>
      <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
        {effective === "selected" ? "Changing the box you selected on the canvas." : canSelected || !selection ? `Changing all ${targets.length} sections on this page.` : "Select a section or box on the canvas to change just that one."}
        {" "}Text colour is adjusted so it stays readable.
      </p>
      <button style={{ ...chipStyle(false), alignSelf: "flex-start" }} onClick={() => apply(null, null, "Clear background")}>No background</button>

      <h4 style={heading}>Your theme colours</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
        {(["primary", "secondary", "surface", "background"] as const).map((k) => (
          <button key={k} aria-label={`Theme ${k}`} title={k} onClick={() => themed(k, project.theme.colors[k])} style={{ ...swatch, background: project.theme.colors[k] }} />
        ))}
      </div>
      <h4 style={heading}>Colours</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
        {[...SOLIDS, ...PALETTES.map((p) => p.colors.primary)].map((c, i) => <button key={c + i} aria-label={`Colour ${c}`} title={c} onClick={() => solid(c)} style={{ ...swatch, background: c }} />)}
      </div>
      <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <input type="color" aria-label="Pick any colour" defaultValue="#2563eb" onChange={(e) => solid(e.target.value.toUpperCase())} /> Pick any colour
      </label>

      <h4 style={heading}>Gradients</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {GRADIENTS.map((g) => <button key={g.name} aria-label={`Gradient ${g.name}`} title={g.name} onClick={() => gradient(g)} style={{ ...swatch, background: css(g) }} />)}
      </div>

      <h4 style={heading}>Your pictures</h4>
      {assets.length === 0 && <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Upload pictures in the Media tab, then use them as a background here.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {assets.filter((a) => assetUrls[a.id]).slice(0, 24).map((a) => (
          <button key={a.id} aria-label={`Use ${a.name} as background`} title={a.name} onClick={() => picture(a.id)} style={{ ...swatch, background: `center / cover url(${assetUrls[a.id]})` }} />
        ))}
      </div>
    </div>
  );
}
