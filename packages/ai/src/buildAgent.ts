import { lintProject, NodeSchema, structureSignature, validateProject, type Node, type Page, type Project } from "@avc/schema";
import { cleanText } from "./context";
import { AgentOutputError, extractJson } from "./json";
import { generateValidated, type Progress } from "./loop";
import { systemPrompt } from "./prompt";
import type { ModelProvider, Usage } from "./provider";
import type { Brief } from "./layoutAgent";

export type PageBuild =
  | { pageId: string; ok: true; attempts: number; usage: Usage }
  | { pageId: string; ok: false; reason: string; message: string; attempts: number; usage: Usage };

export type BuildOutcome = {
  /** The approved project with every successfully built page replaced; pages that failed stay as approved. */
  project: Project;
  pages: PageBuild[];
  complete: boolean;
  usage: Usage;
};

const sum = (a: Usage, b: Usage): Usage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });
const flat = (nodes: Node[], out: string[] = []): string[] => { for (const n of nodes) { out.push(`${n.id}:${n.type}${n.variant ? "/" + n.variant : ""}`); flat(n.children ?? [], out); } return out; };

/** Human-readable difference between approved and returned structure, to send back to the model. */
export function describeStructureDiff(approved: Page, built: Node[]): string {
  const a = flat(approved.nodes);
  const b = flat(built);
  const missing = a.filter((x) => !b.includes(x));
  const extra = b.filter((x) => !a.includes(x));
  const bits: string[] = [];
  if (missing.length) bits.push(`missing or changed: ${missing.slice(0, 8).join(", ")}`);
  if (extra.length) bits.push(`added or changed: ${extra.slice(0, 8).join(", ")}`);
  if (!bits.length) bits.push("the ORDER or nesting of nodes changed");
  return `You changed the approved structure (${bits.join("; ")}). Keep every id, type, variant, order and nesting exactly as given.`;
}

/**
 * Agent 2 for one page (spec 10.1 "Builder", 10.3). The model writes real copy, but the result is rejected unless its
 * structureSignature equals the approved page's: it cannot silently add, remove, reorder or retype what the user approved.
 */
export async function runBuildPage(req: { provider: ModelProvider; approved: Project; pageId: string; brief: Brief; maxAttempts?: number; signal?: AbortSignal; onProgress?: (p: Progress) => void }): Promise<{ ok: true; page: Page; attempts: number; usage: Usage } | Extract<PageBuild, { ok: false }>> {
  const page = req.approved.pages.find((p) => p.id === req.pageId);
  const none: Usage = { inputTokens: 0, outputTokens: 0 };
  if (!page) return { pageId: req.pageId, ok: false, reason: "invalid_request", message: "That page does not exist.", attempts: 0, usage: none };
  const prompt = cleanText(req.brief.prompt, 1500);
  if (!prompt.ok) return { pageId: req.pageId, ok: false, reason: "invalid_request", message: prompt.error, attempts: 0, usage: none };
  const want = structureSignature(page);

  const user = [
    `Write the real content for the page "${page.name}" (path ${page.path}) of this website.`,
    `Language for all text: ${req.brief.language ?? "English"}.`,
    `Theme: ${JSON.stringify(req.approved.theme)}`,
    "<brief>", prompt.text, "</brief>",
    "The approved structure (keep EVERY id, type, variant, order and nesting; change only text, links, images, styles and animations):",
    "<page>", JSON.stringify(page.nodes), "</page>",
    'Reply with ONE JSON object: { "nodes": [ ...the page\'s top-level sections, same structure... ] }',
  ].join("\n");

  const result = await generateValidated<Page>({
    provider: req.provider, system: systemPrompt("build"), user, maxTokens: 8000, temperature: 0.5, maxAttempts: req.maxAttempts ?? 3, signal: req.signal, onProgress: req.onProgress,
    parse: (text) => {
      let raw: any;
      try { raw = extractJson(text); } catch (e) { return { ok: false, error: e instanceof AgentOutputError ? e.message : "Reply with a JSON object." }; }
      if (!Array.isArray(raw?.nodes)) return { ok: false, error: 'Expected { "nodes": [ ... ] }.' };
      const nodes: Node[] = [];
      for (const [i, n] of raw.nodes.entries()) {
        const p = NodeSchema.safeParse(n);
        if (!p.success) return { ok: false, error: `nodes[${i}]: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}` };
        nodes.push(p.data);
      }
      const built: Page = { ...page, nodes };
      if (structureSignature(built) !== want) return { ok: false, error: describeStructureDiff(page, nodes) };
      const trial: Project = { ...req.approved, pages: req.approved.pages.map((p) => (p.id === page.id ? built : p)) };
      const v = validateProject(trial);
      if (!v.ok) return { ok: false, error: v.issues.slice(0, 6).map((x) => `${x.path}: ${x.message}`).join("\n") };
      const lint = lintProject(v.project).filter((i) => i.severity === "error" && i.pageId === page.id);
      if (lint.length) return { ok: false, error: lint.slice(0, 4).map((i) => i.message).join("\n") };
      return { ok: true, value: built };
    },
  });
  if (!result.ok) return { pageId: page.id, ok: false, reason: result.reason, message: result.message, attempts: result.attempts, usage: result.usage };
  return { ok: true, page: result.value, attempts: result.attempts, usage: result.usage };
}

/**
 * Build every approved page, one at a time. A failed page never blocks the others and never loses work (spec W07): the
 * result keeps the approved placeholder for that page and reports it, so the user can retry just that page.
 */
export async function runBuildAll(req: { provider: ModelProvider; approved: Project; brief: Brief; maxAttempts?: number; signal?: AbortSignal; onPage?: (r: PageBuild) => void }): Promise<BuildOutcome> {
  let project = req.approved;
  const pages: PageBuild[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (const p of req.approved.pages) {
    if (req.signal?.aborted) break;
    const r = await runBuildPage({ provider: req.provider, approved: project, pageId: p.id, brief: req.brief, maxAttempts: req.maxAttempts, signal: req.signal });
    usage = sum(usage, r.usage);
    if (r.ok) {
      project = { ...project, pages: project.pages.map((x) => (x.id === p.id ? r.page : x)) };
      const entry: PageBuild = { pageId: p.id, ok: true, attempts: r.attempts, usage: r.usage };
      pages.push(entry);
      req.onPage?.(entry);
    } else {
      pages.push(r);
      req.onPage?.(r);
    }
  }
  return { project, pages, complete: pages.length === req.approved.pages.length && pages.every((x) => x.ok), usage };
}
