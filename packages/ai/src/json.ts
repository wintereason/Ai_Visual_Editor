/** Model output could not be turned into usable JSON. The message is safe to show to the model as feedback. */
export class AgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentOutputError";
  }
}

/**
 * Pull one JSON value out of a model reply. Tolerates ```json fences and a sentence before/after the JSON, which models
 * add even when told not to. Everything is parsed with JSON.parse (never eval), and the parsed value is untrusted:
 * callers must validate it with the schema.
 */
export function extractJson(text: string): unknown {
  const raw = text.trim();
  if (!raw) throw new AgentOutputError("The reply was empty.");

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = [fenced?.[1]?.trim(), raw].filter((c): c is string => !!c);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next strategy */
    }
  }
  // First balanced {...} or [...] in the text, respecting strings and escapes.
  const start = raw.search(/[{[]/);
  if (start >= 0) {
    const open = raw[start]!;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new AgentOutputError("The reply did not contain valid JSON. Reply with a single JSON object only.");
}
