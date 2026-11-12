import { estimateTokens, messageText, messageTokens, ProviderError, type CompletionRequest, type CompletionResult, type ModelProvider } from "./provider";

// ---------------------------------------------------------------------------------------------------------------------
// Scripted provider: deterministic, offline. Used by every test and by the evaluation harness's self-test.
// ---------------------------------------------------------------------------------------------------------------------

export type ScriptStep = string | ProviderError | ((req: CompletionRequest, call: number) => string | ProviderError);

export class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  readonly requests: CompletionRequest[] = [];
  private i = 0;
  constructor(private readonly steps: ScriptStep[] | ((req: CompletionRequest, call: number) => string | ProviderError)) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // Snapshot, like a real provider serializing the request: callers keep appending to their own messages array.
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    const call = this.i++;
    const step = Array.isArray(this.steps) ? this.steps[Math.min(call, this.steps.length - 1)] : this.steps;
    if (step === undefined) throw new ProviderError("invalid_response", "The scripted provider has no steps.");
    const out = typeof step === "function" ? step(req, call) : step;
    if (out instanceof ProviderError) throw out;
    return {
      text: out,
      model: "scripted",
      stop: "end",
      usage: { inputTokens: estimateTokens(req.system) + req.messages.reduce((n, m) => n + messageTokens(m), 0), outputTokens: estimateTokens(out) },
    };
  }
  get calls() {
    return this.requests.length;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Claude provider (Anthropic Messages API). Written to the documented API; it has NOT been run against the real service
// in this repository (no key was available), only against a stubbed fetch. See docs/ai.md for the live check.
// ---------------------------------------------------------------------------------------------------------------------

export type AnthropicOptions = {
  apiKey: string;
  /** e.g. "claude-sonnet-5-5". Read from configuration, never hard-coded in agents. */
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private readonly f: typeof fetch;
  constructor(private readonly o: AnthropicOptions) {
    if (!o.apiKey) throw new ProviderError("auth", "No API key is configured for the AI provider.");
    this.f = o.fetchImpl ?? fetch;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 60_000);
    req.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
    let res: Response;
    try {
      res = await this.f(`${this.o.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-api-key": this.o.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: this.o.model,
          max_tokens: req.maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          system: req.system,
          // Text-only messages stay plain strings; images use Anthropic's content blocks.
          messages: req.messages.map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content
              : m.content.map((p) => (p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } })),
          })),
        }),
      });
    } catch (e) {
      if (ctl.signal.aborted) throw new ProviderError("timeout", "The AI service took too long to answer.", true);
      throw new ProviderError("network", "Could not reach the AI service.", true);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // The response body is intentionally not forwarded: it can echo request content.
      if (res.status === 401 || res.status === 403) throw new ProviderError("auth", "The AI service rejected the configured key.");
      if (res.status === 429) throw new ProviderError("rate_limited", "The AI service is busy. Please try again in a moment.", true);
      if (res.status === 529 || res.status >= 500) throw new ProviderError("overloaded", "The AI service is temporarily unavailable.", true);
      throw new ProviderError("bad_request", "The AI service could not process that request.");
    }

    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new ProviderError("invalid_response", "The AI service returned something unreadable.");
    }
    const blocks: unknown = body?.content;
    if (!Array.isArray(blocks)) throw new ProviderError("invalid_response", "The AI service returned an unexpected response.");
    const text = blocks.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("");
    const reason = body?.stop_reason;
    const stop: CompletionResult["stop"] = reason === "end_turn" || reason === "stop_sequence" ? "end" : reason === "max_tokens" ? "length" : reason === "refusal" ? "refusal" : "other";
    if (stop === "refusal") throw new ProviderError("refused", "The AI declined to do that.");
    // Only trust real, non-negative numbers. (Number(null) is 0, which would make a request look free.)
    const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
    const inT = count(body?.usage?.input_tokens);
    const outT = count(body?.usage?.output_tokens);
    return {
      text,
      stop,
      model: typeof body?.model === "string" ? body.model : this.o.model,
      usage: { inputTokens: inT ?? estimateTokens(req.system) + req.messages.reduce((n, m) => n + messageTokens(m), 0), outputTokens: outT ?? estimateTokens(text) },
    };
  }
}
