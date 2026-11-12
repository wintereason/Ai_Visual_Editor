import { describe, expect, it } from "vitest";
import { exampleProject } from "@avc/schema";
import { buildSite } from "../src";
import { deployToCloudflare } from "../src/cloudflare";
import { connectDomain, domainStatus, looksLikeApex, normalizeDomain } from "../src/cloudflareDomains";
import { handleDomain } from "../src/domainRoute";
import type { PublishDeps } from "../src/publishRoute";
import { createFakeCloudflare } from "./fake-cloudflare.mjs";

const ACCOUNT = "a".repeat(32);
const TOKEN = "good-token-0123456789abcdef";

async function published(over: Parameters<typeof createFakeCloudflare>[0] = {}) {
  const cf = createFakeCloudflare(over);
  const site = await buildSite(exampleProject, []);
  if (!site.ok) throw new Error("build");
  const r = await deployToCloudflare({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", files: site.files }, { fetchImpl: cf.fetch as never, sleep: async () => {} });
  expect(r.ok).toBe(true);
  const opts = { fetchImpl: cf.fetch as never };
  const base = { accountId: ACCOUNT, token: TOKEN, projectName: "my-site" };
  return { cf, opts, base };
}

describe("normalizeDomain", () => {
  it("accepts ordinary hostnames, lowercases, and strips a trailing dot", () => {
    expect(normalizeDomain("WWW.Example.com")).toBe("www.example.com");
    expect(normalizeDomain("shop.example.co.in.")).toBe("shop.example.co.in");
    expect(normalizeDomain("xn--bcher-kva.example")).toBe("xn--bcher-kva.example"); // punycode is fine
  });
  it("rejects what isn't a plain domain", () => {
    for (const bad of ["", "localhost", "example", "http://example.com", "example.com/path", "exa mple.com", "-a.example.com", "a..com", "1.2.3.4", "foo.123", "bücher.example", "x.pages.dev", "pages.dev", "a.workers.dev", "a".repeat(64) + ".com", "a.b" + ".c".repeat(130)])
      expect(normalizeDomain(bad)).toBeNull();
  });
  it("tells apex from sub-domains", () => {
    expect(looksLikeApex("example.com")).toBe(true);
    expect(looksLikeApex("www.example.com")).toBe(false);
  });
});

describe("connecting a domain", () => {
  it("connects a subdomain, tells you the CNAME target, and reports pending until DNS is ready, then active", async () => {
    const { cf, opts, base } = await published({ domainActivatePolls: 3 });
    const a = await connectDomain({ ...base, domain: "www.example.com" }, opts);
    expect(a).toMatchObject({ ok: true, domain: "www.example.com", status: "initializing", active: false, cnameTarget: "my-site.pages.dev", isApex: false });
    expect(cf.state.domains.get("www.example.com")?.project).toBe("my-site");
    const s1 = await domainStatus({ ...base, domain: "www.example.com" }, opts);
    expect(s1).toMatchObject({ ok: true, status: "pending", active: false });
    if (s1.ok) expect(s1.detail).toContain("CNAME");
    const s3 = await domainStatus({ ...base, domain: "www.example.com" }, opts);
    const s4 = await domainStatus({ ...base, domain: "www.example.com" }, opts);
    expect([s3, s4].some((x) => x.ok && x.active)).toBe(true);
  });
  it("connecting the same domain again is fine and just reports where it stands", async () => {
    const { opts, base } = await published();
    await connectDomain({ ...base, domain: "www.example.com" }, opts);
    const again = await connectDomain({ ...base, domain: "www.example.com" }, opts);
    expect(again).toMatchObject({ ok: true, domain: "www.example.com" });
  });
  it("an apex domain that Cloudflare refuses comes back with advice about adding it to Cloudflare DNS", async () => {
    const { opts, base } = await published();
    const r = await connectDomain({ ...base, domain: "example.com" }, opts);
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    if (!r.ok) expect(r.message).toContain("Cloudflare DNS");
  });
  it("needs a published project first", async () => {
    const cf = createFakeCloudflare();
    const r = await connectDomain({ accountId: ACCOUNT, token: TOKEN, projectName: "never-published", domain: "www.example.com" }, { fetchImpl: cf.fetch as never });
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    if (!r.ok) expect(r.message).toContain("Publish the site first");
  });
  it("bad token, account, project and domain are rejected before any request", async () => {
    const cf = createFakeCloudflare();
    const opts = { fetchImpl: cf.fetch as never };
    for (const [over, code] of [
      [{ accountId: "x" }, "bad_account"], [{ projectName: "Bad Name" }, "bad_project"], [{ token: "short" }, "bad_token"], [{ domain: "not a domain" }, "bad_domain"], [{ domain: "x.pages.dev" }, "bad_domain"],
    ] as const) {
      const input: { accountId: string; token: string; projectName: string; domain: string } = { accountId: ACCOUNT, token: TOKEN, projectName: "my-site", domain: "www.example.com" };
      expect(await connectDomain({ ...input, ...over }, opts)).toMatchObject({ ok: false, code });
    }
    expect(cf.state.log).toEqual([]);
  });
  it("a rejected token explains the needed permission and never repeats the token", async () => {
    const { opts, base } = await published();
    const r = await connectDomain({ ...base, token: "some-other-token-0123456789", domain: "www.example.com" }, opts);
    expect(r).toMatchObject({ ok: false, code: "auth" });
    expect(JSON.stringify(r)).not.toContain("some-other-token");
    expect((r as { message: string }).message).toContain("Pages: Edit");
  });
  it("network failure and Cloudflare outage are friendly, with no raw error text", async () => {
    const down = async () => { throw new TypeError("secret-detail"); };
    const r1 = await connectDomain({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", domain: "www.example.com" }, { fetchImpl: down as never });
    expect(r1).toMatchObject({ ok: false, code: "network" });
    const five = async () => new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: "internal secret text" }] }), { status: 503 });
    const r2 = await connectDomain({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", domain: "www.example.com" }, { fetchImpl: five as never });
    expect(r2).toMatchObject({ ok: false, code: "cloudflare_down" });
    expect(JSON.stringify([r1, r2])).not.toMatch(/secret/);
  });
  it("an unknown status from Cloudflare is reported as unknown, never as active", async () => {
    const { cf, opts, base } = await published();
    const orig = cf.api;
    cf.api = async (req: Request) => {
      const res = await orig(req);
      if (new URL(req.url).pathname.includes("/domains")) { const b = await res.json(); b.result.status = "something-new"; return new Response(JSON.stringify(b), { status: 200 }); }
      return res;
    };
    const r = await connectDomain({ ...base, domain: "www.example.com" }, opts);
    expect(r).toMatchObject({ ok: true, status: "unknown", active: false });
  });
});

describe("handleDomain route", () => {
  function deps(over: Partial<PublishDeps> = {}) {
    const logs: Record<string, unknown>[] = [];
    return { logs, d: { authenticate: async (r: Request) => (r.headers.get("authorization") === "Bearer good" ? "u1" : null), log: (e: Record<string, unknown>) => logs.push(e), ...over } as PublishDeps };
  }
  const req = (body: unknown, over: { auth?: string; token?: string; method?: string } = {}) =>
    new Request("http://x/api/publish/domain", { method: over.method ?? "POST", headers: { "content-type": "application/json", authorization: over.auth ?? "Bearer good", "x-cf-token": over.token ?? TOKEN }, body: over.method === "GET" ? undefined : JSON.stringify(body) });
  const ok = { accountId: ACCOUNT, projectName: "my-site", domain: "www.example.com", action: "connect" };

  it("connects through the route with the token only from the header, and logs nothing sensitive", async () => {
    const cf = createFakeCloudflare();
    const site = await buildSite(exampleProject, []);
    if (site.ok) await deployToCloudflare({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", files: site.files }, { fetchImpl: cf.fetch as never, sleep: async () => {} });
    const { d, logs } = deps({ cf: { fetchImpl: cf.fetch as never } });
    const res = await handleDomain(req(ok), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, domain: "www.example.com", cnameTarget: "my-site.pages.dev" });
    expect(JSON.stringify(logs)).not.toMatch(/example\.com|good-token|my-site|a{32}/);
    expect((await handleDomain(req({ ...ok, action: "status" }), d)).status).toBe(200);
  });
  it("signed-in only, POST only, rate limited, and strict about the body", async () => {
    const { d } = deps();
    expect((await handleDomain(req(ok, { auth: "Bearer no" }), d)).status).toBe(401);
    expect((await handleDomain(req(ok, { method: "GET" }), d)).status).toBe(405);
    expect((await handleDomain(req(ok), deps({ allow: () => false }).d)).status).toBe(429);
    for (const bad of [{}, { ...ok, action: "delete" }, { ...ok, domain: 5 }]) expect((await handleDomain(req(bad), d)).status).toBe(400);
    expect((await handleDomain(new Request("http://x", { method: "POST", headers: { authorization: "Bearer good" }, body: "not json" }), d)).status).toBe(400);
    expect((await handleDomain(new Request("http://x", { method: "POST", headers: { authorization: "Bearer good" }, body: "x".repeat(5000) }), d)).status).toBe(413);
  });
  it("maps failures to sensible statuses", async () => {
    const cf = createFakeCloudflare();
    const { d } = deps({ cf: { fetchImpl: cf.fetch as never } });
    expect((await handleDomain(req(ok), d)).status).toBe(404); // project doesn't exist
    expect((await handleDomain(req({ ...ok, domain: "nope" }), d)).status).toBe(400);
    expect((await handleDomain(req(ok, { token: "wrong-token-0123456789abcd" }), d)).status).toBe(401);
  });
});
