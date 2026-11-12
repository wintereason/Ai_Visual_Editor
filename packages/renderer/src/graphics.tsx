import React from "react";
import { ICONS, SHAPES, type ChartType } from "@avc/schema";

// Pure SVG/HTML, no scripts and no outside requests: safe under the strict page policy, and printable/accessible.

export const GRAPHICS_CSS =
  `.avc-icon{width:48px;height:48px;display:inline-block;color:var(--c-primary);flex:none}` +
  `.avc-shape{width:120px;aspect-ratio:1/1;height:auto;display:block;color:var(--c-primary);flex:none}` +
  `.avc-chart{display:block;width:100%;max-width:560px;height:auto;color:var(--c-text)}` +
  `.avc-chart text{font-family:inherit}` +
  `.avc-tablewrap{overflow-x:auto}` +
  `.avc-table{border-collapse:collapse;width:100%}` +
  `.avc-table caption{text-align:left;font-weight:600;padding:0 0 8px}` +
  `.avc-table th,.avc-table td{padding:10px 14px;text-align:left;border-bottom:1px solid color-mix(in srgb,var(--c-text) 14%,transparent)}` +
  `.avc-table thead th{background:var(--c-primary);color:#fff;border-bottom:0}` +
  `.avc-table tbody tr:nth-child(even){background:var(--c-surface)}`;

type Common = Record<string, unknown>;

export function IconEl({ name, common }: { name: unknown; common: Common }) {
  const def = typeof name === "string" && Object.hasOwn(ICONS, name) ? ICONS[name]! : null;
  if (!def) return null;
  const cn = `avc-icon ${String(common.className ?? "")}`.trim();
  return (
    <svg {...common} className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={def.d} />
    </svg>
  );
}

/** A small icon for use inside other blocks (tab bars, list rows). Unknown names draw nothing. */
export function MiniIcon({ name, size = 24 }: { name: unknown; size?: number }) {
  const def = typeof name === "string" && Object.hasOwn(ICONS, name) ? ICONS[name]! : null;
  if (!def) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={def.d} />
    </svg>
  );
}

export function ShapeEl({ shape, label, common }: { shape: unknown; label?: unknown; common: Common }) {
  const def = typeof shape === "string" && Object.hasOwn(SHAPES, shape) ? SHAPES[shape]! : null;
  if (!def) return null;
  const cn = `avc-shape ${String(common.className ?? "")}`.trim();
  const named = typeof label === "string" && label.trim() ? { role: "img", "aria-label": label } : { "aria-hidden": "true" as const };
  // def.svg is one of our own constants above, never user input.
  return <svg {...common} {...named} className={cn} viewBox="0 0 100 100" preserveAspectRatio="none" fill="currentColor" dangerouslySetInnerHTML={{ __html: def.svg }} />;
}

// ---- charts ----
const SERIES = [
  "var(--c-primary)",
  "var(--c-secondary)",
  "color-mix(in srgb, var(--c-primary) 55%, white)",
  "color-mix(in srgb, var(--c-secondary) 55%, white)",
  "color-mix(in srgb, var(--c-text) 55%, white)",
  "color-mix(in srgb, var(--c-primary) 35%, var(--c-secondary))",
];
const colorAt = (i: number) => SERIES[i % SERIES.length]!;
const n2 = (x: number) => +x.toFixed(2);

/** Short, locale-independent number text (the same on every machine, so published pages are reproducible). */
export function fmt(v: number): string {
  const a = Math.abs(v);
  const f = (x: number, s: string) => `${+x.toFixed(1)}${s}`;
  if (a >= 1e9) return f(v / 1e9, "B");
  if (a >= 1e6) return f(v / 1e6, "M");
  if (a >= 1e4) return f(v / 1e3, "k");
  return String(+v.toFixed(2));
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

type Datum = { label: string; value: number };

function arc(cx: number, cy: number, r: number, a0: number, a1: number, inner: number): string {
  const p = (rr: number, a: number) => `${n2(cx + rr * Math.cos(a))} ${n2(cy + rr * Math.sin(a))}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const outer = `M${p(r, a0)}A${r} ${r} 0 ${large} 1 ${p(r, a1)}`;
  return inner > 0 ? `${outer}L${p(inner, a1)}A${inner} ${inner} 0 ${large} 0 ${p(inner, a0)}Z` : `${outer}L${cx} ${cy}Z`;
}

function Pie({ data, donut }: { data: Datum[]; donut: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = 110, cy = 110, r = 96, inner = donut ? 56 : 0;
  let acc = -Math.PI / 2;
  return (
    <>
      {total <= 0 ? <circle cx={cx} cy={cy} r={r} style={{ fill: "color-mix(in srgb, currentColor 12%, transparent)" }} /> : data.map((d, i) => {
        if (d.value <= 0) return null;
        const frac = d.value / total;
        if (frac >= 0.9999) return <path key={i} d={donut ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0ZM${cx - inner} ${cy}a${inner} ${inner} 0 1 1 ${inner * 2} 0a${inner} ${inner} 0 1 1 ${-inner * 2} 0Z` : `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`} fillRule="evenodd" style={{ fill: colorAt(i) }} />;
        const a0 = acc; acc += frac * Math.PI * 2;
        return <path key={i} d={arc(cx, cy, r, a0, acc, inner)} style={{ fill: colorAt(i), stroke: "var(--c-background)", strokeWidth: 2 }} />;
      })}
      {data.map((d, i) => (
        <g key={i} transform={`translate(236 ${18 + i * 18})`}>
          <rect width="11" height="11" rx="2" style={{ fill: colorAt(i) }} />
          <text x="17" y="10" fontSize="11" fill="currentColor">{clip(d.label, 16)}{total > 0 ? ` · ${n2((d.value / total) * 100)}%` : ""}</text>
        </g>
      ))}
    </>
  );
}

function Bars({ data, horizontal }: { data: Datum[]; horizontal: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (horizontal) {
    const left = 96, top = 8, w = 400 - left - 44, rowH = Math.min(30, (232 - top) / data.length);
    return (
      <>
        {data.map((d, i) => {
          const y = top + i * rowH;
          const bw = Math.max(0, (d.value / max) * w);
          return (
            <g key={i}>
              <text x={left - 8} y={y + rowH / 2 + 4} fontSize="11" textAnchor="end" fill="currentColor">{clip(d.label, 14)}</text>
              <rect x={left} y={y + 3} width={n2(bw)} height={n2(rowH - 8)} rx="3" style={{ fill: colorAt(0) }} />
              <text x={left + bw + 6} y={y + rowH / 2 + 4} fontSize="11" fill="currentColor">{fmt(d.value)}</text>
            </g>
          );
        })}
      </>
    );
  }
  const left = 8, right = 8, top = 22, bottom = 32, w = 400 - left - right, h = 240 - top - bottom, slot = w / data.length;
  const bw = Math.min(56, slot * 0.62);
  return (
    <>
      <line x1={left} x2={400 - right} y1={top + h} y2={top + h} stroke="currentColor" strokeOpacity=".3" />
      {data.map((d, i) => {
        const bh = (d.value / max) * h;
        const x = left + i * slot + (slot - bw) / 2;
        return (
          <g key={i}>
            <rect x={n2(x)} y={n2(top + h - bh)} width={n2(bw)} height={n2(bh)} rx="3" style={{ fill: colorAt(0) }} />
            <text x={n2(x + bw / 2)} y={n2(top + h - bh - 6)} fontSize="11" textAnchor="middle" fill="currentColor">{fmt(d.value)}</text>
            <text x={n2(x + bw / 2)} y={top + h + 16} fontSize="11" textAnchor="middle" fill="currentColor">{clip(d.label, Math.max(4, Math.floor(slot / 6.5)))}</text>
          </g>
        );
      })}
    </>
  );
}

function Lines({ data, area }: { data: Datum[]; area: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const left = 20, right = 20, top = 24, bottom = 32, w = 400 - left - right, h = 240 - top - bottom;
  const x = (i: number) => left + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => top + h - (v / max) * h;
  const pts = data.map((d, i) => `${n2(x(i))},${n2(y(d.value))}`);
  return (
    <>
      <line x1={left} x2={400 - right} y1={top + h} y2={top + h} stroke="currentColor" strokeOpacity=".3" />
      {area && data.length > 1 && <polygon points={`${n2(x(0))},${top + h} ${pts.join(" ")} ${n2(x(data.length - 1))},${top + h}`} style={{ fill: colorAt(0), fillOpacity: 0.3 }} />}
      {data.length > 1 && <polyline points={pts.join(" ")} fill="none" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: colorAt(0) }} />}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={n2(x(i))} cy={n2(y(d.value))} r="4" style={{ fill: colorAt(0) }} />
          <text x={n2(x(i))} y={n2(y(d.value) - 9)} fontSize="11" textAnchor="middle" fill="currentColor">{fmt(d.value)}</text>
          <text x={n2(x(i))} y={top + h + 16} fontSize="11" textAnchor="middle" fill="currentColor">{clip(d.label, Math.max(4, Math.floor(w / data.length / 6.5)))}</text>
        </g>
      ))}
    </>
  );
}

export function ChartEl({ chartType, title, data, common }: { chartType: ChartType; title?: unknown; data: unknown; common: Common }) {
  const rows: Datum[] = (Array.isArray(data) ? data : [])
    .filter((d): d is Datum => !!d && typeof (d as Datum).label === "string" && Number.isFinite((d as Datum).value))
    .slice(0, 12);
  if (!rows.length) return null;
  const heading = typeof title === "string" && title.trim() ? title.trim() : "";
  const summary = `${heading ? heading + ". " : ""}${chartType} chart: ${rows.map((d) => `${d.label} ${fmt(d.value)}`).join(", ")}`;
  const cn = `avc-chart ${String(common.className ?? "")}`.trim();
  const round = chartType === "pie" || chartType === "donut";
  const top = heading ? 26 : 0;
  return (
    <svg {...common} className={cn} viewBox={`0 0 400 ${(round ? 220 : 240) + top}`} role="img" aria-label={summary}>
      <title>{summary}</title>
      {heading && <text x="200" y="18" fontSize="14" fontWeight="600" textAnchor="middle" fill="currentColor">{heading}</text>}
      <g transform={`translate(0 ${top})`}>
        {round ? <Pie data={rows} donut={chartType === "donut"} /> : chartType === "bar" ? <Bars data={rows} horizontal={false} /> : chartType === "row" ? <Bars data={rows} horizontal /> : <Lines data={rows} area={chartType === "area"} />}
      </g>
    </svg>
  );
}

export function TableEl({ columns, rows, caption, common }: { columns: unknown; rows: unknown; caption?: unknown; common: Common }) {
  const cols = (Array.isArray(columns) ? columns : []).map(String).slice(0, 6);
  if (!cols.length) return null;
  const body = (Array.isArray(rows) ? rows : []).map((r) => {
    const cells = String(r).split("|").map((c) => c.trim()).slice(0, cols.length);
    while (cells.length < cols.length) cells.push("");
    return cells;
  });
  const cn = `avc-tablewrap ${String(common.className ?? "")}`.trim();
  return (
    <div {...common} className={cn}>
      <table className="avc-table">
        {typeof caption === "string" && caption.trim() ? <caption>{caption}</caption> : null}
        <thead><tr>{cols.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
