import { describe, expect, it } from "vitest";
import { exampleProject } from "@avc/schema";
import { buildCsp, buildSite, type BuildResult } from "../src";

const dec = new TextDecoder();
const ok = (r: BuildResult): BuildResult & { ok: true } => { if (!r.ok) throw new Error(r.errors.join("|")); return r; };
const page = (r: BuildResult & { ok: true }, f = "index.html") => dec.decode(r.files[f]);
const TOKEN = "0123456789abcdef0123456789abcdef";
const csp = (html: string) => /Content-Security-Policy" content="([^"]*)"/.exec(html)![1]!.replace(/&#39;/g, "'");

describe("analytics (Cloudflare Web Analytics, opt-in)", () => {
  it("off by default: no beacon, nothing about it in the CSP", async () => {
    const r = ok(await buildSite(exampleProject, []));
    expect(page(r)).not.toContain("cloudflareinsights");
    expect(page(r, "_headers")).not.toContain("cloudflareinsights");
    expect(csp(page(r))).not.toContain("connect-src");
  });
  it("on: one deferred external script with the token, on every page, and the CSP allows exactly its hosts", async () => {
    const r = ok(await buildSite(exampleProject, [], { analytics: { token: TOKEN } }));
    const html = page(r);
    expect(html).toContain(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${TOKEN}"}'></script>`);
    expect(html.match(/beacon\.min\.js/g)).toHaveLength(1);
    const c = csp(html);
    expect(c).toMatch(/script-src [^;]*'sha256-[^']+'[^;]* https:\/\/static\.cloudflareinsights\.com/);
    expect(c).toContain("connect-src 'self' https://cloudflareinsights.com");
    expect(c).toContain("default-src 'none'"); // everything else still denied
    expect(c).not.toMatch(/unsafe-inline'[^;]*script|script-src[^;]*unsafe/);
    expect(page(r, "_headers")).toContain("https://static.cloudflareinsights.com");
    expect(page(r, "_headers")).toContain("connect-src 'self' https://cloudflareinsights.com");
  });
  it("combines with connected forms: connect-src lists both, once each", async () => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes.splice(2, 0, { id: "sf", kind: "container", type: "section", props: {}, children: [{ id: "cf", kind: "block", type: "contactForm", variant: "simple", props: { title: "Hi", submitLabel: "Send" } }] });
    const anon = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"role":"anon"}').toString("base64url")}.signaturesignature`;
    const r = ok(await buildSite(p, [], { analytics: { token: TOKEN }, forms: { supabaseUrl: "https://abc.supabase.co", anonKey: anon, siteSlug: "my-school" } }));
    const c = csp(page(r));
    expect(c).toMatch(/connect-src [^;]*https:\/\/abc\.supabase\.co/);
    expect(c).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
    expect(c.match(/connect-src/g)).toHaveLength(1);
  });
  it("refuses anything that isn't a 32-character lowercase hex token, so nothing can be injected into the page", async () => {
    for (const bad of ["", "short", TOKEN.toUpperCase(), TOKEN + "0", `${TOKEN.slice(0, 20)}"><script>alert(1)</script>`, `${TOKEN.slice(0, 31)}'`, "g".repeat(32)]) {
      const r = await buildSite(exampleProject, [], { analytics: { token: bad } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toContain("analytics token");
    }
  });
  it("is deterministic and doesn't disturb other output", async () => {
    const a = ok(await buildSite(exampleProject, [], { analytics: { token: TOKEN } }));
    const b = ok(await buildSite(exampleProject, [], { analytics: { token: TOKEN } }));
    expect(a.manifest.buildHash).toBe(b.manifest.buildHash);
    const none = ok(await buildSite(exampleProject, []));
    expect(a.manifest.buildHash).not.toBe(none.manifest.buildHash);
  });
  it("buildCsp keeps its old signature (a plain connect origin string still works)", () => {
    expect(buildCsp("abc", "meta", "https://x.example")).toContain("connect-src https://x.example");
    expect(buildCsp(["a", "b"], "header")).toContain("'sha256-a' 'sha256-b'");
  });
});
