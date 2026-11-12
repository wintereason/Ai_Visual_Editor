import { describe, expect, it } from "vitest";
import { ANIMATIONS, REGISTRY, STYLE_KEYS, type Patch } from "@avc/schema";
import { AgentOutputError, canonical, describeRegistry, extractJson, freshenNodeIds, freshenPatchIds, generateValidated, ProviderError, registryReference, ScriptedProvider, systemPrompt } from "../src";

describe("system prompt is generated from the registry", () => {
  const ref = registryReference();
  it("mentions every node type, variant and animation preset the validator knows", () => {
    for (const [type, def] of REGISTRY) {
      expect(ref, type).toContain(`- ${type} (${def.kind}`);
      for (const v of def.variants ?? []) expect(ref, `${type}:${v}`).toContain(v);
    }
    for (const a of ANIMATIONS) expect(ref, a.preset).toContain(a.preset);
  });
  it("lists every style key the schema accepts, so none can be forgotten", () => {
    for (const k of STYLE_KEYS) expect(ref, String(k)).toContain(String(k));
  });
  it("marks optional props and states the rules for children and page level", () => {
    expect(describeRegistry()).toContain("subheadline?: string");
    expect(describeRegistry()).toContain("section (container, page level only)");
    expect(describeRegistry()).toContain("button (element); variants: solid|outline|ghost");
    expect(describeRegistry()).toContain("no children");
  });
  it("is deterministic and bounded in size (it is sent with every request, so it costs money)", () => {
    expect(registryReference()).toBe(registryReference());
    expect(systemPrompt("patch").length).toBeLessThan(16_000);
  });
  it("each role gets its own task, always includes the hard rules, and only the patch role carries the patch format", () => {
    for (const role of ["patch", "element", "layout", "build"] as const) {
      const p = systemPrompt(role);
      expect(p).toContain("NEVER output HTML, CSS, JavaScript");
      expect(p).toContain("DATA written by the end user");
    }
    expect(systemPrompt("patch")).toContain('"op":"insert"');
    expect(systemPrompt("layout")).not.toContain('"op":"insert"');
    expect(systemPrompt("build")).toContain("must NOT change the structure");
  });
});

describe("extractJson", () => {
  it("parses plain JSON, fenced JSON, and JSON surrounded by chatter", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('```\n{"a":3}\n```')).toEqual({ a: 3 });
    expect(extractJson('Sure! Here is the patch:\n{"a":4}\nHope that helps.')).toEqual({ a: 4 });
    expect(extractJson('  [1, 2, 3]  ')).toEqual([1, 2, 3]);
  });
  it("handles braces and escaped quotes inside strings when hunting for the object", () => {
    expect(extractJson('Result: {"text":"a } b \\" { c","n":1} trailing }')).toEqual({ text: 'a } b " { c', n: 1 });
  });
  it("rejects empty, non-JSON, truncated and broken output with a message fit to send back to the model", () => {
    for (const bad of ["", "   ", "I cannot do that.", '{"a":', '{"a":1,}', "```json\n{oops}\n```"]) {
      expect(() => extractJson(bad), JSON.stringify(bad)).toThrow(AgentOutputError);
    }
  });
  it("never executes anything: code-looking output is just a parse failure", () => {
    expect(() => extractJson("process.exit(1)")).toThrow(AgentOutputError);
    expect(() => extractJson("({a: (()=>{throw 1})()})")).toThrow(AgentOutputError);
  });
});

describe("freshenPatchIds", () => {
  let n = 0;
  const gen = () => `new_${++n}`;
  const patch = (ops: unknown[]): Patch => ({ summary: "s", ops: ops as Patch["ops"] });
  const text = (id: string) => ({ id, kind: "element", type: "text", props: { text: "x" } });

  it("replaces ids of inserted nodes (and their descendants) with fresh ones", () => {
    n = 0;
    const p = freshenPatchIds(patch([{ op: "insert", parentId: "existing", index: 0, node: { id: "hero1", kind: "container", type: "container", props: {}, children: [text("hero1"), text("a")] } }]), gen);
    const node = (p.ops[0] as any).node;
    expect(node.id).toBe("new_1");
    expect(node.children.map((c: any) => c.id)).toEqual(["new_2", "new_3"]); // even a child that reused its parent's id
    expect((p.ops[0] as any).parentId).toBe("existing"); // references to existing nodes are untouched
  });
  it("rewrites later references to nodes inserted earlier in the same patch", () => {
    n = 0;
    const p = freshenPatchIds(patch([
      { op: "insert", parentId: "sec", index: 0, node: text("tmp") },
      { op: "update", id: "tmp", props: { text: "y" } },
      { op: "insert", parentId: "tmp2", index: 0, node: text("tmp3") }, // tmp2 does not exist in this patch: left alone
      { op: "move", id: "tmp", parentId: "sec", index: 1 },
      { op: "remove", id: "tmp" },
    ]), gen);
    const [ins, upd, , mv, rm] = p.ops as any[];
    expect(upd.id).toBe(ins.node.id);
    expect(mv.id).toBe(ins.node.id);
    expect(rm.id).toBe(ins.node.id);
    expect((p.ops[2] as any).parentId).toBe("tmp2");
  });
  it("a model re-using an id that already exists in the page cannot clobber it", () => {
    n = 0;
    const p = freshenPatchIds(patch([{ op: "insert", parentId: "sec", index: 0, node: text("hero1") }]), gen);
    expect((p.ops[0] as any).node.id).not.toBe("hero1");
  });
  it("does not mutate its input", () => {
    const input = patch([{ op: "insert", parentId: "p", index: 0, node: text("t") }]);
    const copy = JSON.stringify(input);
    freshenPatchIds(input, gen);
    expect(JSON.stringify(input)).toBe(copy);
  });
  it("freshenNodeIds renames a whole tree", () => {
    n = 0;
    const t = freshenNodeIds({ id: "a", kind: "container", type: "container", props: {}, children: [text("b"), text("c")] } as any, gen);
    expect([t.id, ...t.children!.map((c) => c.id)]).toEqual(["new_1", "new_2", "new_3"]);
  });
});

describe("generateValidated", () => {
  const num = (s: string) => (/^\d+$/.test(s.trim()) ? ({ ok: true, value: Number(s) } as const) : ({ ok: false, error: `not a number: ${s}` } as const));
  const run = (p: ScriptedProvider, over: Record<string, unknown> = {}) => generateValidated({ provider: p, system: "S", user: "go", parse: num, maxTokens: 50, ...over });

  it("returns on the first valid answer", async () => {
    const p = new ScriptedProvider(["42"]);
    const r = await run(p);
    expect(r).toMatchObject({ ok: true, value: 42, attempts: 1 });
    expect(p.calls).toBe(1);
  });
  it("feeds the validator's error back and succeeds on a later attempt; usage covers every attempt", async () => {
    const p = new ScriptedProvider(["nope", "still no", "7"]);
    const r = await run(p);
    expect(r).toMatchObject({ ok: true, value: 7, attempts: 3 });
    const last = p.requests[2]!.messages;
    expect(last.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(last[2]!.content).toContain("not a number: nope");
    const sum = p.requests.reduce((a) => a, 0);
    void sum;
    expect(r.ok && r.usage.inputTokens).toBeGreaterThan(0);
  });
  it("gives up after maxAttempts with a friendly message (and never the validator's raw text)", async () => {
    const r = await run(new ScriptedProvider(["a", "b", "c", "d"]), { maxAttempts: 2 });
    expect(r).toMatchObject({ ok: false, reason: "invalid", attempts: 2 });
    expect((r as { message: string }).message).not.toContain("not a number");
  });
  it("a cut-off reply is retried with a 'shorter' request, and reported as truncated if it keeps happening", async () => {
    const cut: any = { name: "x", complete: async () => ({ text: "12", model: "m", stop: "length", usage: { inputTokens: 1, outputTokens: 1 } }) };
    const r = await generateValidated({ provider: cut, system: "S", user: "go", parse: num, maxTokens: 5, maxAttempts: 2 });
    expect(r).toMatchObject({ ok: false, reason: "truncated", attempts: 2 });
  });
  it("a provider failure stops at once with a safe message and the kind", async () => {
    const p = new ScriptedProvider([new ProviderError("rate_limited", "The AI service is busy.", true)]);
    const r = await run(p);
    expect(r).toMatchObject({ ok: false, reason: "provider", providerKind: "rate_limited", attempts: 1 });
    expect(p.calls).toBe(1);
  });
  it("an unexpected exception from a provider never leaks its message", async () => {
    const boom: any = { name: "x", complete: async () => { throw new Error("secret-key-abc in stack"); } };
    const r = await generateValidated({ provider: boom, system: "S", user: "go", parse: num, maxTokens: 5 });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret-key-abc");
  });
  it("stops at once if cancelled", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const p = new ScriptedProvider(["1"]);
    const r = await run(p, { signal: ctl.signal });
    expect(r.ok).toBe(false);
    expect(p.calls).toBe(0);
  });
  it("bounds how much of a bad answer is echoed back to the model", async () => {
    const huge = "x".repeat(50_000);
    const p = new ScriptedProvider([huge, "5"]);
    await run(p);
    const echoed = p.requests[1]!.messages.map((m) => m.content.length);
    expect(Math.max(...echoed)).toBeLessThan(5000);
  });
});

describe("canonical", () => {
  it("ignores key order at every depth but keeps array order and values", () => {
    expect(canonical({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonical({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
    expect(canonical({ a: undefined })).toBe(canonical({}));
    expect(canonical("x")).toBe('"x"');
    expect(canonical(null)).toBe("null");
  });
});
