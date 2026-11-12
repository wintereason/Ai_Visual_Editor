import { describe, expect, it } from "vitest";
import { exampleProject } from "@avc/schema";
import { generateValidated, handleAiStream, MemoryCredits, NDJSON, ScriptedProvider, type AiDeps, type Progress } from "../src";

const setHeadline = (t: string) => JSON.stringify({ summary: "Changed", ops: [{ op: "update", id: "hero1", props: { headline: t } }] });
let seq = 0;

function deps(script: ConstructorParameters<typeof ScriptedProvider>[0], balance = 20): { d: AiDeps; store: MemoryCredits } {
  const store = new MemoryCredits();
  if (balance > 0) store.grant("u1", balance);
  return { store, d: { provider: new ScriptedProvider(script), credits: store, authenticate: async (r) => (r.headers.get("authorization") === "Bearer good" ? "u1" : null), newId: () => `s${++seq}` } };
}
const req = (body: unknown, auth = "Bearer good") =>
  new Request("http://x/api/ai/patch", { method: "POST", headers: { "content-type": "application/json", authorization: auth, accept: NDJSON }, body: JSON.stringify(body) });
const body = { project: exampleProject, nodeId: "hero1", instruction: "make it friendlier" };

async function lines(res: Response) {
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);
}

describe("generateValidated progress", () => {
  const parse = (t: string) => (t === "ok" ? ({ ok: true, value: 1 } as const) : ({ ok: false, error: "nope" } as const));
  it("reports asking, checking, then fixing on a retry", async () => {
    const seen: Progress[] = [];
    const r = await generateValidated({ provider: new ScriptedProvider(["bad", "ok"]), system: "s", user: "u", parse, maxTokens: 10, onProgress: (p) => seen.push(p) });
    expect(r.ok).toBe(true);
    expect(seen.map((p) => `${p.stage}${p.attempt}`)).toEqual(["asking1", "checking1", "fixing2", "checking2"]);
    expect(seen.every((p) => p.of === 3)).toBe(true);
  });
  it("a listener that throws never breaks generation", async () => {
    const r = await generateValidated({ provider: new ScriptedProvider(["ok"]), system: "s", user: "u", parse, maxTokens: 10, onProgress: () => { throw new Error("boom"); } });
    expect(r.ok).toBe(true);
  });
  it("progress events carry only stage names and counters", async () => {
    const seen: Progress[] = [];
    await generateValidated({ provider: new ScriptedProvider(["SECRET-MODEL-OUTPUT", "ok"]), system: "s", user: "u", parse, maxTokens: 10, onProgress: (p) => seen.push(p) });
    expect(JSON.stringify(seen)).not.toContain("SECRET");
    expect(seen.every((p) => Object.keys(p).sort().join() === "attempt,of,stage")).toBe(true);
  });
});

describe("handleAiStream", () => {
  it("streams progress lines and ends with exactly one result", async () => {
    const { d } = deps([setHeadline("Hi")]);
    const res = handleAiStream("patch", req(body), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(NDJSON);
    const l = await lines(res);
    expect(l.filter((x) => x.type === "result")).toHaveLength(1);
    expect(l[l.length - 1].type).toBe("result");
    expect(l[l.length - 1].status).toBe(200);
    expect(l[l.length - 1].body.ok).toBe(true);
    expect(l.filter((x) => x.type === "progress").map((x) => x.stage)).toEqual(["asking", "checking"]);
  });
  it("a retry shows up as a fixing step before the result", async () => {
    const { d } = deps(["not json", setHeadline("Hi")]);
    const l = await lines(handleAiStream("patch", req(body), d));
    expect(l.filter((x) => x.type === "progress").map((x) => x.stage)).toContain("fixing");
    expect(l[l.length - 1].body.ok).toBe(true);
  });
  it("auth, credit and validation failures arrive as a result line with the normal status and message", async () => {
    const a = await lines(handleAiStream("patch", req(body, "Bearer bad"), deps([]).d));
    expect(a).toEqual([{ type: "result", status: 401, body: expect.objectContaining({ code: "unauthorized" }) }]);
    const c = await lines(handleAiStream("patch", req(body), deps([setHeadline("x")], 0).d));
    expect(c[c.length - 1]).toMatchObject({ type: "result", status: 402 });
    const v = await lines(handleAiStream("patch", req({ nope: 1 }), deps([]).d));
    expect(v[v.length - 1]).toMatchObject({ type: "result", status: 400 });
  });
  it("charges exactly as the plain endpoint does: nothing on failure, once on success", async () => {
    const ok = deps([setHeadline("Hi")]);
    await lines(handleAiStream("patch", req(body), ok.d));
    expect(await ok.store.available("u1")).toBe(19);
    const bad = deps(["x", "x", "x"]);
    const l = await lines(handleAiStream("patch", req(body), bad.d));
    expect(l[l.length - 1].status).toBe(422);
    expect(await bad.store.available("u1")).toBe(20);
  });
  it("never leaks provider details", async () => {
    const { d } = deps([new Error("sk-ant-SECRET stack trace") as never]);
    const text = await handleAiStream("patch", req(body), d).text();
    expect(text).not.toMatch(/sk-ant|SECRET|stack/);
  });
});
