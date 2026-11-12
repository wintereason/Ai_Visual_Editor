// A deliberately small, vendor-neutral model interface (spec 10.1: "do not hard-code model names; put the provider
// behind an abstraction"). Agents only ever see `ModelProvider`; swapping vendors or models never touches them.

/** One piece of a message. Images are base64 (no data: prefix) and must be PNG, JPEG, GIF or WebP. */
export type ContentPart = { type: "text"; text: string } | { type: "image"; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };
export type ChatMessage = { role: "user" | "assistant"; content: string | ContentPart[] };

/** The text of a message, ignoring any images. */
export const messageText = (m: ChatMessage): string => (typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n"));
/** A rough input-token allowance for each image, used only when the provider doesn't report usage. */
export const IMAGE_TOKEN_ESTIMATE = 1600;
export const messageTokens = (m: ChatMessage): number => estimateTokens(messageText(m)) + (typeof m.content === "string" ? 0 : m.content.filter((p) => p.type === "image").length * IMAGE_TOKEN_ESTIMATE);

export type CompletionRequest = {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type Usage = { inputTokens: number; outputTokens: number };

export type CompletionResult = {
  text: string;
  usage: Usage;
  model: string;
  /** "end" for a normal finish, "length" if the output was cut off by maxTokens, "refusal" if the model declined. */
  stop: "end" | "length" | "refusal" | "other";
};

export interface ModelProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export type ProviderErrorKind = "rate_limited" | "overloaded" | "auth" | "bad_request" | "network" | "timeout" | "refused" | "invalid_response";

/** Safe to show to a user: never carries a key, a request body or a vendor stack trace. */
export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string, readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Retries transient failures (rate limits, overload, network, timeout) with exponential backoff; everything else fails fast. */
export function withRetry(inner: ModelProvider, opts: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}): ModelProvider {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    name: inner.name,
    async complete(req) {
      let last: unknown;
      for (let i = 0; i < attempts; i++) {
        try {
          return await inner.complete(req);
        } catch (e) {
          last = e;
          if (!(e instanceof ProviderError) || !e.retryable || req.signal?.aborted || i === attempts - 1) throw e;
          await sleep(base * 2 ** i);
        }
      }
      throw last;
    },
  };
}

/** Rough token estimate for providers/tests that do not report usage (about 4 characters per token). */
export const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));
