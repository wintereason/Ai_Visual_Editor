import type { Project } from "@avc/schema";
import { esc, pageUrlPath } from "./site";

/**
 * The "installable app" parts of a site (a PWA), for projects whose platform is "mobile" or "web+mobile".
 * It is plain files: a web app manifest, two icons, and a small service worker that lets pages open without a connection.
 * Nothing here is a native iOS/Android app; to put one in an app store, wrap the published site (see docs/mobile.md).
 */
export type AppIcon = { size: 192 | 512; bytes: Uint8Array };

export const REGISTER_SCRIPT = `window.addEventListener("load",function(){if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js")})`;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const color = (c: string | undefined, fallback: string) => (c && HEX6.test(c) ? c : fallback);
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_ICON_BYTES = 1024 * 1024;

export const iconPath = (size: number) => `icons/icon-${size}.png`;
export const isAppProject = (p: Project) => p.platform !== "web";
export const offlineOn = (p: Project) => p.app?.offline !== false;

/** Check an icon from its actual bytes: a real PNG of exactly the size it claims. Returns problems; empty = fine. */
export function verifyIcon(icon: AppIcon): string[] {
  const b = icon.bytes;
  const name = `The ${icon.size}x${icon.size} app icon`;
  if (b.length < 33 || !PNG_SIG.every((v, i) => b[i] === v)) return [`${name} is not a PNG image`];
  if (b.length > MAX_ICON_BYTES) return [`${name} is larger than 1 MB`];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20); // IHDR width and height
  if (w !== icon.size || h !== icon.size) return [`${name} is ${w}x${h}, not ${icon.size}x${icon.size}`];
  return [];
}

export function manifestJson(p: Project, icons: AppIcon[]): string {
  const name = p.name.slice(0, 45);
  const m = {
    name,
    short_name: (p.app?.shortName?.trim() || p.name).slice(0, 12),
    start_url: "/",
    scope: "/",
    display: p.app?.display ?? "standalone",
    theme_color: color(p.app?.themeColor, color(p.theme.colors.primary, "#2563eb")),
    background_color: color(p.app?.backgroundColor, color(p.theme.colors.background, "#ffffff")),
    lang: "en",
    icons: icons.map((i) => ({ src: "/" + iconPath(i.size), sizes: `${i.size}x${i.size}`, type: "image/png", purpose: "any" })),
  };
  return JSON.stringify(m, null, 2) + "\n";
}

/** Extra <head> tags that make a page installable. `registerHash`-matching script is only added when offline use is on. */
export function pwaHead(p: Project, hasIcons: boolean): string {
  const short = esc((p.app?.shortName?.trim() || p.name).slice(0, 12));
  const theme = color(p.app?.themeColor, color(p.theme.colors.primary, "#2563eb"));
  return [
    `<link rel="manifest" href="/manifest.webmanifest">`,
    `<meta name="theme-color" content="${theme}">`,
    `<meta name="mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-title" content="${short}">`,
    ...(hasIcons ? [`<link rel="apple-touch-icon" href="/${iconPath(192)}">`] : []),
    ...(offlineOn(p) ? [`<script>${REGISTER_SCRIPT}</script>`] : []),
  ].join("");
}

/**
 * The service worker. `version` changes whenever any file changes, so visitors always get the new site and old caches are removed.
 * Pages: network first, falling back to what was saved (so the app opens offline). Everything else on the same site: saved copy first.
 * It never touches other websites and never handles anything but GET.
 */
export function serviceWorker(version: string, precache: string[]): string {
  return `/* generated: do not edit */
var C="avc-${version.slice(0, 16)}";var FILES=${JSON.stringify(precache)};
self.addEventListener("install",function(e){e.waitUntil(caches.open(C).then(function(c){return c.addAll(FILES)}).then(function(){return self.skipWaiting()}))});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k.indexOf("avc-")===0&&k!==C}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener("fetch",function(e){var r=e.request;if(r.method!=="GET")return;var u=new URL(r.url);if(u.origin!==location.origin)return;
if(r.mode==="navigate"){e.respondWith(fetch(r).then(function(res){if(res.ok){var cp=res.clone();caches.open(C).then(function(c){c.put(r,cp)})}return res}).catch(function(){return caches.match(r).then(function(m){return m||caches.match("/")})}));return}
e.respondWith(caches.match(r).then(function(m){return m||fetch(r).then(function(res){if(res.ok){var cp=res.clone();caches.open(C).then(function(c){c.put(r,cp)})}return res})}))});
`;
}

/** Which files to save for offline use: the pages, the manifest and icons, and pictures (unless they are so many that saving them all would be heavy). */
export function precacheList(p: Project, files: Record<string, Uint8Array>): string[] {
  const list = new Set<string>(p.pages.map((pg) => pageUrlPath(pg)));
  const assets = Object.keys(files).filter((f) => f.startsWith("assets/"));
  const assetBytes = assets.reduce((n, f) => n + files[f]!.length, 0);
  for (const f of Object.keys(files)) {
    if (f.startsWith("icons/") || f === "manifest.webmanifest") list.add("/" + f);
    else if (f.startsWith("assets/") && assetBytes <= 15 * 1024 * 1024) list.add("/" + f);
  }
  return [...list].sort();
}
