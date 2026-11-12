import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@avc/templates";
import { AnthropicProvider, runEval, withRetry, type CaseResult } from "../src";
import { ALL_CASES } from "./prompts";

// LIVE evaluation against a real model. This spends real money, so it only runs when you ask for it:
//
//   ANTHROPIC_API_KEY=sk-ant-... AI_MODEL=<model id> EVAL_CONFIRM=yes npm run eval -w @avc/ai
//
// Optional:  EVAL_ONLY=edit|injection|element|layout   EVAL_LIMIT=5   PRICE_IN=<usd per million input tokens>
//            PRICE_OUT=<usd per million output tokens>   EVAL_MIN_VALID=0.9  (fail the run below this valid rate)
// Prices are never guessed: copy them from the provider's current pricing page, or leave them out to skip the dollar figure.

const key = process.env.ANTHROPIC_API_KEY;
const model = process.env.AI_MODEL;
const confirmed = process.env.EVAL_CONFIRM === "yes";
const ready = !!key && !!model && confirmed;

if (!ready) {
  console.log("Live evaluation skipped. It needs ANTHROPIC_API_KEY, AI_MODEL and EVAL_CONFIRM=yes (it spends real money).");
}

describe.skipIf(!ready)("live evaluation", () => {
  it("runs the evaluation set and writes a report", async () => {
    let cases = ALL_CASES.filter((c) => !process.env.EVAL_ONLY || c.category === process.env.EVAL_ONLY);
    if (process.env.EVAL_LIMIT) cases = cases.slice(0, Number(process.env.EVAL_LIMIT));
    const price = process.env.PRICE_IN && process.env.PRICE_OUT ? { inputPerMTok: Number(process.env.PRICE_IN), outputPerMTok: Number(process.env.PRICE_OUT) } : undefined;
    console.log(`Running ${cases.length} cases against ${model} ...`);

    let n = 0;
    const base = TEMPLATES.find((t) => t.id === "school")!.make();
    const { results, summary } = await runEval({
      provider: withRetry(new AnthropicProvider({ apiKey: key!, model: model!, timeoutMs: 120_000 })),
      cases: cases as never,
      base,
      newId: () => `ev_${++n}`,
      price,
      onResult: (r: CaseResult) => console.log(`${r.correct ? "PASS" : r.valid ? "WRONG" : "FAIL"}  ${r.id}  (${r.attempts} attempt${r.attempts === 1 ? "" : "s"})${r.failure ? "  " + r.failure : ""}`),
    });

    writeFileSync(new URL("./last-report.json", import.meta.url), JSON.stringify({ model, at: new Date().toISOString(), summary, results }, null, 2));
    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    console.log(`\nvalid ${pct(summary.validRate)} | correct ${pct(summary.correctRate)} | first try ${pct(summary.firstTryRate)} | mean attempts ${summary.meanAttempts.toFixed(2)}`);
    for (const [cat, s] of Object.entries(summary.byCategory)) console.log(`  ${cat.padEnd(10)} n=${s.total}  valid ${pct(s.validRate)}  correct ${pct(s.correctRate)}  attempts ${s.meanAttempts.toFixed(2)}`);
    console.log(`tokens in ${summary.tokens.inputTokens}, out ${summary.tokens.outputTokens}${summary.usd !== undefined ? `, about $${summary.usd.toFixed(3)} total` : ""}`);
    console.log("Report written to packages/ai/evals/last-report.json");

    if (process.env.EVAL_MIN_VALID) expect(summary.validRate).toBeGreaterThanOrEqual(Number(process.env.EVAL_MIN_VALID));
  }, 40 * 60_000);
});
