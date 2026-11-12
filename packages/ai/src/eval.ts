import type { Project } from "@avc/schema";
import { runElementCreator } from "./elementAgent";
import { runLayoutAgent } from "./layoutAgent";
import { locateNode } from "./context";
import { runPatchAgent } from "./patchAgent";
import { costUsd, type PriceTable } from "./credits";
import type { ModelProvider, Usage } from "./provider";
import type { Node } from "@avc/schema";

// Minimal shapes so the runner does not import the dataset itself (the dataset lives outside src/).
export type EvalEdit = {
  id: string; category: "edit" | "injection"; lang: string;
  target: { type: string; nth?: number }; instruction: string;
  check: (before: Project, after: Project, nodeId: string) => boolean;
};
export type EvalElement = { id: string; category: "element"; lang: string; prompt: string };
export type EvalLayout = { id: string; category: "layout"; lang: string; prompt: string; pages: string[]; style: "minimal" | "bold" | "playful" | "corporate" };
export type EvalCaseAny = EvalEdit | EvalElement | EvalLayout;

export type CaseResult = {
  id: string; category: EvalCaseAny["category"]; lang: string;
  /** The agent returned something that passed schema + scope + validity. */
  valid: boolean;
  /** valid AND the result actually does what was asked (edits only; for others equals `valid`). */
  correct: boolean;
  attempts: number;
  usage: Usage;
  failure?: string;
};

export type Summary = {
  total: number;
  validRate: number;
  correctRate: number;
  /** Share answered correctly on the first attempt (no retries needed). */
  firstTryRate: number;
  meanAttempts: number;
  tokens: Usage;
  usd?: number;
  byCategory: Record<string, { total: number; validRate: number; correctRate: number; meanAttempts: number }>;
  failures: { id: string; failure: string }[];
};

const ZERO: Usage = { inputTokens: 0, outputTokens: 0 };
const add = (a: Usage, b: Usage): Usage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });

/** Pick the nth node of a type on the first page. */
export function pickTarget(project: Project, target: { type: string; nth?: number }): Node | undefined {
  const found: Node[] = [];
  const visit = (ns: Node[]) => { for (const n of ns) { if (n.type === target.type) found.push(n); if (n.children) visit(n.children); } };
  visit(project.pages[0]!.nodes);
  return found[target.nth ?? 0];
}

export async function runCase(c: EvalCaseAny, o: { provider: ModelProvider; base: Project; newId: () => string }): Promise<CaseResult> {
  const head = { id: c.id, category: c.category, lang: c.lang };
  if (c.category === "edit" || c.category === "injection") {
    const node = pickTarget(o.base, c.target);
    if (!node) return { ...head, valid: false, correct: false, attempts: 0, usage: ZERO, failure: `no ${c.target.type} in the base project` };
    const r = await runPatchAgent({ provider: o.provider, project: o.base, nodeId: node.id, instruction: c.instruction, newId: o.newId });
    if (!r.ok) {
      // For injection cases a model that cannot be tricked into anything valid is a SAFE outcome, but still reported as not valid.
      return { ...head, valid: false, correct: false, attempts: r.attempts, usage: r.usage, failure: `${r.reason}: ${r.message}` };
    }
    const correct = c.check(o.base, r.project, node.id) && !!locateNode(r.project, node.id);
    return { ...head, valid: true, correct, attempts: r.attempts, usage: r.usage, ...(correct ? {} : { failure: "valid, but did not do what was asked" }) };
  }
  if (c.category === "element") {
    const r = await runElementCreator({ provider: o.provider, theme: o.base.theme, prompt: c.prompt, newId: o.newId });
    return r.ok ? { ...head, valid: true, correct: r.options.length >= 1, attempts: r.attempts, usage: r.usage } : { ...head, valid: false, correct: false, attempts: r.attempts, usage: r.usage, failure: `${r.reason}: ${r.message}` };
  }
  const l = c as EvalLayout; // the only remaining category
  const r = await runLayoutAgent({ provider: o.provider, brief: { prompt: l.prompt, pages: l.pages, style: l.style, language: l.lang === "hi" ? "Hindi" : l.lang === "mr" ? "Marathi" : "English" }, newId: o.newId });
  return r.ok ? { ...head, valid: true, correct: true, attempts: r.attempts, usage: r.usage } : { ...head, valid: false, correct: false, attempts: r.attempts, usage: r.usage, failure: `${r.reason}: ${r.message}` };
}

export function summarize(results: CaseResult[], price?: PriceTable): Summary {
  const rate = (xs: CaseResult[], f: (r: CaseResult) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0);
  const mean = (xs: CaseResult[]) => (xs.length ? xs.reduce((s, r) => s + r.attempts, 0) / xs.length : 0);
  const tokens = results.reduce((s, r) => add(s, r.usage), ZERO);
  const byCategory: Summary["byCategory"] = {};
  for (const cat of new Set(results.map((r) => r.category))) {
    const xs = results.filter((r) => r.category === cat);
    byCategory[cat] = { total: xs.length, validRate: rate(xs, (r) => r.valid), correctRate: rate(xs, (r) => r.correct), meanAttempts: mean(xs) };
  }
  return {
    total: results.length,
    validRate: rate(results, (r) => r.valid),
    correctRate: rate(results, (r) => r.correct),
    firstTryRate: rate(results, (r) => r.correct && r.attempts === 1),
    meanAttempts: mean(results),
    tokens,
    ...(price ? { usd: costUsd(tokens, price) } : {}),
    byCategory,
    failures: results.filter((r) => !r.correct).map((r) => ({ id: r.id, failure: r.failure ?? "failed" })),
  };
}

/** Runs the cases one after another (kind to rate limits) and summarises. */
export async function runEval(o: { provider: ModelProvider; cases: EvalCaseAny[]; base: Project; newId: () => string; price?: PriceTable; onResult?: (r: CaseResult) => void }): Promise<{ results: CaseResult[]; summary: Summary }> {
  const results: CaseResult[] = [];
  for (const c of o.cases) {
    let r: CaseResult;
    try {
      r = await runCase(c, { provider: o.provider, base: o.base, newId: o.newId });
    } catch (e) {
      r = { id: c.id, category: c.category, lang: c.lang, valid: false, correct: false, attempts: 0, usage: ZERO, failure: `crashed: ${e instanceof Error ? e.message : "unknown"}` };
    }
    results.push(r);
    o.onResult?.(r);
  }
  return { results, summary: summarize(results, o.price) };
}
