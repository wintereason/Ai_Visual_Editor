import { describe, expect, it } from "vitest";
import { handlePublish, NDJSON, type PublishDeps } from "../src/publishRoute";
import { createFakeCloudflare } from "./fake-cloudflare.mjs";

const ACCOUNT = "a".repeat(32);
const TOKEN = "good-token-0123456789abcdef";

function deps(over: Partial<PublishDeps> = {}) {
  const cf = createFakeCloudflare();
  const logs: Record<string, unknown>[] = [];
  const d: PublishDeps = { authenticate: async (r) => (r.headers.get("authorization") === "Bearer good" ? "u1" : null), cf: { fetchImpl: cf.fetch as never, sleep: async () => {} }, log: (e) => logs.push(e), ...over };
  return { d, cf, logs };
}
function request(over: { files?: Record<string, string>; meta?: unknown; token?: string | null; auth?: string; method?: string; extra?: [string, string][] } = {}) {
  const form = new FormData();
  form.append("meta", JSON.stringify(over.meta ?? { accountId: ACCOUNT, projectName: "my-site" }));
  for (const [p, c] of Object.entries(over.files ?? { "index.html": "<h1>Hi</h1>", "_headers": "/*\n  X-Test: 1\n", "about/index.html": "<h1>About</h1>" })) form.append(p, new Blob([c]), p.split("/").pop());
  for (const [k, v] of over.extra ?? []) form.append(k, v);
  const headers: Record<string, string> = { authorization: over.auth ?? "Bearer good" };
  if (over.token !== null) headers["x-cf-token"] = over.token ?? TOKEN;
  return new Request("http://x/api/publish", { method: over.method ?? "POST", headers, body: over.method === "GET" ? undefined : form });
}
const lines = async (r: Response) => (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);

describe("handlePublish", () => {
  it("publishes: progress lines, then one result with the live address", async () => {
    const { d, logs } = deps();
    const res = await handlePublish(request(), d);
    expect(res.headers.get("content-type")).toBe(NDJSON);
    const l = await lines(res);
    expect(l.slice(0, -1).every((x) => x.type === "progress")).toBe(true);
    expect(l.slice(0, -1).map((x) => x.stage)).toEqual(expect.arrayContaining(["project", "uploading", "deploying", "verifying"]));
    const last = l[l.length - 1];
    expect(last).toMatchObject({ type: "result", status: 200, body: { ok: true, verified: true, productionUrl: "https://my-site.pages.dev" } });
    expect(logs).toEqual([{ event: "publish", ok: true, files: 3, uploaded: 2, verified: true }]);
  });
  it("only signed-in people, and only POST", async () => {
    const { d, cf } = deps();
    expect((await handlePublish(request({ auth: "Bearer nope" }), d)).status).toBe(401);
    expect((await handlePublish(request({ method: "GET" }), d)).status).toBe(405);
    const throwing = deps({ authenticate: async () => { throw new Error("boom"); } });
    expect((await handlePublish(request(), throwing.d)).status).toBe(401);
    expect(cf.state.log).toEqual([]); // nothing reached Cloudflare
  });
  it("is rate limited per person", async () => {
    const { d } = deps({ allow: () => false });
    const res = await handlePublish(request(), d);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
  it("rejects malformed uploads before contacting Cloudflare", async () => {
    const { d, cf } = deps();
    for (const bad of [
      request({ meta: "not-an-object" }),
      request({ meta: { accountId: 5, projectName: "x" } }),
      request({ extra: [["notafile", "just text"]] }),
    ]) expect((await handlePublish(bad, d)).status).toBe(400);
    const json = new Request("http://x", { method: "POST", headers: { authorization: "Bearer good", "content-type": "application/json" }, body: "{}" });
    expect((await handlePublish(json, d)).status).toBe(415);
    const huge = new Request("http://x", { method: "POST", headers: { authorization: "Bearer good", "content-type": "multipart/form-data; boundary=x", "content-length": String(500 * 1024 * 1024) }, body: "x" });
    expect((await handlePublish(huge, d)).status).toBe(413);
    expect(cf.state.log).toEqual([]);
  });
  it("a missing or bad token comes back as a clear result line, with the token nowhere in the output or logs", async () => {
    const { d, logs } = deps();
    const none = await lines(await handlePublish(request({ token: null }), d));
    expect(none[none.length - 1]).toMatchObject({ type: "result", status: 400, body: { code: "bad_token" } });
    const wrong = await lines(await handlePublish(request({ token: "wrong-token-0123456789abcdefgh" }), d));
    expect(wrong[wrong.length - 1]).toMatchObject({ status: 401, body: { code: "auth" } });
    const all = JSON.stringify([none, wrong, logs]);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("wrong-token-0123456789abcdefgh");
  });
  it("the token is only ever read from the header: a token in the body or URL is ignored", async () => {
    const { d, cf } = deps();
    const form = new FormData();
    form.append("meta", JSON.stringify({ accountId: ACCOUNT, projectName: "my-site", token: TOKEN }));
    form.append("index.html", new Blob(["x"]), "index.html");
    const res = await handlePublish(new Request(`http://x/api/publish?token=${TOKEN}`, { method: "POST", headers: { authorization: "Bearer good" }, body: form }), d);
    const l = await lines(res);
    expect(l[l.length - 1].body.code).toBe("bad_token");
    expect(cf.state.log).toEqual([]);
  });
  it("unsafe file names are refused", async () => {
    const { d } = deps();
    const l = await lines(await handlePublish(request({ files: { "index.html": "x", "../evil.html": "y" } }), d));
    expect(l[l.length - 1].body.code).toBe("bad_path");
  });
});
