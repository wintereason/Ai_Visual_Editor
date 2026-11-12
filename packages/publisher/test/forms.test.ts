import { describe, expect, it } from "vitest";
import { exampleProject, type Project } from "@avc/schema";
import { formScript } from "@avc/renderer";
import { buildSite, sha256Base64, type BuildResult } from "../src";

const dec = new TextDecoder();
const ok = (r: BuildResult): BuildResult & { ok: true } => { if (!r.ok) throw new Error(r.errors.join("|")); return r; };
const page = (r: BuildResult & { ok: true }, f = "index.html") => dec.decode(r.files[f]);

const withForm = (): Project => {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes.splice(2, 0, { id: "sec_form", kind: "container", type: "section", props: {}, children: [{ id: "contact1", kind: "block", type: "contactForm", variant: "simple", props: { title: "Get in touch", submitLabel: "Send" } }] });
  return p;
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ANON = `${b64({ alg: "HS256" })}.${b64({ role: "anon", ref: "abc" })}.signaturesignature`;
const forms = { supabaseUrl: "https://abc.supabase.co", anonKey: ANON, siteSlug: "my-school" };

describe("published contact forms", () => {
  it("without forms connected: the form stays inert, no script, and the build warns", async () => {
    const r = ok(await buildSite(withForm(), []));
    expect(page(r)).not.toContain("data-avc-form");
    expect(page(r)).not.toContain("submit_form");
    expect(r.manifest.warnings.join(" ")).toMatch(/contact form.*isn't connected/);
    expect(page(r, "_headers")).not.toContain("connect-src");
  });
  it("no warning when the site has no contact form", async () => {
    const r = ok(await buildSite(exampleProject, [], { forms }));
    expect(r.manifest.warnings.join(" ")).not.toMatch(/contact form/);
  });
  it("with forms connected: live form, honeypot, status line, and exactly one inline form script", async () => {
    const r = ok(await buildSite(withForm(), [], { forms }));
    const html = page(r);
    expect(html).toContain('data-avc-form="contact1"');
    expect(html).toContain('name="website"');
    expect(html).toContain("data-avc-status");
    expect(html).toContain("https://abc.supabase.co/rest/v1/rpc/submit_form");
    expect(html).toContain('"p_site_slug"'.replace('"p_site_slug"', "p_site_slug"));
    expect(r.manifest.warnings.join(" ")).not.toMatch(/contact form/);
  });
  it("the CSP allows that script by hash and connections to the backend origin only", async () => {
    const r = ok(await buildSite(withForm(), [], { forms }));
    const csp = /Content-Security-Policy" content="([^"]*)"/.exec(page(r))![1]!.replace(/&#39;/g, "'");
    const script = /<script>(\(function\(\)\{var C=[\s\S]*?)<\/script>/.exec(page(r))![1]!;
    expect(csp).toContain(`'sha256-${await sha256Base64(script)}'`);
    expect(csp).toContain("connect-src https://abc.supabase.co");
    expect(csp).not.toMatch(/unsafe-inline'?[^;]*script|script-src[^;]*unsafe/);
    expect(csp).toContain("default-src 'none'");
    // the header version agrees
    expect(page(r, "_headers")).toContain("connect-src https://abc.supabase.co");
    expect(page(r, "_headers")).toContain(`'sha256-${await sha256Base64(script)}'`);
  });
  it("never writes a service-role key into a site, in any form it might arrive", async () => {
    const jwt = `${b64({ alg: "HS256" })}.${b64({ role: "service_role", ref: "abc" })}.signaturesignature`;
    for (const key of [jwt, "sb_secret_abcdefghijklmnopqrstuvwxyz", "my-service-role-key-abcdefghijklmnop"]) {
      const r = await buildSite(withForm(), [], { forms: { ...forms, anonKey: key } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toMatch(/service-role|anon key/);
    }
  });
  it("rejects bad backend addresses, keys and slugs", async () => {
    for (const bad of [{ supabaseUrl: "http://abc.supabase.co" }, { supabaseUrl: "not a url" }, { supabaseUrl: "https://u:p@abc.supabase.co" }, { anonKey: "short" }, { anonKey: ANON + '"><script>' }, { siteSlug: "A_B" }, { siteSlug: "x" }, { siteSlug: "-bad-" }]) {
      expect((await buildSite(withForm(), [], { forms: { ...forms, ...bad } })).ok).toBe(false);
    }
  });
  it("the backend address is reduced to its origin (no path or query can ride along)", async () => {
    const r = ok(await buildSite(withForm(), [], { forms: { ...forms, supabaseUrl: "https://abc.supabase.co/evil?x=1#y" } }));
    expect(page(r)).toContain("https://abc.supabase.co/rest/v1/rpc/submit_form");
    expect(page(r)).not.toContain("evil");
  });
  it("builds are deterministic", async () => {
    const a = ok(await buildSite(withForm(), [], { forms }));
    const b = ok(await buildSite(withForm(), [], { forms }));
    expect(a.manifest.buildHash).toBe(b.manifest.buildHash);
  });
  it("the script config can never break out of the script element", () => {
    const s = formScript({ endpoint: "https://a.b/x</script><script>alert(1)", key: "k </script>", slug: "s" });
    expect(s).not.toMatch(/<\/script|<script/i);
  });
});
