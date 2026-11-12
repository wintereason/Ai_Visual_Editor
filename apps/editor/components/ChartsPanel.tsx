"use client";
import { CHART_ITEMS } from "../lib/catalog";
import { appendItem, heading, panelStyle, TileGrid } from "./Tiles";

const GROUPS: [string, string[]][] = [["Bar charts", ["chart-bar", "chart-row"]], ["Line and area charts", ["chart-line", "chart-area"]], ["Pie and donut charts", ["chart-pie", "chart-donut"]]];

/** Canva-style "Charts": pick a type, then type your own numbers in the right-hand panel (the "data" list). */
export function ChartsPanel() {
  return (
    <div style={panelStyle} data-testid="charts-panel">
      <button onClick={() => appendItem(CHART_ITEMS[0]!)} style={{ padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 10, background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>▦&nbsp; Start with data</button>
      <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>Add a chart, then change its labels and numbers in the right-hand panel under <b>data</b>.</p>
      {GROUPS.map(([title, keys]) => (
        <div key={title} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h4 style={heading}>{title}</h4>
          <TileGrid items={CHART_ITEMS.filter((c) => keys.includes(c.key))} frame={[400, 240]} columns={2} />
        </div>
      ))}
    </div>
  );
}
