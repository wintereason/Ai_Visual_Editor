import { NodeSchema, validateProject, type Node, type Project, type Theme } from "@avc/schema";
import { cleanText } from "./context";
import { freshenNodeIds } from "./ids";
import { AgentOutputError, extractJson } from "./json";
import { generateValidated, type Progress } from "./loop";
import { systemPrompt } from "./prompt";
import type { ModelProvider, Usage } from "./provider";

export const MAX_ELEMENT_PROMPT = 600;
export const MAX_OPTIONS = 3;

export type ElementOption = { name: string; tree: Node };

export type ElementOutcome =
  | { ok: true; options: ElementOption[]; dropped: number; attempts: number; usage: Usage }
  | { ok: false; reason: "invalid_request" | "invalid" | "truncated" | "provider"; message: string; attempts: number; usage: Usage; providerKind?: string };

const none: Usage = { inputTokens: 0, outputTokens: 0 };

/** Can this tree live inside an ordinary section? Checked by building a throwaway page around it and running the real validator. */
function checkTree(tree: Node, theme: Theme): string | null {
  const scratch: Project = {
    schemaVersion: 2, id: "scratch", name: "scratch", platform: "web", theme,
    pages: [{ id: "p", name: "P", path: "/", nodes: [{ id: "s", kind: "container", type: "section", props: {}, children: [tree] }] }],
  };
  const v = validateProject(scratch);
  return v.ok ? null : v.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; ");
}

/**
 * Element Creator, tier A (spec 11.1): a prompt becomes up to three small component trees built only from the existing
 * elements and blocks. Each option is validated on its own; invalid ones are dropped, and the model is asked again only
 * if none survive. Every node gets a fresh server-generated id.
 */
export async function runElementCreator(req: { provider: ModelProvider; theme: Theme; prompt: string; newId: () => string; maxAttempts?: number; signal?: AbortSignal; onProgress?: (p: Progress) => void }): Promise<ElementOutcome> {
  const cleaned = cleanText(req.prompt, MAX_ELEMENT_PROMPT);
  if (!cleaned.ok) return { ok: false, reason: "invalid_request", message: cleaned.error, attempts: 0, usage: none };

  const task = [
    "Create small reusable website components for the request below, using ONLY the listed node types.",
    `Theme: ${JSON.stringify(req.theme)}`,
    "<instruction>",
    cleaned.text,
    "</instruction>",
    `Reply with ONE JSON object: { "options": [ { "name": "short name", "tree": <a node> }, ... up to ${MAX_OPTIONS} different designs ] }`,
    'A node is { "id", "kind": "element"|"block"|"container", "type", "variant"?, "props", "styles"?, "animation"?, "children"? }. Never use type "section". Give every node a short unique id.',
    "Prefer a container holding elements and blocks. Make each option visibly different.",
  ].join("\n");

  let dropped = 0;
  const result = await generateValidated<ElementOption[]>({
    provider: req.provider, system: systemPrompt("element"), user: task, maxTokens: 4000, temperature: 0.7, maxAttempts: req.maxAttempts ?? 3, signal: req.signal, onProgress: req.onProgress,
    parse: (text) => {
      let raw: any;
      try { raw = extractJson(text); } catch (e) { return { ok: false, error: e instanceof AgentOutputError ? e.message : "Reply with a JSON object." }; }
      const list: unknown = raw?.options;
      if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'Expected { "options": [ ... ] } with at least one option.' };
      const good: ElementOption[] = [];
      const problems: string[] = [];
      dropped = 0;
      list.slice(0, MAX_OPTIONS).forEach((o: any, i: number) => {
        const tree = NodeSchema.safeParse(o?.tree);
        if (!tree.success) { dropped++; problems.push(`option ${i + 1}: ${tree.error.issues[0]?.message ?? "invalid node"}`); return; }
        const fresh = freshenNodeIds(tree.data, req.newId);
        const why = checkTree(fresh, req.theme);
        if (why) { dropped++; problems.push(`option ${i + 1}: ${why}`); return; }
        const name = cleanText(String(o?.name ?? `Option ${i + 1}`), 60);
        good.push({ name: name.ok ? name.text : `Option ${i + 1}`, tree: fresh });
      });
      return good.length ? { ok: true, value: good } : { ok: false, error: problems.join("\n") || "No usable options." };
    },
  });
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message, attempts: result.attempts, usage: result.usage, providerKind: result.providerKind };
  return { ok: true, options: result.value, dropped, attempts: result.attempts, usage: result.usage };
}
