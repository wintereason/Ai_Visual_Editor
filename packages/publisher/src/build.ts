import { collectAssetIds, lintProject, validateProject, type Project } from "@avc/schema";
import { ANIM_SCRIPT, formScript, renderDocument, type FormsConfig } from "@avc/renderer";
import { publicAssetPath, verifyAsset, type LibraryAsset } from "./assets";
import { sha256Base64, sha256Hex } from "./hash";
import { buildCsp, headersFile, normalizeBaseUrl, notFoundPage, pageFile, pageHead, robotsTxt, sitemapXml } from "./site";
import { REGISTER_SCRIPT, iconPath, isAppProject, manifestJson, offlineOn, precacheList, pwaHead, serviceWorker, verifyIcon, type AppIcon } from "./pwa";

export type BuildOptions = {
  /** Public address of the site, e.g. "https://school.example.com". Enables canonical links, Open Graph URLs and sitemap.xml. */
  baseUrl?: string;
  /**
   * Connect contact forms so visitors' messages are delivered. Without this, forms on the site do nothing useful and the build says so.
   * supabaseUrl: the project URL; anonKey: the PUBLIC anon key (a service-role key is refused); siteSlug: this site's slug in public.sites.
   */
  forms?: { supabaseUrl: string; anonKey: string; siteSlug: string };
  /** Cloudflare Web Analytics: the site token (32 hex characters, from the Web Analytics page). Opt-in; adds the cookie-less beacon and allows its hosts in the CSP. */
  analytics?: { token: string };
  /**
   * For projects whose platform is "mobile" or "web+mobile": the app icons (PNG, exactly 192x192 and 512x512), made by the editor.
   * Without them the site still works as an app but browsers may not offer to install it, and the build says so.
   */
  app?: { icons?: AppIcon[] };
};

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/; // same rule as public.sites.slug
const KEY = /^[A-Za-z0-9._-]{20,2048}$/;

/** A JWT whose payload says it is a service-role key. These must never be written into files served to visitors. */
function isServiceRoleKey(key: string): boolean {
  const parts = key.split(".");
  if (parts.length !== 3) return /service/i.test(key) || key.startsWith("sb_secret_");
  try { return JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role"; } catch { return false; }
}

export type Manifest = {
  pages: { id: string; path: string; file: string }[];
  assets: { id: string; file: string; bytes: number; hash: string }[];
  warnings: string[];
  totalBytes: number;
  /** Fingerprint of every file in the build; identical input always gives the identical value. */
  buildHash: string;
};

export type BuildResult =
  | { ok: true; files: Record<string, Uint8Array>; manifest: Manifest }
  | { ok: false; errors: string[] };

const enc = new TextEncoder();

/**
 * Turn a project plus its media library into the exact set of files to host.
 * Pure and deterministic; runs identically in the browser (export) and on a server (publish).
 * Refuses to build unless the project is valid, free of pre-publish errors, and every image is verified from its bytes.
 */
export async function buildSite(project: unknown, library: LibraryAsset[], opts: BuildOptions = {}): Promise<BuildResult> {
  // 1. Full registry validation: this is the check the database cannot do (see docs/backend.md).
  const v = validateProject(project);
  if (!v.ok) return { ok: false, errors: v.issues.slice(0, 20).map((i) => `${i.path || "project"}: ${i.message}`) };
  const proj: Project = v.project;

  let origin: string | null = null;
  if (opts.baseUrl !== undefined && opts.baseUrl.trim() !== "") {
    origin = normalizeBaseUrl(opts.baseUrl);
    if (!origin) return { ok: false, errors: ["The site address must be a full https address, like https://example.com"] };
  }

  let forms: FormsConfig | null = null;
  let connectOrigin: string | undefined;
  if (opts.forms) {
    const url = normalizeBaseUrl(opts.forms.supabaseUrl);
    if (!url) return { ok: false, errors: ["The forms backend address must be a full https address."] };
    if (!KEY.test(opts.forms.anonKey)) return { ok: false, errors: ["The forms key doesn't look like a Supabase public (anon) key."] };
    if (isServiceRoleKey(opts.forms.anonKey)) return { ok: false, errors: ["That is a service-role (secret) key. Only the public anon key may go into a published site."] };
    if (!SLUG.test(opts.forms.siteSlug)) return { ok: false, errors: ["The site slug must be 3 to 40 lowercase letters, digits or hyphens."] };
    connectOrigin = url;
    forms = { endpoint: url + "/rest/v1/rpc/submit_form", key: opts.forms.anonKey, slug: opts.forms.siteSlug };
  }

  if (opts.analytics && !/^[a-f0-9]{32}$/.test(opts.analytics.token)) return { ok: false, errors: ["The analytics token must be 32 letters and numbers (a to f), copied from Cloudflare Web Analytics."] };
  const analyticsToken = opts.analytics?.token;

  // 2. Pre-publish lint: errors block, warnings are reported.
  const byId = new Map(library.map((l) => [l.asset.id, l]));
  const issues = lintProject(proj, { assetIds: new Set(byId.keys()) });
  const lintErrors = issues.filter((i) => i.severity === "error").map((i) => i.message);
  if (lintErrors.length) return { ok: false, errors: lintErrors };
  const warnings = issues.filter((i) => i.severity === "warning").map((i) => i.message);
  if (!forms && proj.pages.some((p) => JSON.stringify(p.nodes).includes('"type":"contactForm"'))) warnings.push("This site has a contact form, but form delivery isn't connected, so visitors' messages will not be received.");

  // The installable-app parts (manifest, icons, offline worker) apply to mobile and web+mobile projects.
  const app = isAppProject(proj);
  const offline = app && offlineOn(proj);
  const icons: AppIcon[] = app ? (opts.app?.icons ?? []) : [];
  if (app) {
    const iconErrors = icons.flatMap(verifyIcon);
    if (iconErrors.length) return { ok: false, errors: iconErrors };
    if (new Set(icons.map((i) => i.size)).size !== icons.length) return { ok: false, errors: ["Each app icon size can only be given once."] };
    if (!icons.some((i) => i.size === 192) || !icons.some((i) => i.size === 512)) warnings.push("This app has no 192x192 and 512x512 icon, so browsers may not offer to install it. Set an app icon in Project settings.");
  }

  // 3. Verify every image that will be published, from its bytes.
  const used = [...collectAssetIds(proj)].sort();
  const files: Record<string, Uint8Array> = {};
  const assetErrors: string[] = [];
  const manifestAssets: Manifest["assets"] = [];
  const pathToHash = new Map<string, string>();
  for (const id of used) {
    const lib = byId.get(id)!;
    const problems = await verifyAsset(lib);
    if (problems.length) {
      assetErrors.push(...problems);
      continue;
    }
    const file = publicAssetPath(lib.asset);
    const prior = pathToHash.get(file);
    if (prior && prior !== lib.asset.hash) {
      assetErrors.push(`Two different images would be published at ${file}`); // 12-hex-char prefix collision
      continue;
    }
    pathToHash.set(file, lib.asset.hash);
    files[file] = lib.bytes;
    manifestAssets.push({ id, file, bytes: lib.bytes.length, hash: lib.asset.hash });
  }
  if (assetErrors.length) return { ok: false, errors: assetErrors };

  const assetUrl = (id: string) => {
    const lib = byId.get(id);
    return lib && pathToHash.has(publicAssetPath(lib.asset)) ? `/${publicAssetPath(lib.asset)}` : undefined;
  };

  // 4. Pages, with SEO tags and a hash-based CSP (the only inline script allowed is the platform's own).
  const scriptHash = await sha256Base64(ANIM_SCRIPT);
  const hashes = [scriptHash, ...(forms ? [await sha256Base64(formScript(forms))] : []), ...(offline ? [await sha256Base64(REGISTER_SCRIPT)] : [])];
  // The offline worker reads this site's own files, so it needs 'self' (and nothing else) to connect to.
  const csp = { connect: [...(connectOrigin ? [connectOrigin] : []), ...(analyticsToken || offline ? ["'self'"] : []), ...(analyticsToken ? ["https://cloudflareinsights.com"] : [])], scriptHosts: analyticsToken ? ["https://static.cloudflareinsights.com"] : [], app };
  const metaCsp = buildCsp(hashes, "meta", csp);
  const headerCsp = buildCsp(hashes, "header", csp);
  const pages: Manifest["pages"] = [];
  for (const page of proj.pages) {
    const file = pageFile(page.path);
    files[file] = enc.encode(renderDocument(proj, page.id, { assetUrl, forms: forms ?? undefined, analyticsToken, head: pageHead(proj, page, metaCsp, origin) + (app ? pwaHead(proj, icons.length > 0) : "") }));
    pages.push({ id: page.id, path: page.path, file });
  }

  // 5. Site-level files.
  files["404.html"] = enc.encode(notFoundPage(proj, metaCsp));
  files["_headers"] = enc.encode(headersFile(headerCsp, { app }));
  if (app) {
    files["manifest.webmanifest"] = enc.encode(manifestJson(proj, icons));
    for (const ic of icons) files[iconPath(ic.size)] = ic.bytes;
    if (offline) {
      // The worker's version is a fingerprint of everything else, so any change to the site replaces the saved copies.
      const names0 = Object.keys(files).sort();
      const parts0: string[] = [];
      for (const n of names0) parts0.push(`${n}:${await sha256Hex(files[n]!)}`);
      const version = await sha256Hex(enc.encode(parts0.join("\n")));
      files["sw.js"] = enc.encode(serviceWorker(version, precacheList(proj, files)));
    }
  }
  files["robots.txt"] = enc.encode(robotsTxt(origin));
  if (origin) files["sitemap.xml"] = enc.encode(sitemapXml(proj, origin));

  // 6. Reproducible fingerprint over names + contents, in sorted order.
  const names = Object.keys(files).sort();
  const parts: string[] = [];
  for (const n of names) parts.push(`${n}:${await sha256Hex(files[n]!)}`);
  const buildHash = await sha256Hex(enc.encode(parts.join("\n")));

  return {
    ok: true,
    files,
    manifest: {
      pages,
      assets: manifestAssets,
      warnings,
      totalBytes: names.reduce((n, k) => n + files[k]!.length, 0),
      buildHash,
    },
  };
}
