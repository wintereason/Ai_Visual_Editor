import { EMBED_ORIGINS, type Page, type Project } from "@avc/schema";
import { pageFile, themeCss } from "@avc/renderer";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Content Security Policy for published sites (spec 15.1). Deny by default; allow only what the renderer needs:
 * its own files, https images/media, inline styles (the renderer emits <style> and style attributes), the animation
 * script by hash (so no other inline script can run), and the embed allow-list. No wildcards, no 'unsafe-eval',
 * no 'unsafe-inline' for scripts.
 * `frame-ancestors` is ignored in <meta>, so it is only added for the HTTP header version.
 */
export function buildCsp(scriptHashes: string | string[], target: "header" | "meta", extra: string | { connect?: string[]; scriptHosts?: string[]; app?: boolean } = {}): string {
  const x = typeof extra === "string" ? { connect: [extra] } : extra;
  const hashes = [...(Array.isArray(scriptHashes) ? scriptHashes : [scriptHashes]).map((h) => `'sha256-${h}'`), ...(x.scriptHosts ?? [])].join(" ");
  const frames = [...new Set(Object.values(EMBED_ORIGINS).flat().map((o) => `https://${o.host}`))].sort().join(" ");
  const parts = [
    "default-src 'none'",
    "img-src 'self' https: data:",
    "media-src 'self' https:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${hashes}`,
    // Only when forms are connected: the one origin the form script may send to. Nothing else can be fetched.
    ...(x.connect?.length ? [`connect-src ${[...new Set(x.connect)].join(" ")}`] : []),
    // An installable app: its manifest and offline worker come from this same site, and nowhere else.
    ...(x.app ? ["manifest-src 'self'", "worker-src 'self'"] : []),
    `frame-src ${frames}`,
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ];
  if (target === "header") parts.push("frame-ancestors 'none'");
  return parts.join("; ");
}

/** Normalise a user-supplied site address to its origin. Only https is accepted; paths, queries and credentials are dropped. */
export function normalizeBaseUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Public URL path of a page: "/" or "/courses" (no trailing slash). */
export const pageUrlPath = (p: Page) => (p.path === "/" ? "/" : p.path.replace(/\/+$/, ""));

export function pageHead(project: Project, page: Page, csp: string, origin: string | null): string {
  const title = page.seo?.title ?? page.name;
  const desc = page.seo?.description?.trim();
  const url = origin ? origin + pageUrlPath(page) : null;
  const tags = [
    `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">`,
    `<meta name="referrer" content="strict-origin-when-cross-origin">`,
    ...(desc ? [`<meta name="description" content="${esc(desc)}">`] : []),
    ...(url ? [`<link rel="canonical" href="${esc(url)}">`] : []),
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(project.name)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    ...(desc ? [`<meta property="og:description" content="${esc(desc)}">`] : []),
    ...(url ? [`<meta property="og:url" content="${esc(url)}">`] : []),
    `<meta name="twitter:card" content="summary">`,
  ];
  return tags.join("");
}

export function notFoundPage(project: Project, csp: string): string {
  const home = project.pages.find((p) => p.path === "/");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Page not found | ${esc(project.name)}</title><meta name="robots" content="noindex">` +
    `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">` +
    `<style>${themeCss(project.theme)}main{max-width:560px;margin:15vh auto;padding:0 24px;text-align:center}a{color:var(--c-primary)}</style></head>` +
    `<body><main><h1>Page not found</h1><p>The page you were looking for doesn't exist.</p>` +
    `<p><a href="/">${esc(home?.name ?? "Go to the home page")}</a></p></main></body></html>`
  );
}

export function robotsTxt(origin: string | null): string {
  return `User-agent: *\nAllow: /\n${origin ? `\nSitemap: ${origin}/sitemap.xml\n` : ""}`;
}

export function sitemapXml(project: Project, origin: string): string {
  const urls = project.pages.map((p) => `  <url><loc>${esc(origin + pageUrlPath(p))}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Cloudflare Pages / Netlify style `_headers` file. */
export function headersFile(csp: string, opts: { app?: boolean } = {}): string {
  return [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
    "  Cross-Origin-Opener-Policy: same-origin",
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    ...(opts.app
      ? [
          "/sw.js",
          "  Cache-Control: no-cache",
          "  Service-Worker-Allowed: /",
          "",
          "/manifest.webmanifest",
          "  Content-Type: application/manifest+json",
          "  Cache-Control: no-cache",
          "",
        ]
      : []),
  ].join("\n");
}

export { pageFile };
