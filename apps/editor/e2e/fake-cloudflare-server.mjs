// Runs the strict Cloudflare Pages fake (packages/publisher/test/fake-cloudflare.mjs) as a real HTTP server, for browser tests.
//   /client/v4/...   the API       /s/<deployment>/<path>   a deployed site       /debug   what the fake currently holds
import { createServer } from "node:http";
import { createFakeCloudflare } from "../../../packages/publisher/test/fake-cloudflare.mjs";

const PORT = 3197;
const DELAY = Number(process.env.FAKE_CF_DELAY ?? 400); // slow enough that progress is visible in the UI
const cf = createFakeCloudflare({ siteBase: `http://127.0.0.1:${PORT}`, deployPolls: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/health") { res.end("ok"); return; }
    if (url.pathname === "/debug") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ projects: [...cf.state.projects.keys()], deployments: [...cf.state.deployments.entries()].map(([id, d]) => ({ id, project: d.project, files: Object.keys(d.manifest), wrongKeys: d.wrongKeys, headers: d.files["_headers"] ?? null })), tokenCalls: cf.state.tokenCalls }));
      return;
    }
    if (url.pathname.startsWith("/s/")) {
      const [, , id, ...rest] = url.pathname.split("/");
      const r = cf.site(id, "/" + rest.join("/"));
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (url.pathname.startsWith("/client/v4")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      await sleep(DELAY);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const r = await cf.api(new Request(`http://api.cloudflare.com${url.pathname}${url.search}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body }));
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    res.statusCode = 404;
    res.end();
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
}).listen(PORT, "127.0.0.1", () => console.log("fake cloudflare on " + PORT));
