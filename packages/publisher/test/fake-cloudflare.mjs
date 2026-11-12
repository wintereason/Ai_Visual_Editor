// A stand-in for the parts of Cloudflare Pages' API that a Direct Upload deployment uses. Used by unit tests (through a fake
// fetch) and by the browser tests (through a small HTTP server). It is deliberately STRICT, like the real service:
//   * the account token and the short-lived upload JWT are checked on the endpoints that need them;
//   * uploaded files are stored under the key the client chose, and a deployment's manifest is checked against the content;
//   * a file whose key is WRONG is accepted (the real service accepts it too) but then 404s when the site is served.
import { blake3 } from "@noble/hashes/blake3.js";

const hex16 = (s) => Array.from(blake3(new TextEncoder().encode(s)).subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
const ext = (p) => { const f = p.split("/").pop(); const i = f.lastIndexOf("."); return i > 0 ? f.slice(i + 1).toLowerCase() : ""; };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (result) => json(200, { success: true, errors: [], messages: [], result });
const err = (status, code, message = "error") => json(status, { success: false, errors: [{ code, message }], messages: [], result: null });

export function createFakeCloudflare(opts = {}) {
  const o = { accountId: "a".repeat(32), token: "good-token-0123456789abcdef", siteBase: null, expireJwtAfterUploads: 0, deployPolls: 1, domainActivatePolls: 2, apexNeedsZone: true, ...opts };
  const state = {
    projects: new Map(),     // name -> { subdomain }
    store: new Map(),        // key -> { value (base64), contentType }
    upserted: new Set(),
    deployments: new Map(),  // id -> { project, manifest, files (name->text), polls, wrongKeys }
    domains: new Map(), uploadCalls: 0, uploadedKeys: [], tokenCalls: 0, jwts: new Set(), log: [], seq: 0,
  };
  const record = (m, u) => state.log.push(`${m} ${u}`);

  const apiAuth = (req) => req.headers.get("authorization") === `Bearer ${o.token}`;
  const jwtAuth = (req) => { const a = req.headers.get("authorization") ?? ""; return a.startsWith("Bearer ") && state.jwts.has(a.slice(7)); };

  async function api(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/client\/v4/, "");
    record(req.method, path);

    // ---- JWT endpoints (no account in the path) ----
    if (path.startsWith("/pages/assets/")) {
      if (!jwtAuth(req)) return err(401, 8000013, "invalid jwt");
      if (path === "/pages/assets/check-missing" && req.method === "POST") {
        const { hashes } = await req.json();
        return ok(hashes.filter((h) => !state.store.has(h)));
      }
      if (path === "/pages/assets/upload" && req.method === "POST") {
        state.uploadCalls++;
        if (o.expireJwtAfterUploads && state.uploadCalls === o.expireJwtAfterUploads) { state.jwts.clear(); return err(401, 8000013, "jwt expired"); }
        const items = await req.json();
        if (!Array.isArray(items) || items.length > 1000) return err(400, 8000000, "bad batch");
        for (const it of items) {
          if (!/^[a-f0-9]{32}$/.test(it?.key) || typeof it?.value !== "string" || it?.base64 !== true || typeof it?.metadata?.contentType !== "string") return err(400, 8000000, "bad item");
          state.store.set(it.key, { value: it.value, contentType: it.metadata.contentType });
          state.uploadedKeys.push(it.key);
        }
        return ok(null);
      }
      if (path === "/pages/assets/upsert-hashes" && req.method === "POST") {
        const { hashes } = await req.json();
        for (const h of hashes) state.upserted.add(h);
        return ok(null);
      }
      return err(404, 7000, "no route");
    }

    // ---- account endpoints (API token) ----
    const m = /^\/accounts\/([^/]+)\/pages\/projects(?:\/([^/]+))?(?:\/(upload-token|deployments|domains)(?:\/([^/]+))?)?$/.exec(path);
    if (!m) return err(404, 7000, "no route");
    if (!apiAuth(req)) return err(403, 10000, "Authentication error");
    if (m[1] !== o.accountId) return err(404, 7003, "Could not route");
    const [, , name, sub, depId] = m;

    if (!name) {
      if (req.method !== "POST") return err(405, 7000);
      const b = await req.json();
      if (typeof b.name !== "string" || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(b.name) || b.name.length > 58) return err(400, 8000002, "bad name");
      if (state.projects.has(b.name)) return err(409, 8000002, "exists");
      const p = { name: b.name, subdomain: `${b.name}.pages.dev` };
      state.projects.set(b.name, p);
      return ok(p);
    }
    const project = state.projects.get(name);
    if (!project) return err(404, 8000007, "Project not found");
    if (!sub) return req.method === "GET" ? ok(project) : err(405, 7000);

    if (sub === "upload-token") {
      state.tokenCalls++;
      const jwt = `jwt.${state.tokenCalls}.${"x".repeat(20)}`;
      state.jwts.add(jwt);
      return ok({ jwt });
    }

    if (sub === "domains") {
      if (req.method === "POST" && !depId) {
        const b = await req.json();
        const d = String(b?.name ?? "").toLowerCase();
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return err(400, 8000018, "bad domain");
        if (state.domains.has(d)) return err(409, 8000018, "exists");
        // apex domains must be zones in the account; the fake has no zones, so they are refused unless allowed
        if (o.apexNeedsZone && d.split(".").length === 2) return err(400, 8000019, "apex needs a zone");
        state.domains.set(d, { project: name, polls: 0 });
        return ok({ id: "dom_" + d, name: d, status: "initializing", validation_data: { method: "http", status: "initializing" }, verification_data: { status: "pending" } });
      }
      if (req.method === "GET" && depId) {
        const dom = state.domains.get(depId);
        if (!dom || dom.project !== name) return err(404, 8000007, "no domain");
        dom.polls++;
        const active = dom.polls >= o.domainActivatePolls;
        return ok({ id: "dom_" + depId, name: depId, status: active ? "active" : "pending", validation_data: { method: "http", status: active ? "active" : "pending", error_message: active ? null : "Waiting for the CNAME record" }, verification_data: { status: active ? "active" : "pending" } });
      }
      return err(404, 7000, "no route");
    }

    if (sub === "deployments" && req.method === "POST") {
      const form = await req.formData();
      const manifest = JSON.parse(String(form.get("manifest") ?? "null") ?? "null");
      if (!manifest || typeof manifest !== "object") return err(400, 8000000, "no manifest");
      const wrongKeys = [];
      for (const [p, h] of Object.entries(manifest)) {
        if (!p.startsWith("/")) return err(400, 8000000, "manifest paths need a leading slash");
        if (!state.upserted.has(h) && !state.store.has(h)) return err(400, 8000096, "A file in the manifest was never uploaded");
        const stored = state.store.get(h);
        // The real service doesn't complain about a wrong key; the file just isn't found when serving. Model exactly that.
        if (!stored || hex16(stored.value + ext(p)) !== h) wrongKeys.push(p);
      }
      const files = {};
      for (const special of ["_headers", "_redirects", "_routes.json"]) { const v = form.get(special); if (v && typeof v !== "string") files[special] = await v.text(); }
      const id = `d${(++state.seq).toString().padStart(7, "0")}`;
      state.deployments.set(id, { project: name, manifest, files, polls: 0, wrongKeys });
      const url = o.siteBase ? `${o.siteBase}/s/${id}` : `https://${id}.${name}.pages.dev`;
      return ok({ id, url, project_name: name });
    }
    if (sub === "deployments" && depId && req.method === "GET") {
      const d = state.deployments.get(depId);
      if (!d) return err(404, 8000009, "no deployment");
      d.polls++;
      return ok({ id: depId, latest_stage: d.polls >= o.deployPolls ? { name: "deploy", status: "success" } : { name: "deploy", status: "active" } });
    }
    return err(404, 7000, "no route");
  }

  /** Serve a deployed site: returns a Response like a real Pages site would (404 for missing or wrong-key files). */
  function site(id, path) {
    const d = state.deployments.get(id);
    if (!d) return new Response("no such deployment", { status: 404 });
    let p = path.split("?")[0];
    if (p.endsWith("/")) p += "index.html";
    const h = d.manifest[p] ?? d.manifest[p + "/index.html"];
    const stored = h && state.store.get(h);
    if (!stored || d.wrongKeys.includes(p) || hex16(stored.value + ext(p)) !== h) return new Response("Not found", { status: 404 });
    return new Response(Buffer.from(stored.value, "base64"), { status: 200, headers: { "content-type": stored.contentType, ...(d.files["_headers"] ? { "x-has-headers": "1" } : {}) } });
  }

  /** A fetch() that routes API calls and *.pages.dev (or siteBase) page views to this fake. */
  const fetch = async (input, init = {}) => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    // routed through `self` so a test can replace .api or .site to simulate misbehaviour
    if (u.hostname === "api.cloudflare.com") return self.api(req);
    if (u.hostname.endsWith(".pages.dev")) return self.site(u.hostname.split(".")[0], u.pathname);
    return new Response("unexpected host " + u.hostname, { status: 502 });
  };

  const self = { state, api, site, fetch, options: o };
  return self;
}
