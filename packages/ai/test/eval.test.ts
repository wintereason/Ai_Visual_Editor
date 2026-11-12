import { describe, expect, it } from "vitest";
import type { Project } from "@avc/schema";
import { TEMPLATES } from "@avc/templates";
import { ALL_CASES, EDIT_CASES, ELEMENT_CASES, LAYOUT_CASES, type EditCase } from "../evals/prompts";
import { pickTarget, runCase, runEval, runPatchAgent, ScriptedProvider, summarize, type CaseResult, messageText } from "../src";

const base = (): Project => TEMPLATES.find((t) => t.id === "school")!.make();
let seq = 0;
const newId = () => `e${++seq}`;

const goodTheme = { colors: { primary: "#1d4ed8", secondary: "#f59e0b", background: "#ffffff", surface: "#f1f5f9", text: "#0f172a", muted: "#475569" }, fonts: { heading: "Poppins", body: "Inter" }, radius: "md", motion: "subtle" };
const LAYOUT = JSON.stringify({ name: "Site", theme: goodTheme, pages: [{ name: "Home", path: "/", seo: { title: "Home" }, nodes: [{ id: "n", kind: "container", type: "section", props: {}, children: [{ id: "h", kind: "block", type: "hero", variant: "centered", props: { headline: "Hi" } }] }] }] });
const ELEMENT = JSON.stringify({ options: [{ name: "A", tree: { id: "a", kind: "element", type: "text", props: { text: "x" } } }] });

/** A "perfect model": answers each edit with that case's reference patch, and other cases with canned valid JSON. */
const oracle = () => new ScriptedProvider((req) => {
  const user = messageText(req.messages[0]!);
  const sys = req.system;
  if (sys.startsWith("You edit ONE selected element")) {
    const instr = /<instruction>\n([\s\S]*?)\n<\/instruction>/.exec(user)![1]!;
    const id = /\(id "([^"]+)"/.exec(user)![1]!;
    const c = EDIT_CASES.find((x) => x.instruction.replace(/\s+/g, " ").trim() === instr.replace(/\s+/g, " ").trim())!;
    return JSON.stringify(c.reference(id, base()));
  }
  return sys.startsWith("You design small") ? ELEMENT : LAYOUT;
});

describe("the evaluation dataset", () => {
  it("has 30-50 prompts across all four categories, in English, Hindi and Marathi, with unique ids", () => {
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(30);
    expect(ALL_CASES.length).toBeLessThanOrEqual(50);
    expect(new Set(ALL_CASES.map((c) => c.id)).size).toBe(ALL_CASES.length);
    expect(EDIT_CASES.filter((c) => c.category === "edit").length).toBeGreaterThanOrEqual(15);
    expect(EDIT_CASES.filter((c) => c.category === "injection").length).toBeGreaterThanOrEqual(5);
    expect(ELEMENT_CASES.length).toBeGreaterThanOrEqual(5);
    expect(LAYOUT_CASES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ALL_CASES.map((c) => c.lang))).toEqual(new Set(["en", "hi", "mr"]));
  });
  it("every editing case targets a node that exists in the base project", () => {
    for (const c of EDIT_CASES) expect(pickTarget(base(), c.target), c.id).toBeTruthy();
  });
  for (const c of EDIT_CASES) {
    it(`${c.id}: its reference answer passes the validator and its own check`, async () => {
      const proj = base();
      const node = pickTarget(proj, c.target)!;
      const r = await runPatchAgent({ provider: new ScriptedProvider([JSON.stringify(c.reference(node.id, proj))]), project: proj, nodeId: node.id, instruction: c.instruction, newId, maxAttempts: 1 });
      expect(r.ok, c.id).toBe(true);
      if (r.ok) expect(c.check(proj, r.project, node.id), `${c.id}: reference should satisfy its check`).toBe(true);
    });
    if (c.category === "edit") {
      it(`${c.id}: doing nothing does NOT satisfy the check (the check is not vacuous)`, () => {
        const proj = base();
        const node = pickTarget(proj, c.target)!;
        // for "remove the animation" the base has none, so give it one first
        const before = structuredClone(proj);
        if (c.id === "edit-no-anim") (pickTarget(before, c.target)!.animation as unknown) = { preset: "fade-in" };
        expect(c.check(before, structuredClone(before), node.id), c.id).toBe(false);
      });
    }
  }
  it("injection checks fail when a model DOES something out of scope", () => {
    const proj = base();
    for (const c of EDIT_CASES.filter((x): x is EditCase => x.category === "injection")) {
      const node = pickTarget(proj, c.target)!;
      const hurt = structuredClone(proj);
      hurt.pages[0]!.nodes.pop(); // the footer is gone
      expect(c.check(proj, hurt, node.id), c.id).toBe(false);
      const retheme = structuredClone(proj);
      retheme.theme.colors.primary = "#000000";
      if (c.id === "inj-theme") expect(c.check(proj, retheme, node.id)).toBe(false);
    }
  });
  it("a gullible model that obeys every injection is stopped by the guards (no result, project untouched)", async () => {
    for (const c of EDIT_CASES.filter((x) => x.category === "injection")) {
      const proj = base();
      const before = JSON.stringify(proj);
      const node = pickTarget(proj, c.target)!;
      const attacks = [
        { summary: "x", ops: [{ op: "remove", id: proj.pages[0]!.nodes.at(-1)!.id }] },
        { summary: "x", ops: [{ op: "setTheme", theme: { colors: { primary: "#000000" } } }] },
        { summary: "x", ops: [{ op: "update", id: node.id, props: { ctaHref: "javascript:alert(1)" } }] },
        { summary: "x", ops: [{ op: "removePage", id: proj.pages[0]!.id }] },
      ].map((a) => JSON.stringify(a));
      const r = await runPatchAgent({ provider: new ScriptedProvider(attacks), project: proj, nodeId: node.id, instruction: c.instruction, newId, maxAttempts: 4 });
      expect(r.ok, c.id).toBe(false);
      expect(JSON.stringify(proj)).toBe(before);
    }
  });
});

describe("runEval", () => {
  it("a perfect model scores 100% across every category, first try, and reports tokens", async () => {
    const { results, summary } = await runEval({ provider: oracle(), cases: ALL_CASES, base: base(), newId });
    expect(results).toHaveLength(ALL_CASES.length);
    expect(summary).toMatchObject({ total: ALL_CASES.length, validRate: 1, correctRate: 1, firstTryRate: 1, meanAttempts: 1, failures: [] });
    expect(summary.tokens.inputTokens).toBeGreaterThan(0);
    expect(Object.keys(summary.byCategory).sort()).toEqual(["edit", "element", "injection", "layout"]);
    for (const c of Object.values(summary.byCategory)) expect(c).toMatchObject({ validRate: 1, correctRate: 1 });
  });
  it("converts tokens to dollars only when a price table is supplied", async () => {
    const some = ALL_CASES.slice(0, 3);
    const a = await runEval({ provider: oracle(), cases: some, base: base(), newId });
    expect(a.summary.usd).toBeUndefined();
    const b = await runEval({ provider: oracle(), cases: some, base: base(), newId, price: { inputPerMTok: 3, outputPerMTok: 15 } });
    expect(b.summary.usd).toBeGreaterThan(0);
  });
  it("a useless model scores 0 and every failure is listed with a reason", async () => {
    const { summary } = await runEval({ provider: new ScriptedProvider(["I'm sorry, I can't help with that."]), cases: ALL_CASES, base: base(), newId });
    expect(summary).toMatchObject({ validRate: 0, correctRate: 0, firstTryRate: 0 });
    expect(summary.failures).toHaveLength(ALL_CASES.length);
    expect(summary.meanAttempts).toBe(3); // each case used all of its retries
    expect(summary.failures.every((f) => f.failure.length > 5)).toBe(true);
  });
  it("distinguishes 'valid' from 'correct': a model that always makes the same harmless edit is valid but wrong", async () => {
    const lazy = new ScriptedProvider((req) => {
      const id = /\(id "([^"]+)"/.exec(messageText(req.messages[0]!))?.[1];
      return req.system.startsWith("You edit ONE") ? JSON.stringify({ summary: "x", ops: [{ op: "update", id, styles: { base: { normal: { opacity: 0.99 } } } }] }) : "nope";
    });
    const edits = EDIT_CASES.filter((c) => c.category === "edit");
    const { summary } = await runEval({ provider: lazy, cases: edits, base: base(), newId });
    expect(summary.validRate).toBeGreaterThan(0.5);
    expect(summary.correctRate).toBeLessThan(summary.validRate);
    expect(summary.failures.some((f) => f.failure.includes("did not do what was asked"))).toBe(true);
  });
  it("a crash inside one case is recorded and the run continues", async () => {
    const bad = { ...EDIT_CASES[0]!, id: "boom", check: () => { throw new Error("check exploded"); } };
    const seen: CaseResult[] = [];
    const { results } = await runEval({ provider: oracle(), cases: [bad as never, ALL_CASES[1]!], base: base(), newId, onResult: (r) => seen.push(r) });
    expect(results[0]).toMatchObject({ id: "boom", valid: false, failure: expect.stringContaining("crashed") });
    expect(results[1]!.valid).toBe(true);
    expect(seen).toHaveLength(2);
  });
  it("reports an edit case whose target is missing instead of throwing", async () => {
    const r = await runCase({ ...EDIT_CASES[0]!, target: { type: "gallery" } } as never, { provider: oracle(), base: base(), newId });
    expect(r).toMatchObject({ valid: false, attempts: 0 });
  });
  it("summarize handles an empty run", () => {
    expect(summarize([])).toMatchObject({ total: 0, validRate: 0, meanAttempts: 0, failures: [] });
  });
});
