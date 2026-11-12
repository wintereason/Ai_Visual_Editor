import { describe, expect, it } from "vitest";
import { exampleProject, ICON_NAMES, SHAPE_NAMES, validateProject, type Node, type Project } from "@avc/schema";
import { renderPage } from "../src";
import { formatChartNumber } from "../src";

const el = (type: string, props: Record<string, unknown>, extra: Partial<Node> = {}): Node => ({ id: `g_${type}`, kind: "element", type, props, ...extra });
const project = (node: Node): Project => {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes[2]!.children!.push(node);
  return p;
};
const check = (node: Node) => validateProject(project(node));
const html = (node: Node) => {
  const p = project(node);
  const v = validateProject(p);
  if (!v.ok) throw new Error(v.issues.map((i) => i.message).join());
  return renderPage(p, "page_home").html;
};
const months = [{ label: "Jan", value: 30 }, { label: "Feb", value: 45 }, { label: "Mar", value: 38 }];

describe("icons", () => {
  it("every named icon validates and draws an svg with its path", () => {
    for (const name of ICON_NAMES) {
      const h = html(el("icon", { name }));
      expect(h, name).toContain("<svg");
      expect(h, name).toContain('aria-hidden="true"');
      expect(h, name).toContain("<path d=");
    }
  });
  it("an unknown name is refused rather than drawn", () => {
    expect(check(el("icon", { name: "does-not-exist" })).ok).toBe(false);
  });
});

describe("shapes", () => {
  it("every shape validates and renders inside a 0..100 box", () => {
    for (const shape of SHAPE_NAMES) {
      const h = html(el("shape", { shape }));
      expect(h, shape).toContain('viewBox="0 0 100 100"');
      expect(h, shape).toMatch(/<(rect|circle|ellipse|polygon|path)\b/);
    }
  });
  it("is decorative unless given a label, and then it is announced", () => {
    expect(html(el("shape", { shape: "star" }))).toContain('aria-hidden="true"');
    const h = html(el("shape", { shape: "star", label: "Best seller" }));
    expect(h).toContain('role="img"');
    expect(h).toContain('aria-label="Best seller"');
  });
  it("an unknown shape is refused", () => {
    expect(check(el("shape", { shape: "nope" })).ok).toBe(false);
  });
  it("takes its colour from the text colour style", () => {
    const p = project(el("shape", { shape: "circle" }, { styles: { base: { normal: { color: "#ff0000" } } } }));
    expect(validateProject(p).ok).toBe(true);
    expect(renderPage(p, "page_home").css).toContain("color:#ff0000");
  });
});

describe("charts", () => {
  for (const chartType of ["bar", "row", "line", "area", "pie", "donut"] as const) {
    it(`${chartType}: renders an accessible svg that states every value`, () => {
      const h = html(el("chart", { chartType, title: "Results", data: months }));
      expect(h).toContain('role="img"');
      expect(h).toMatch(/aria-label="Results\. [a-z]+ chart: Jan 30, Feb 45, Mar 38"/);
      expect(h).toContain("<title>");
      expect(h).not.toContain("NaN");
      expect(h).not.toContain("undefined");
    });
  }
  it("a bar chart has one bar per value, tallest for the largest", () => {
    const h = html(el("chart", { chartType: "bar", data: [{ label: "A", value: 10 }, { label: "B", value: 40 }] }));
    const heights = [...h.matchAll(/<rect [^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(heights).toHaveLength(2);
    expect(heights[1]!).toBeGreaterThan(heights[0]!);
  });
  it("a pie with one value is a full disc, and all zeros is an empty ring, not broken geometry", () => {
    expect(html(el("chart", { chartType: "pie", data: [{ label: "All", value: 5 }] }))).not.toContain("NaN");
    expect(html(el("chart", { chartType: "donut", data: [{ label: "All", value: 5 }] }))).not.toContain("NaN");
    expect(html(el("chart", { chartType: "pie", data: [{ label: "A", value: 0 }, { label: "B", value: 0 }] }))).not.toContain("NaN");
    expect(html(el("chart", { chartType: "bar", data: [{ label: "A", value: 0 }] }))).not.toContain("NaN");
    expect(html(el("chart", { chartType: "line", data: [{ label: "A", value: 3 }] }))).not.toContain("NaN");
  });
  it("labels are escaped, never interpreted as markup", () => {
    const h = html(el("chart", { chartType: "bar", title: "<img src=x onerror=alert(1)>", data: [{ label: "<script>alert(1)</script>", value: 1 }] }));
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<img src=x");
  });
  it("refuses negative or absurd numbers, empty data, and too many rows", () => {
    expect(check(el("chart", { chartType: "bar", data: [{ label: "A", value: -1 }] })).ok).toBe(false);
    expect(check(el("chart", { chartType: "bar", data: [{ label: "A", value: 1e12 }] })).ok).toBe(false);
    expect(check(el("chart", { chartType: "bar", data: [] })).ok).toBe(false);
    expect(check(el("chart", { chartType: "bar", data: Array.from({ length: 13 }, (_, i) => ({ label: `L${i}`, value: i })) })).ok).toBe(false);
    expect(check(el("chart", { chartType: "spider", data: months })).ok).toBe(false);
  });
  it("number text is the same on every machine", () => {
    expect(formatChartNumber(1234567)).toBe("1.2M");
    expect(formatChartNumber(15000)).toBe("15k");
    expect(formatChartNumber(0.5)).toBe("0.5");
    expect(formatChartNumber(42)).toBe("42");
  });
});

describe("tables", () => {
  const props = { columns: ["Course", "Fee"], rows: ["Maths | ₹100", "Science | ₹200"], caption: "Fees" };
  it("renders a real table with header cells and a caption", () => {
    const h = html(el("table", props));
    expect(h).toContain("<caption>Fees</caption>");
    expect(h).toContain('<th scope="col">Course</th>');
    expect(h).toContain("<td>₹200</td>");
  });
  it("short rows are padded, so the grid never breaks", () => {
    const h = html(el("table", { columns: ["A", "B", "C"], rows: ["only one"] }));
    expect((h.match(/<td>/g) ?? []).length).toBe(3);
  });
  it("a row with more cells than columns is an error, not silently cut", () => {
    const v = check(el("table", { columns: ["A"], rows: ["1 | 2"] }));
    expect(v.ok).toBe(false);
  });
  it("cell text is escaped", () => {
    expect(html(el("table", { columns: ["<b>x</b>"], rows: ["<i>y</i>"] }))).not.toMatch(/<b>x|<i>y/);
  });
});
