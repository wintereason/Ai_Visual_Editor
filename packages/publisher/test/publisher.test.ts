import { describe, expect, it } from "vitest";
import { EMBED_ORIGINS, exampleProject, type Asset, type Project } from "@avc/schema";
import { ANIM_SCRIPT } from "@avc/renderer";
import { TEMPLATES } from "@avc/templates";
import { buildSite, buildCsp, normalizeBaseUrl, publicAssetPath, sha256Base64, sha256Hex, verifyAsset, type BuildResult, type LibraryAsset } from "../src";

const dec = new TextDecoder();
const text = (r: BuildResult & { ok: true }, f: string) => dec.decode(r.files[f]);
const okBuild = (r: BuildResult): BuildResult & { ok: true } => {
  if (!r.ok) throw new Error("build failed: " + r.errors.join(" | "));
  return r;
};

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
async function lib(id: string, bytes: Uint8Array = PNG, over: Partial<Asset> = {}): Promise<LibraryAsset> {
  return { bytes, asset: { id, name: id, kind: "png", mime: "image/png", bytes: bytes.length, width: 1, height: 1, hash: await sha256Hex(bytes), createdAt: 1, ...over } };
}
const withImage = (assetId: string, alt = "A picture"): Project => {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes[1]!.children!.push({ id: "im", kind: "element", type: "image", props: { assetId, alt, fit: "cover" } });
  return p;
};

describe("buildSite: every template builds to a complete, self-consistent site", () => {
  for (const t of TEMPLATES) {
    it(`${t.id}`, async () => {
      const project = t.make();
      const r = okBuild(await buildSite(project, [], { baseUrl: "https://example.com" }));
      const names = Object.keys(r.files);
      for (const f of ["index.html", "404.html", "_headers", "robots.txt", "sitemap.xml"]) expect(names).toContain(f);
      expect(r.manifest.pages).toHaveLength(project.pages.length);
      for (const p of r.manifest.pages) expect(names).toContain(p.file);
      for (const p of project.pages) {
        const html = text(r, r.manifest.pages.find((x) => x.id === p.id)!.file);
        expect(html).toMatch(/^<!doctype html>/);
        expect(html).toContain("Content-Security-Policy");
        expect(html).toContain(`<link rel="canonical" href="https://example.com${p.path === "/" ? "/" : p.path}">`);
        expect(html).toContain(`<meta name="description" content="`);
      }
      expect(text(r, "sitemap.xml").match(/<loc>/g)).toHaveLength(project.pages.length);
    });
  }
});

describe("buildSite: refuses to build bad input", () => {
  it("rejects invalid projects (registry validation, the check the database cannot do)", async () => {
    const bad = structuredClone(exampleProject);
    bad.pages[0]!.nodes[1]!.children![0]!.props.ctaHref = "javascript:alert(1)";
    const r = await buildSite(bad, []);
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.join()).toMatch(/url must be/);
  });
  it("rejects data that is not a project at all, without throwing", async () => {
    for (const junk of [null, undefined, 42, "x", {}, { schemaVersion: 2, pages: "nope" }, []]) expect((await buildSite(junk, [])).ok).toBe(false);
  });
  it("rejects disallowed embeds (spec 15.1 allow-list)", async () => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[1]!.children!.push({ id: "em", kind: "element", type: "embed", props: { provider: "youtube", url: "https://evil.example.com/embed/x" } });
    expect((await buildSite(p, [])).ok).toBe(false);
  });
  it("blocks on pre-publish errors (missing alt text) and a missing library file", async () => {
    expect((await buildSite(withImage("a1", ""), [await lib("a1")])).ok).toBe(false);
    const r = await buildSite(withImage("gone"), [await lib("other")]);
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.join()).toMatch(/media library/);
  });
  it("returns lint warnings without blocking", async () => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.seo = {};
    const r = okBuild(await buildSite(p, []));
    expect(r.manifest.warnings.join()).toMatch(/SEO title/);
  });
  it("rejects a bad site address instead of guessing", async () => {
    for (const bad of ["http://example.com", "javascript:alert(1)", "not a url", "https://user:pw@example.com", "ftp://x.com"])
      expect((await buildSite(exampleProject, [], { baseUrl: bad })).ok, bad).toBe(false);
  });
});

describe("verifyAsset: bytes are re-checked at publish time, metadata is not trusted", () => {
  it("accepts a genuine asset", async () => expect(await verifyAsset(await lib("a"))).toEqual([]));

  it("rejects SVG/script/HTML bytes labelled as an image, even with a matching hash", async () => {
    for (const evil of ["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "<script>alert(1)</script>", "<!doctype html><h1>x</h1>"]) {
      const problems = await verifyAsset(await lib("a", new TextEncoder().encode(evil)));
      expect(problems.join()).toMatch(/not a supported image/);
    }
  });
  it("rejects a type mismatch (PNG bytes recorded as WebP, and the reverse label trick)", async () => {
    expect((await verifyAsset(await lib("a", PNG, { kind: "webp", mime: "image/webp" }))).join()).toMatch(/recorded as webp but its contents are png/);
    expect((await verifyAsset(await lib("a", PNG, { mime: "image/svg+xml" }))).join()).toMatch(/mismatched type label/);
  });
  it("rejects bytes that changed after upload (hash mismatch)", async () => {
    const tampered = PNG.slice();
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    const l = await lib("a");
    expect((await verifyAsset({ asset: l.asset, bytes: tampered })).join()).toMatch(/changed after upload/);
  });
  it("rejects wrong recorded size, empty and oversized files", async () => {
    expect((await verifyAsset(await lib("a", PNG, { bytes: 999 }))).join()).toMatch(/999 were recorded/);
    expect((await verifyAsset(await lib("a", new Uint8Array(0)))).join()).toMatch(/empty/);
    const big = new Uint8Array(21 * 1024 * 1024);
    big.set(PNG.subarray(0, 12));
    expect((await verifyAsset(await lib("a", big))).join()).toMatch(/larger than 20 MB/);
  });
  it("a build with one bad image fails as a whole and publishes nothing", async () => {
    const good = await lib("good");
    const bad = await lib("bad", new TextEncoder().encode("<script>x</script>"));
    const p = withImage("good");
    p.pages[0]!.nodes[1]!.children!.push({ id: "im2", kind: "element", type: "image", props: { assetId: "bad", alt: "x", fit: "cover" } });
    const r = await buildSite(p, [good, bad]);
    expect(r.ok).toBe(false);
    expect("files" in r).toBe(false);
  });
});

describe("assets in the output", () => {
  it("ships only the images the site uses, at content-addressed paths, and the page points at them", async () => {
    const used = await lib("used");
    const unused = await lib("unused", Uint8Array.from([...PNG, 0]), {}); // different bytes -> different hash
    const r = okBuild(await buildSite(withImage("used"), [used, unused]));
    const assetFiles = Object.keys(r.files).filter((f) => f.startsWith("assets/"));
    expect(assetFiles).toEqual([publicAssetPath(used.asset)]);
    expect(assetFiles[0]).toMatch(/^assets\/[0-9a-f]{12}\.png$/);
    expect(r.files[assetFiles[0]!]).toEqual(PNG);
    expect(text(r, "index.html")).toContain(`src="/${assetFiles[0]}"`);
    expect(text(r, "index.html")).not.toContain("blob:");
  });
  it("hero images and background styles are published too", async () => {
    const a = await lib("hero");
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[1]!.children![0]!.props.imageAssetId = "hero";
    p.pages[0]!.nodes[2]!.styles = { base: { normal: { background: { assetId: "hero", fit: "cover" } } } };
    const r = okBuild(await buildSite(p, [a]));
    const html = text(r, "index.html");
    expect(html).toContain("avc-hero-img");
    expect(html).toContain(`url("/${publicAssetPath(a.asset)}")`);
    expect(Object.keys(r.files).filter((f) => f.startsWith("assets/"))).toHaveLength(1);
  });
  it("two library entries with identical bytes publish one file", async () => {
    const a = await lib("one");
    const b = await lib("two");
    const p = withImage("one");
    p.pages[0]!.nodes[1]!.children!.push({ id: "im2", kind: "element", type: "image", props: { assetId: "two", alt: "x", fit: "cover" } });
    const r = okBuild(await buildSite(p, [a, b]));
    expect(Object.keys(r.files).filter((f) => f.startsWith("assets/"))).toHaveLength(1);
  });
});

describe("images inside blocks (galleries, team photos, logos)", () => {
  const withGallery = (images: unknown[], team?: unknown[]): Project => {
    const proj = structuredClone(exampleProject);
    proj.pages[0]!.nodes[2]!.children!.push({ id: "gal", kind: "block", type: "gallery", variant: "grid", props: { images } });
    if (team) proj.pages[0]!.nodes[2]!.children!.push({ id: "tm", kind: "block", type: "team", variant: "cards", props: { members: team } });
    return proj;
  };
  it("ships gallery and team images, content-addressed, and the page points at them", async () => {
    const a = await lib("ga");
    const b = await lib("tb", Uint8Array.from([...PNG, 1]));
    const r = okBuild(await buildSite(withGallery([{ assetId: "ga", alt: "One" }], [{ name: "Asha", imageAssetId: "tb" }]), [a, b]));
    const files = Object.keys(r.files).filter((f) => f.startsWith("assets/")).sort();
    expect(files).toEqual([publicAssetPath(a.asset), publicAssetPath(b.asset)].sort());
    const html = text(r, "index.html");
    expect(html).toContain(`src="/${publicAssetPath(a.asset)}"`);
    expect(html).toContain(`src="/${publicAssetPath(b.asset)}"`);
  });
  it("a tampered image inside a gallery fails the whole build", async () => {
    const bad = await lib("ga", new TextEncoder().encode("<script>alert(1)</script>"));
    expect((await buildSite(withGallery([{ assetId: "ga", alt: "One" }]), [bad])).ok).toBe(false);
  });
  it("a gallery image missing from the library, or without alt text, blocks publishing", async () => {
    const r1 = await buildSite(withGallery([{ assetId: "ghost", alt: "One" }]), []);
    expect(r1.ok).toBe(false);
    expect((r1 as { errors: string[] }).errors.join()).toMatch(/media library/);
    const r2 = await buildSite(withGallery([{ src: "https://x.test/a.jpg", alt: "" }]), []);
    expect(r2.ok).toBe(false);
    expect((r2 as { errors: string[] }).errors.join()).toMatch(/no alt text/);
  });
  it("unused library files are still not shipped", async () => {
    const used = await lib("used");
    const unused = await lib("unused", Uint8Array.from([...PNG, 9]));
    const r = okBuild(await buildSite(withGallery([{ assetId: "used", alt: "x" }]), [used, unused]));
    expect(Object.keys(r.files).filter((f) => f.startsWith("assets/"))).toEqual([publicAssetPath(used.asset)]);
  });
});

describe("security headers and CSP (spec 15.1)", () => {
  it("the CSP allows exactly one inline script: the animation runtime, by hash", async () => {
    const hash = await sha256Base64(ANIM_SCRIPT);
    const csp = buildCsp(hash, "header");
    expect(csp).toContain(`script-src 'sha256-${hash}'`);
    expect(csp).not.toMatch(/script-src[^;]*('unsafe-inline'|'unsafe-eval'|\*|https:)/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(buildCsp(hash, "meta")).not.toContain("frame-ancestors"); // ignored in <meta>
  });
  it("frame-src mirrors the schema's embed allow-list, so the two can never drift", async () => {
    const csp = buildCsp("x", "header");
    const frame = /frame-src ([^;]+)/.exec(csp)![1]!.split(" ").sort();
    const expected = [...new Set(Object.values(EMBED_ORIGINS).flat().map((o) => `https://${o.host}`))].sort();
    expect(frame).toEqual(expected);
  });
  it("_headers carries the CSP, nosniff, no-framing, and immutable caching for assets only", async () => {
    const h = text(okBuild(await buildSite(exampleProject, [])), "_headers");
    expect(h).toContain("Content-Security-Policy: default-src 'none'");
    expect(h).toContain("X-Content-Type-Options: nosniff");
    expect(h).toContain("X-Frame-Options: DENY");
    expect(h).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
    expect(h.split("/assets/*")[0]).not.toContain("immutable");
  });
  it("the script hash in the CSP matches the script actually inlined in the page", async () => {
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[2]!.children![0]!.animation = { preset: "slide-up", trigger: "scroll" };
    const r = okBuild(await buildSite(p, []));
    const html = text(r, "index.html");
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const hash = await sha256Base64(inline);
    expect(html).toContain(`&#39;sha256-${hash}&#39;`); // inside an HTML attribute, so quotes are entity-escaped (browsers decode them)
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});

describe("SEO output is escaped and only uses what the owner configured", () => {
  it("escapes hostile titles/descriptions in meta tags (no attribute or tag break-out)", async () => {
    const p = structuredClone(exampleProject);
    p.name = `Evil "><script>alert(1)</script>`;
    p.pages[0]!.seo = { title: `T "><img src=x onerror=alert(1)>`, description: `D "><script>alert(2)</script> & 'q'` };
    const html = text(okBuild(await buildSite(p, [])), "index.html");
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(2)");
    expect(html.match(/<script/g) ?? []).toHaveLength(0);
  });
  it("adds canonical, og:url and sitemap only when a site address is given, and normalises it to an origin", async () => {
    const without = okBuild(await buildSite(exampleProject, []));
    expect(text(without, "index.html")).not.toContain("canonical");
    expect(without.files["sitemap.xml"]).toBeUndefined();
    expect(text(without, "robots.txt")).not.toContain("Sitemap");

    const withUrl = okBuild(await buildSite(exampleProject, [], { baseUrl: "https://example.com/some/path?x=1#y" }));
    expect(text(withUrl, "index.html")).toContain('<link rel="canonical" href="https://example.com/">');
    expect(text(withUrl, "robots.txt")).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(normalizeBaseUrl("https://example.com/a?b#c")).toBe("https://example.com");
  });
  it("sitemap URLs use clean paths and are XML-escaped", async () => {
    const p = structuredClone(exampleProject);
    p.pages.push({ id: "pg2", name: "A&B", path: "/a-b/", nodes: [] });
    const xml = text(okBuild(await buildSite(p, [], { baseUrl: "https://example.com" })), "sitemap.xml");
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<loc>https://example.com/a-b</loc>");
  });
  it("404 page exists, is not indexed, and escapes the site name", async () => {
    const p = structuredClone(exampleProject);
    p.name = "<b>Bold</b> & co";
    const r = okBuild(await buildSite(p, []));
    const nf = text(r, "404.html");
    expect(nf).toContain('<meta name="robots" content="noindex">');
    expect(nf).not.toContain("<b>Bold</b>");
    expect(nf).toContain("&lt;b&gt;Bold&lt;/b&gt;");
  });
});

describe("determinism", () => {
  it("the same input always produces byte-identical output and the same build hash", async () => {
    const a = okBuild(await buildSite(TEMPLATES[1]!.make(), [], { baseUrl: "https://example.com" }));
    const b = okBuild(await buildSite(TEMPLATES[1]!.make(), [], { baseUrl: "https://example.com" }));
    expect(a.manifest.buildHash).toBe(b.manifest.buildHash);
    for (const f of Object.keys(a.files)) expect(a.files[f]).toEqual(b.files[f]);
  });
  it("any change to the content changes the build hash", async () => {
    const p = structuredClone(exampleProject);
    const a = okBuild(await buildSite(p, []));
    p.pages[0]!.nodes[1]!.children![0]!.props.headline = "Different";
    expect(okBuild(await buildSite(p, [])).manifest.buildHash).not.toBe(a.manifest.buildHash);
  });
  it("does not mutate its input", async () => {
    const p = structuredClone(exampleProject);
    const snapshot = JSON.stringify(p);
    await buildSite(p, [await lib("x")]);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});
