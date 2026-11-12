import { expect, test, type Page, type Route } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const headline = (page: Page) => state<string>(page, "s => s.project.pages[0].nodes[1].children[0].props.headline");
const pastLen = (page: Page) => state<number>(page, "s => s.past.length");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

async function signIn(page: Page, email = "dev@example.com") {
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
}
async function openAi(page: Page) {
  await page.getByRole("tab", { name: "AI" }).click();
}
async function selectHero(page: Page) {
  await frame(page).locator("h1").click();
}
const ask = async (page: Page, text: string) => {
  await page.getByLabel("What should change?").fill(text);
  await page.getByRole("button", { name: "✦ Apply" }).click();
};

type Reply = { status?: number; body?: unknown; raw?: string; delayMs?: number; abort?: boolean };
/** Mock the server's AI endpoint, recording what the browser sends. */
async function mockAi(page: Page, reply: Reply | ((n: number) => Reply)) {
  const seen: { headers: Record<string, string>; body: any; raw: string }[] = [];
  await page.route("**/api/ai/patch", async (route: Route) => {
    const req = route.request();
    seen.push({ headers: req.headers(), body: req.postDataJSON(), raw: req.postData() ?? "" });
    const r = typeof reply === "function" ? reply(seen.length) : reply;
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    if (r.abort) return route.abort();
    await route.fulfill({ status: r.status ?? 200, contentType: r.raw !== undefined ? "text/html" : "application/json", body: r.raw ?? JSON.stringify(r.body) });
  });
  return seen;
}
const okPatch = (ops: unknown[], summary = "Made it friendlier") => ({ status: 200, body: { ok: true, patch: { summary, ops }, summary, touched: ["hero1"], attempts: 1, credits: { charged: true, cost: 1 } } });
const setHeadline = (t: string) => okPatch([{ op: "update", id: "hero1", props: { headline: t } }]);

test.describe("availability", () => {
  test("signed out: explains why, and Apply is unavailable", async ({ page }) => {
    await openAi(page);
    await expect(page.getByTestId("ai-signin")).toBeVisible();
    await selectHero(page);
    await page.getByLabel("What should change?").fill("make it friendlier");
    await expect(page.getByRole("button", { name: "✦ Apply" })).toBeDisabled();
  });
  test("signed in but nothing selected: the box is disabled and says what to do", async ({ page }) => {
    await signIn(page);
    await openAi(page);
    await expect(page.getByLabel("What should change?")).toBeDisabled();
    await expect(page.getByTestId("ai-panel")).toContainText("Select an element");
    await selectHero(page);
    await expect(page.getByLabel("What should change?")).toBeEnabled();
    await expect(page.getByTestId("ai-panel")).toContainText("Changes only the selected");
  });
  test("the length limit is shown and enforced; empty or blank input cannot be sent", async ({ page }) => {
    await signIn(page);
    await selectHero(page);
    await openAi(page);
    const send = page.getByRole("button", { name: "✦ Apply" });
    await page.getByLabel("What should change?").fill("   ");
    await expect(send).toBeDisabled();
    await page.getByLabel("What should change?").fill("a".repeat(1000));
    await expect(page.getByTestId("ai-count")).toHaveText("1000 / 1000");
    await expect(send).toBeEnabled();
    await page.getByLabel("What should change?").fill("a".repeat(1001));
    await expect(send).toBeDisabled();
  });
  test("suggestions fill the box and Ctrl+Enter sends", async ({ page }) => {
    await signIn(page);
    await selectHero(page);
    await openAi(page);
    const seen = await mockAi(page, setHeadline("Bold and clear"));
    await page.getByRole("button", { name: "Make it bolder" }).click();
    await expect(page.getByLabel("What should change?")).toHaveValue("Make it bolder");
    await page.getByLabel("What should change?").press("Control+Enter");
    await expect(page.getByTestId("ai-done")).toBeVisible();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body.instruction).toBe("Make it bolder");
  });
});

test.describe("a successful request", () => {
  test("sends only what it should, applies the patch, shows the result, and Undo restores everything", async ({ page }) => {
    await signIn(page);
    // a second page with private text that must never leave the browser for a request about the hero
    await page.evaluate(() => (window as any).__editor.getState().commit({ summary: "x", ops: [{ op: "addPage", page: { id: "page_priv", name: "Private", path: "/private", nodes: [{ id: "sp", kind: "container", type: "section", props: {}, children: [{ id: "tp", kind: "element", type: "text", props: { text: "SECRET-OTHER-PAGE-TEXT" } }] }] } }] }));
    await selectHero(page);
    await openAi(page);
    const seen = await mockAi(page, setHeadline("Welcome, we're glad you're here"));
    const before = await pastLen(page);
    await ask(page, "  make the headline friendlier  ");

    await expect(page.getByTestId("ai-done")).toContainText("Made it friendlier");
    await expect(page.getByTestId("ai-done")).toContainText("Changed 1 element · 1 credit used");
    await expect(frame(page).locator("h1")).toHaveText("Welcome, we're glad you're here");
    expect(await pastLen(page)).toBe(before + 1); // one undoable step

    // what was sent
    expect(seen).toHaveLength(1);
    const { headers, body, raw } = seen[0]!;
    expect(headers.authorization).toMatch(/^Bearer mock\./);
    expect(body.nodeId).toBe("hero1");
    expect(body.instruction).toBe("make the headline friendlier"); // trimmed
    expect(body.idempotencyKey).toMatch(/^ui-[0-9a-f-]{36}$/);
    expect(body.project.pages).toHaveLength(1); // only the page being edited
    expect(raw).not.toContain("SECRET-OTHER-PAGE-TEXT");
    expect(Object.keys(body).sort()).toEqual(["idempotencyKey", "instruction", "nodeId", "project"]);

    await page.getByTestId("ai-done").getByRole("button", { name: "Undo" }).click();
    expect(await headline(page)).toBe("Learn skills that get you hired");
    await expect(page.getByTestId("ai-done")).toHaveCount(0);
  });

  test("each request gets its own idempotency key", async ({ page }) => {
    await signIn(page);
    await selectHero(page);
    await openAi(page);
    const seen = await mockAi(page, (n) => setHeadline(`Version ${n}`));
    await ask(page, "first");
    await expect(page.getByTestId("ai-done")).toBeVisible();
    await ask(page, "second");
    await expect.poll(() => seen.length).toBe(2);
    expect(seen[0]!.body.idempotencyKey).not.toBe(seen[1]!.body.idempotencyKey);
  });

  test("'Keep' dismisses the card; Undo disappears once anything else changes", async ({ page }) => {
    await signIn(page);
    await selectHero(page);
    await openAi(page);
    await mockAi(page, setHeadline("Kept"));
    await ask(page, "change it");
    await expect(page.getByTestId("ai-done").getByRole("button", { name: "Undo" })).toBeVisible();
    await page.getByRole("button", { name: "Heading" }).click(); // an unrelated edit made afterwards
    await page.getByRole("tab", { name: "AI" }).click();
    await expect(page.getByTestId("ai-done").getByRole("button", { name: "Undo" })).toHaveCount(0); // Undo would undo the wrong thing
    await page.getByTestId("ai-done").getByRole("button", { name: "Keep" }).click();
    await expect(page.getByTestId("ai-done")).toHaveCount(0);
  });

  test("works on a different kind of node (a heading element), with styles and animation", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Heading" }).click();
    await openAi(page);
    const id = await state<string>(page, "s => s.selection");
    await page.route("**/api/ai/patch", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, summary: "Centered with a fade", touched: [id], attempts: 1, patch: { summary: "Centered with a fade", ops: [{ op: "update", id, styles: { base: { normal: { textAlign: "center" } } }, animation: { preset: "fade-in", trigger: "scroll" } }] }, credits: { charged: true, cost: 1 } }) }));
    await ask(page, "center it and fade it in");
    await expect(page.getByTestId("ai-done")).toBeVisible();
    await expect(frame(page).locator(`[data-node="${id}"]`)).toHaveAttribute("data-anim", "fade-in");
  });
});

test.describe("when the server says no (nothing changes, nothing is recorded)", () => {
  const cases: [string, Reply, RegExp][] = [
    ["401 unauthorized", { status: 401, body: { ok: false, code: "unauthorized", message: "Sign in to use AI." } }, /Sign in to use AI/],
    ["402 out of credits", { status: 402, body: { ok: false, code: "insufficient_credits", message: "You're out of AI credits.", available: 0 } }, /out of AI credits/],
    ["429 daily limit", { status: 429, body: { ok: false, code: "daily_cap", message: "You've reached today's AI limit. It resets tomorrow." } }, /today's AI limit/],
    ["503 provider down", { status: 503, body: { ok: false, code: "provider", message: "The AI service is temporarily unavailable. Please try again." } }, /temporarily unavailable/],
    ["422 could not do it", { status: 422, body: { ok: false, code: "invalid", message: "The AI could not produce a change that fits this page. Try rephrasing, or edit it manually." } }, /Try rephrasing/],
    ["503 not configured", { status: 503, body: { ok: false, code: "not_configured", message: "AI features are not set up on this server yet." } }, /not set up/],
    ["a proxy error page instead of JSON", { status: 502, raw: "<html><body>Bad gateway</body></html>" }, /temporarily unavailable|didn't work/],
    ["a 500 with an absurdly long message", { status: 500, body: { ok: false, message: "x".repeat(5000) } }, /didn't work/],
  ];
  for (const [name, reply, message] of cases) {
    test(name, async ({ page }) => {
      await signIn(page);
      await selectHero(page);
      await openAi(page);
      await mockAi(page, reply);
      const before = await pastLen(page);
      await ask(page, "make it friendlier");
      await expect(page.getByTestId("ai-error")).toContainText(message);
      expect(await headline(page)).toBe("Learn skills that get you hired");
      expect(await pastLen(page)).toBe(before);
      await expect(page.getByRole("button", { name: "✦ Apply" })).toBeEnabled(); // can try again
      await expect(page.getByLabel("What should change?")).toHaveValue("make it friendlier"); // the text is kept
    });
  }
  test("a network failure is explained, not a crash", async ({ page }) => {
    await signIn(page);
    await selectHero(page);
    await openAi(page);
    await mockAi(page, { abort: true });
    await ask(page, "make it friendlier");
    await expect(page.getByTestId("ai-error")).toContainText("Couldn't reach the server");
  });
});

test.describe("the browser does not trust the server's patch", () => {
  const hostile: [string, Reply][] = [
    ["a patch that edits a different element", okPatch([{ op: "update", id: "feat1", props: { title: "hijacked" } }])],
    ["a patch that deletes the footer", okPatch([{ op: "remove", id: "sec_footer" }])],
    ["a patch that deletes the selected element", okPatch([{ op: "remove", id: "hero1" }])],
    ["a patch that changes the theme", okPatch([{ op: "setTheme", theme: { colors: { primary: "#000000" } } }])],
    ["a patch that adds or removes pages", okPatch([{ op: "removePage", id: "page_home" }])],
    ["a patch with an unsafe link", okPatch([{ op: "update", id: "hero1", props: { ctaHref: "javascript:alert(1)" } }])],
    ["a patch with an unknown style key", okPatch([{ op: "update", id: "hero1", styles: { base: { normal: { zIndex: 99999 } } } }])],
    ["a patch with more than 20 operations", okPatch(Array.from({ length: 21 }, () => ({ op: "update", id: "hero1", props: { headline: "a" } })))],
    ["a patch with no operations", okPatch([])],
    ["success with no patch at all", { status: 200, body: { ok: true, summary: "x", touched: [] } }],
    ["a patch that is not an object", { status: 200, body: { ok: true, patch: "delete everything", summary: "x", touched: [] } }],
  ];
  for (const [name, reply] of hostile) {
    test(`${name} is refused locally and changes nothing`, async ({ page }) => {
      await signIn(page);
      await selectHero(page);
      await openAi(page);
      await mockAi(page, reply);
      const before = JSON.stringify(await state(page, "s => s.project"));
      const past = await pastLen(page);
      await ask(page, "make it friendlier");
      await expect(page.getByTestId("ai-error")).toContainText("couldn't apply that change safely");
      expect(JSON.stringify(await state(page, "s => s.project"))).toBe(before);
      expect(await pastLen(page)).toBe(past);
      await expect(page.getByTestId("ai-done")).toHaveCount(0);
    });
  }
});

test.describe("running state", () => {
  test("while a request runs: the button shows Working…, input is locked, and a double click sends one request", async ({ page }) => {
    await signIn(page);
    await selectHero(page);
    await openAi(page);
    const seen = await mockAi(page, { ...setHeadline("Slow answer"), delayMs: 600 });
    await page.getByLabel("What should change?").fill("make it friendlier");
    const send = page.getByRole("button", { name: "✦ Apply" });
    await send.dblclick();
    await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
    await expect(page.getByLabel("What should change?")).toBeDisabled();
    await expect(page.getByTestId("ai-done")).toBeVisible();
    expect(seen).toHaveLength(1);
  });
  test("Cancel aborts quietly: no error, no change, and it can be used again", async ({ page }) => {
    await signIn(page);
    await selectHero(page);
    await openAi(page);
    await mockAi(page, { ...setHeadline("Never applied"), delayMs: 3000 });
    const before = await pastLen(page);
    await ask(page, "make it friendlier");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "✦ Apply" })).toBeEnabled();
    await expect(page.getByTestId("ai-error")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await headline(page)).toBe("Learn skills that get you hired");
    expect(await pastLen(page)).toBe(before);
  });
});

test.describe("the real server route (a fake model is configured in the test environment)", () => {
  test("a request without a sign-in is refused, as plain JSON or as a stream, before anything else happens", async ({ request }) => {
    const plain = await request.post("/api/ai/patch", { data: { a: 1 }, headers: { "content-type": "application/json" } });
    expect(plain.status()).toBe(401);
    expect(await plain.json()).toMatchObject({ ok: false, code: "unauthorized" });
    const streamed = await request.post("/api/ai/patch", { data: { a: 1 }, headers: { "content-type": "application/json", accept: "application/x-ndjson" } });
    expect(streamed.headers()["content-type"]).toContain("application/x-ndjson");
    const lines = (await streamed.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines).toEqual([{ type: "result", status: 401, body: expect.objectContaining({ code: "unauthorized" }) }]);
  });
  test("a signed-in stream carries progress lines and ends with one result; secrets never appear", async ({ request }) => {
    const res = await request.post("/api/ai/layout", { data: { brief: { prompt: "a school site" } }, headers: { "content-type": "application/json", accept: "application/x-ndjson", authorization: "Bearer mock.streamtest1" } });
    const text = await res.text();
    const lines = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.slice(0, -1).every((l) => l.type === "progress")).toBe(true);
    expect(lines.slice(0, -1).map((l) => l.stage)).toEqual(["asking", "checking"]);
    expect(lines[lines.length - 1]).toMatchObject({ type: "result", status: 200, body: { ok: true } });
    expect(text).not.toMatch(/test-key|fake-model|ANTHROPIC/);
  });
  test("answers JSON, refuses GET, 404s unknown actions, and never reveals configuration", async ({ request }) => {
    const post = await request.post("/api/ai/patch", { data: { a: 1 }, headers: { "content-type": "application/json" } });
    expect(post.status()).toBe(401);
    expect(post.headers()["cache-control"]).toBe("no-store");
    const get = await request.get("/api/ai/patch");
    expect(get.status()).toBe(405);
    expect(get.headers().allow).toBe("POST");
    const unknown = await request.post("/api/ai/exploit", { data: {}, headers: { "content-type": "application/json" } });
    expect(unknown.status()).toBe(404);
    for (const r of [post, get, unknown]) {
      const text = await r.text();
      expect(text).not.toMatch(/sk-ant|test-key|service_role|ANTHROPIC|SUPABASE|stack|node_modules/i);
    }
  });
});
