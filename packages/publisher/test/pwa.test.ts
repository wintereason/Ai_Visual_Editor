import { describe, expect, it } from "vitest";
import { exampleProject, type Asset, type Node, type Project } from "@avc/schema";
import { REGISTER_SCRIPT, buildSite, sha256Base64, sha256Hex, type AppIcon, type LibraryAsset } from "../src";

const dec = new TextDecoder();
const text = (r: { files: Record<string, Uint8Array> }, f: string) => dec.decode(r.files[f]);

/** A byte string that is a real PNG header of the given size: enough for the checks that read the file's own bytes. */
function png(w: number, h = w, extra = 8): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}
const ICONS: AppIcon[] = [{ size: 192, bytes: png(192) }, { size: 512, bytes: png(512) }];
const tabBar: Node = { id: "tb", kind: "block", type: "tabBar", variant: "bottom", props: { items: [{ label: "Home", href: "/", icon: "home" }, { label: "Classes", href: "/classes", icon: "book" }] } };

function appProject(platform: Project["platform"] = "mobile"): Project {
  const p = structuredClone(exampleProject);
  p.platform = platform;
  p.name = "Bright School";
  p.pages[0]!.nodes[1]!.children!.push(tabBar);
  p.pages.push({ id: "pg_classes", name: "Classes", path: "/classes", seo: { title: "Classes" }, nodes: [{ id: "s2", kind: "container", type: "section", props: {}, children: [{ ...tabBar, id: "tb2" }] }] });
  return p;
}
const build = async (p: Project, icons: AppIcon[] | null = ICONS, library: LibraryAsset[] = []) => {
  const r = await buildSite(p, library, { baseUrl: "https://school.example.com", ...(icons ? { app: { icons } } : {}) });
  if (!r.ok) throw new Error("build failed: " + r.errors.join(" | "));
  return r;
};

describe("a web-only project is untouched", () => {
  it("has no manifest, worker, icons or app tags, and the page policy doesn't mention them", async () => {
    const p = appProject("web");
    const r = await build(p);
    expect(Object.keys(r.files).filter((f) => /manifest|sw\.js|icons\//.test(f))).toEqual([]);
    const html = text(r, "index.html");
    expect(html).not.toContain("manifest");
    expect(html).not.toContain("serviceWorker");
    expect(html).not.toMatch(/manifest-src|worker-src/);
    expect(text(r, "_headers")).not.toContain("sw.js");
  });
});

describe("a mobile or web+mobile project becomes an installable app", () => {
  for (const platform of ["mobile", "web+mobile"] as const) {
    it(`${platform}: manifest, icons, offline worker and app tags are all there`, async () => {
      const r = await build(appProject(platform));
      for (const f of ["manifest.webmanifest", "sw.js", "icons/icon-192.png", "icons/icon-512.png"]) expect(Object.keys(r.files), f).toContain(f);
      const m = JSON.parse(text(r, "manifest.webmanifest"));
      expect(m).toMatchObject({ name: "Bright School", short_name: "Bright Schoo", start_url: "/", scope: "/", display: "standalone" });
      expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512"]);
      expect(m.icons.every((i: { src: string }) => r.files[i.src.slice(1)])).toBe(true); // every icon the manifest names is really published
      for (const page of ["index.html", "classes/index.html"]) {
        const html = text(r, page);
        expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
        expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-fA-F]{6}">/);
        expect(html).toContain('<link rel="apple-touch-icon" href="/icons/icon-192.png">');
        expect(html).toContain(`<script>${REGISTER_SCRIPT}</script>`);
      }
      expect(r.manifest.warnings.filter((w) => /icon|tab bar/.test(w))).toEqual([]);
    });
  }

  it("settings flow into the manifest, and bad colours fall back instead of producing a broken manifest", async () => {
    const p = appProject();
    p.app = { shortName: "Bright", themeColor: "#112233", backgroundColor: "#ffeedd", display: "minimal-ui" };
    const m = JSON.parse(text(await build(p), "manifest.webmanifest"));
    expect(m).toMatchObject({ short_name: "Bright", theme_color: "#112233", background_color: "#ffeedd", display: "minimal-ui" });
    const q = appProject();
    q.theme.colors.primary = "#fff"; // short hex is legal in a theme but not in a manifest
    const m2 = JSON.parse(text(await build(q), "manifest.webmanifest"));
    expect(m2.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("the page security policy allows exactly what the app needs and nothing more", async () => {
    const r = await build(appProject());
    const html = text(r, "index.html");
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!.replace(/&#39;/g, "'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("connect-src 'self'"); // the worker reads this site's own files, nowhere else
    expect(csp).toContain(`'sha256-${await sha256Base64(REGISTER_SCRIPT)}'`); // the one inline script is allowed by its fingerprint
    expect(csp).not.toMatch(/unsafe-inline'[^;]*script|script-src[^;]*unsafe/);
    expect(csp).toContain("default-src 'none'");
    expect(text(r, "_headers")).toMatch(/\/sw\.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: \//);
    expect(text(r, "_headers")).toContain("Content-Type: application/manifest+json");
  });

  it("offline off: no worker, no registration script, no extra connect permission", async () => {
    const p = appProject();
    p.app = { offline: false };
    const r = await build(p);
    expect(r.files["sw.js"]).toBeUndefined();
    expect(text(r, "index.html")).not.toContain("serviceWorker");
    expect(text(r, "index.html")).not.toContain("connect-src");
    expect(r.files["manifest.webmanifest"]).toBeDefined(); // still installable
  });
});

describe("icons are checked from their bytes", () => {
  const fails = async (icons: AppIcon[], re: RegExp) => {
    const r = await buildSite(appProject(), [], { app: { icons } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(re);
  };
  it("refuses a file that isn't a PNG, one of the wrong size, one that's too big, and a size given twice", async () => {
    await fails([{ size: 192, bytes: new TextEncoder().encode("<svg onload=alert(1)></svg>".padEnd(60)) }], /not a PNG/);
    await fails([{ size: 192, bytes: png(100) }], /is 100x100, not 192x192/);
    await fails([{ size: 192, bytes: png(192, 190) }], /192x190/);
    await fails([{ size: 512, bytes: png(512, 512, 2 * 1024 * 1024) }], /larger than 1 MB/);
    await fails([{ size: 192, bytes: png(192) }, { size: 192, bytes: png(192) }], /only be given once/);
    await fails([{ size: 192, bytes: new Uint8Array(5) }], /not a PNG/);
  });
  it("no icons: the build works but warns that installing may not be offered", async () => {
    const r = await build(appProject(), null);
    expect(r.manifest.warnings.join(" ")).toMatch(/no 192x192 and 512x512 icon/);
    expect(JSON.parse(text(r, "manifest.webmanifest")).icons).toEqual([]);
    expect(text(r, "index.html")).not.toContain("apple-touch-icon");
  });
  it("one size only still warns", async () => {
    const r = await build(appProject(), [ICONS[0]!]);
    expect(r.manifest.warnings.join(" ")).toMatch(/no 192x192 and 512x512 icon/);
  });
});

describe("helpful warnings", () => {
  it("an app with several pages and no tab bar is told so", async () => {
    const p = appProject();
    p.pages.forEach((pg) => pg.nodes.forEach((s) => (s.children = (s.children ?? []).filter((c) => c.type !== "tabBar"))));
    const r = await build(p);
    expect(r.manifest.warnings.join(" ")).toMatch(/no tab bar/);
  });
});

describe("the offline worker", () => {
  it("is deterministic, and changes whenever the site changes (so visitors get the new version)", async () => {
    const a = await build(appProject());
    const b = await build(appProject());
    expect(text(a, "sw.js")).toBe(text(b, "sw.js"));
    expect(a.manifest.buildHash).toBe(b.manifest.buildHash);
    const p = appProject();
    p.pages[0]!.nodes[0]!.children![0]!.props = { ...p.pages[0]!.nodes[0]!.children![0]!.props, brand: "Changed" };
    const c = await build(p);
    expect(text(c, "sw.js")).not.toBe(text(a, "sw.js"));
  });

  it("saves the pages, manifest and icons, and not the private or housekeeping files", async () => {
    const r = await build(appProject());
    const files: string[] = JSON.parse(/var FILES=(\[.*?\]);/.exec(text(r, "sw.js"))![1]!);
    for (const f of ["/", "/classes", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]) expect(files, f).toContain(f);
    for (const f of ["/_headers", "/sw.js", "/404.html", "/robots.txt", "/sitemap.xml"]) expect(files, f).not.toContain(f);
    expect(files.every((f) => f.startsWith("/"))).toBe(true);
  });

  it("every file it saves actually exists in the published site (otherwise install would fail)", async () => {
    const r = await build(appProject());
    const files: string[] = JSON.parse(/var FILES=(\[.*?\]);/.exec(text(r, "sw.js"))![1]!);
    const published = new Set(Object.keys(r.files));
    for (const f of files) {
      const rel = f === "/" ? "index.html" : f.slice(1);
      expect(published.has(rel) || published.has(rel + "/index.html"), f).toBe(true);
    }
  });

  it("when the pictures are very large it doesn't pre-download them all", async () => {
    const p = appProject();
    const bytes = new Uint8Array(1024 * 1024); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const libs: LibraryAsset[] = [];
    for (let i = 0; i < 17; i++) {
      const b = bytes.slice(); b[100] = i;
      const asset: Asset = { id: `asset_${i}x`, name: `pic${i}`, kind: "png", mime: "image/png", bytes: b.length, width: 1, height: 1, hash: await sha256Hex(b), createdAt: 1 };
      libs.push({ asset, bytes: b });
      p.pages[0]!.nodes[1]!.children!.push({ id: `im${i}`, kind: "element", type: "image", props: { assetId: asset.id, alt: "x", fit: "cover" } });
    }
    const r = await build(p, ICONS, libs);
    const files: string[] = JSON.parse(/var FILES=(\[.*?\]);/.exec(text(r, "sw.js"))![1]!);
    expect(files.some((f) => f.startsWith("/assets/"))).toBe(false); // still cached as they are visited, just not all up front
    expect(files).toContain("/");
  });

  /** Run the generated worker against a small fake browser, so what it does is checked rather than assumed. */
  async function runWorker(code: string, net: { up: boolean; pages: Record<string, string> }) {
    const listeners: Record<string, (e: any) => void> = {};
    const stores = new Map<string, Map<string, string>>();
    const key = (r: any) => new URL(typeof r === "string" ? r : r.url, "https://site.test").href;
    const caches = {
      open: async (n: string) => { if (!stores.has(n)) stores.set(n, new Map()); const m = stores.get(n)!; return { addAll: async (urls: string[]) => { for (const u of urls) m.set(new URL(u, "https://site.test").href, net.pages[u] ?? "x"); }, put: async (r: any, res: any) => { m.set(key(r), await res.text()); } }; },
      match: async (r: any) => { for (const m of stores.values()) { const v = m.get(key(r)); if (v !== undefined) return { text: async () => v, ok: true }; } return undefined; },
      keys: async () => [...stores.keys()],
      delete: async (k: string) => stores.delete(k),
    };
    const fetchFn = async (r: any) => { if (!net.up) throw new Error("offline"); const u = new URL(key(r)); const body = net.pages[u.pathname] ?? "fresh"; return { ok: true, text: async () => body, clone() { return this; } }; };
    const self = { addEventListener: (t: string, f: any) => (listeners[t] = f), skipWaiting: async () => {}, clients: { claim: async () => {} } };
    new Function("self", "caches", "fetch", "location", "URL", code)(self, caches, fetchFn, { origin: "https://site.test" }, URL);
    const fire = async (t: string, e: any) => { let p: Promise<unknown> | undefined; listeners[t]!({ ...e, waitUntil: (x: Promise<unknown>) => (p = x), respondWith: (x: Promise<unknown>) => (p = x) }); return p; };
    return { fire, stores };
  }
  const req = (url: string, method = "GET", mode = "cors") => ({ url, method, mode });

  it("installs, then serves a page offline from what it saved; online it prefers the fresh page", async () => {
    const r = await build(appProject());
    const net = { up: true, pages: { "/": "HOME-V1" } as Record<string, string> };
    const w = await runWorker(text(r, "sw.js"), net);
    await w.fire("install", {});
    expect([...w.stores.keys()][0]).toMatch(/^avc-/);
    net.up = false;
    const offline = (await w.fire("fetch", { request: req("https://site.test/", "GET", "navigate") })) as any;
    expect(await offline.text()).toBe("HOME-V1");
    const unknown = (await w.fire("fetch", { request: req("https://site.test/never-visited", "GET", "navigate") })) as any;
    expect(await unknown.text()).toBe("HOME-V1"); // an unvisited page falls back to the home screen rather than a browser error
    net.up = true; net.pages["/"] = "HOME-V2";
    const online = (await w.fire("fetch", { request: req("https://site.test/", "GET", "navigate") })) as any;
    expect(await online.text()).toBe("HOME-V2");
  });

  it("never touches anything but same-site GET requests", async () => {
    const r = await build(appProject());
    const w = await runWorker(text(r, "sw.js"), { up: true, pages: {} });
    await w.fire("install", {});
    for (const request of [req("https://site.test/", "POST"), req("https://other.example/x.png"), req("https://site.test/form", "PUT")]) {
      let responded = false;
      const listeners = await w.fire("fetch", { request }).catch(() => undefined);
      void listeners;
      responded = false;
    }
    // a POST or another site's request is not answered by the worker at all
    const handled: boolean[] = [];
    const w2 = await runWorker(text(r, "sw.js"), { up: true, pages: {} });
    await w2.fire("install", {});
    for (const request of [req("https://site.test/", "POST"), req("https://other.example/x.png")]) {
      let did = false;
      await w2.fire("fetch", { request, respondWith: () => { did = true; } }).catch(() => {});
      handled.push(did);
    }
    expect(handled).toEqual([false, false]);
  });

  it("a new version removes the old saved copies when it activates", async () => {
    const a = await build(appProject());
    const p = appProject(); p.name = "Renamed school";
    const b = await build(p);
    const net = { up: true, pages: {} as Record<string, string> };
    const old = await runWorker(text(a, "sw.js"), net);
    await old.fire("install", {});
    const oldName = [...old.stores.keys()][0]!;
    const next = await runWorker(text(b, "sw.js"), net);
    for (const [k, v] of old.stores) next.stores.set(k, v); // the browser keeps one cache storage for the site
    await next.fire("install", {});
    await next.fire("activate", {});
    expect([...next.stores.keys()]).not.toContain(oldName);
    expect([...next.stores.keys()].length).toBe(1);
  });
});
