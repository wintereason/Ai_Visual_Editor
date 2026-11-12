// `next dev` compiles each page and API route the first time it is requested, which can stall whichever test happens to hit it
// first. Visiting them all once up front keeps timing steady for the run. Failures here are ignored: the tests report real problems.
export default async function warmup() {
  const base = "http://localhost:3100";
  const paths: [string, RequestInit][] = [
    ["/", {}],
    ["/api/ai/patch", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
    ["/api/ai/element", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
    ["/api/ai/layout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
    ["/api/ai/build_page", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
    ["/api/account", { method: "DELETE" }],
    ["/api/publish", { method: "POST" }],
    ["/api/billing", {}],
    ["/api/billing/order", { method: "POST" }],
    ["/api/billing/verify", { method: "POST" }],
    ["/api/billing/webhook", { method: "POST" }],
    ["/api/ai/style", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
    ["/terms", {}],
  ];
  for (const [p, init] of paths) {
    try { await fetch(base + p, { ...init, signal: AbortSignal.timeout(90_000) }); } catch { /* ignored on purpose */ }
  }
}
