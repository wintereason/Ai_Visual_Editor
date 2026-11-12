import { ProviderError, type ChatMessage, type ContentPart, type ModelProvider, type Usage } from "./provider";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type LoopResult<T> =
  | { ok: true; value: T; attempts: number; usage: Usage }
  | { ok: false; reason: "invalid" | "provider" | "truncated"; message: string; attempts: number; usage: Usage; providerKind?: string };

/** What the loop is doing right now, for live progress in the UI. Carries no model output or user content. */
export type Progress =
  | { stage: "asking"; attempt: number; of: number }
  | { stage: "checking"; attempt: number; of: number }
  | { stage: "fixing"; attempt: number; of: number };

const SHOW = 700;

/** Feedback for the model: concrete, bounded, and never echoing more than it needs to. */
const feedback = (error: string) =>
  `Your previous answer was rejected:\n${error.slice(0, SHOW)}\nReturn the corrected answer as a single JSON object only.`;

/**
 * The shared loop behind every agent (spec 10.2 rule 3): ask, validate with plain code, and on failure send the
 * validator's errors back for another try, up to `maxAttempts`. Token usage is summed across ALL attempts, so cost
 * accounting reflects what was really spent. Provider failures stop the loop immediately (they are not the model's fault
 * and retrying the same request is the provider wrapper's job).
 */
export async function generateValidated<T>(opts: {
  provider: ModelProvider;
  system: string;
  /** The request: plain text, or text plus images. */
  user: string | ContentPart[];
  parse: (text: string) => Parsed<T>;
  maxAttempts?: number;
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}): Promise<LoopResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const messages: ChatMessage[] = [{ role: "user", content: opts.user }];
  let truncatedLast = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) return { ok: false, reason: "provider", message: "Cancelled.", attempts: attempt - 1, usage };
    const say = (stage: Progress["stage"]) => { try { opts.onProgress?.({ stage, attempt, of: maxAttempts }); } catch { /* a broken listener must never break generation */ } };
    say(attempt === 1 ? "asking" : "fixing");
    let res;
    try {
      res = await opts.provider.complete({ system: opts.system, messages, maxTokens: opts.maxTokens, temperature: opts.temperature, signal: opts.signal });
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      return {
        ok: false, reason: "provider", attempts: attempt, usage,
        providerKind: pe?.kind,
        message: pe?.message ?? "The AI service had a problem. Please try again.", // never a raw error
      };
    }
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;

    say("checking");
    truncatedLast = res.stop === "length";
    const parsed = truncatedLast ? ({ ok: false, error: "The reply was cut off before it finished. Make it shorter and reply with complete JSON." } as const) : opts.parse(res.text);
    if (parsed.ok) return { ok: true, value: parsed.value, attempts: attempt, usage };

    messages.push({ role: "assistant", content: res.text.slice(0, 4000) }, { role: "user", content: feedback(parsed.error) });
  }
  return {
    ok: false, reason: truncatedLast ? "truncated" : "invalid", attempts: maxAttempts, usage,
    message: truncatedLast ? "The AI's answer was too long to finish. Try a smaller request." : "The AI could not produce a change that fits this page. Try rephrasing, or edit it manually.",
  };
}
