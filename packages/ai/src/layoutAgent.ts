import { failingPairs, PageSchema, ThemeSchema, validateProject, type Node, type Page, type Project } from "@avc/schema";
import { cleanText } from "./context";
import { freshenNodeIds } from "./ids";
import { AgentOutputError, extractJson } from "./json";
import { generateValidated, type Progress } from "./loop";
import { systemPrompt } from "./prompt";
import type { ModelProvider, Usage } from "./provider";

export const LIMITS = { prompt: 1500, pages: 8, sectionsPerPage: 12, nodes: 160 } as const;
export type Brief = { prompt: string; style?: "minimal" | "bold" | "playful" | "corporate"; pages?: string[]; language?: string };

export type LayoutOutcome =
  | { ok: true; project: Project; attempts: number; usage: Usage }
  | { ok: false; reason: "invalid_request" | "invalid" | "truncated" | "provider"; message: string; attempts: number; usage: Usage; providerKind?: string };

const none: Usage = { inputTokens: 0, outputTokens: 0 };
const count = (nodes: Node[]): number => nodes.reduce((n, x) => n + 1 + count(x.children ?? []), 0);

/** Agent 1 (spec 10.1 "Designer"): pages, sections, blocks, variants and a theme, with placeholder-quality text. */
export async function runLayoutAgent(req: { provider: ModelProvider; brief: Brief; newId: () => string; maxAttempts?: number; signal?: AbortSignal; onProgress?: (p: Progress) => void }): Promise<LayoutOutcome> {
  const cleaned = cleanText(req.brief.prompt, LIMITS.prompt);
  if (!cleaned.ok) return { ok: false, reason: "invalid_request", message: cleaned.error, attempts: 0, usage: none };
  const pageNames = (req.brief.pages ?? []).map((p) => cleanText(p, 40)).filter((p): p is { ok: true; text: string } => p.ok).map((p) => p.text).slice(0, LIMITS.pages);

  const user = [
    "Plan the website described below.",
    req.brief.style ? `Overall style: ${req.brief.style}.` : "",
    pageNames.length ? `Pages wanted: ${pageNames.join(", ")}.` : "Choose a sensible set of pages (at most " + LIMITS.pages + ").",
    `Language for all text: ${req.brief.language ?? "English"}.`,
    "<brief>",
    cleaned.text,
    "</brief>",
    "Reply with ONE JSON object:",
    '{ "name": "site name", "theme": { "colors": {"primary","secondary","background","surface","text","muted": all "#rrggbb"}, "fonts": {"heading","body"}, "radius": "none"|"sm"|"md"|"lg"|"full", "motion": "off"|"subtle"|"full" },',
    '  "pages": [ { "name", "path": "/" for home or "/lowercase-words", "seo": {"title","description"}, "nodes": [ ...sections... ] } ] }',
    `Rules: exactly one page has path "/". Every page's top-level nodes are sections (type "section"), at most ${LIMITS.sectionsPerPage} per page, at most ${LIMITS.nodes} nodes in total. Start each page with a navbar section and end with a footer section. Colors must have good contrast (body text on background, white button text on primary). Give every node a short unique id.`,
  ].filter(Boolean).join("\n");

  const result = await generateValidated<Project>({
    provider: req.provider, system: systemPrompt("layout"), user, maxTokens: 8000, temperature: 0.6, maxAttempts: req.maxAttempts ?? 3, signal: req.signal, onProgress: req.onProgress,
    parse: (text) => {
      let raw: any;
      try { raw = extractJson(text); } catch (e) { return { ok: false, error: e instanceof AgentOutputError ? e.message : "Reply with a JSON object." }; }
      const theme = ThemeSchema.safeParse(raw?.theme);
      if (!theme.success) return { ok: false, error: `theme: ${theme.error.issues[0]?.path.join(".")} ${theme.error.issues[0]?.message}` };
      const bad = failingPairs(theme.data.colors);
      if (bad.length) return { ok: false, error: `These color pairs have too little contrast: ${bad.map((b) => `${b.label} (${b.ratio.toFixed(1)}:1, needs 4.5:1)`).join("; ")}.` };
      if (!Array.isArray(raw?.pages) || raw.pages.length === 0) return { ok: false, error: "pages must be a non-empty array." };
      if (raw.pages.length > LIMITS.pages) return { ok: false, error: `Too many pages (${raw.pages.length}); at most ${LIMITS.pages}.` };

      const pages: Page[] = [];
      for (const [i, p] of raw.pages.entries()) {
        const parsed = PageSchema.safeParse({ id: `pg${i}`, name: p?.name, path: p?.path, seo: p?.seo, nodes: p?.nodes });
        if (!parsed.success) return { ok: false, error: `pages[${i}]: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
        if (parsed.data.nodes.length > LIMITS.sectionsPerPage) return { ok: false, error: `pages[${i}] has too many sections (max ${LIMITS.sectionsPerPage}).` };
        pages.push({ ...parsed.data, id: req.newId(), nodes: parsed.data.nodes.map((n) => freshenNodeIds(n, req.newId)) });
      }
      const total = pages.reduce((n, p) => n + count(p.nodes), 0);
      if (total > LIMITS.nodes) return { ok: false, error: `Too much content (${total} nodes; at most ${LIMITS.nodes}). Simplify.` };

      const name = cleanText(String(raw?.name ?? "My website"), 80);
      const project: Project = { schemaVersion: 2, id: req.newId(), name: name.ok ? name.text : "My website", platform: "web", theme: theme.data, pages };
      const v = validateProject(project);
      if (!v.ok) return { ok: false, error: v.issues.slice(0, 6).map((x) => `${x.path}: ${x.message}`).join("\n") };
      if (!v.project.pages.some((p) => p.path === "/")) return { ok: false, error: 'One page must have the path "/".' };
      return { ok: true, value: v.project };
    },
  });
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message, attempts: result.attempts, usage: result.usage, providerKind: result.providerKind };
  return { ok: true, project: result.value, attempts: result.attempts, usage: result.usage };
}
