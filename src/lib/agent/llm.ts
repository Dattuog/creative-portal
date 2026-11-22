import { env } from "../env";

export interface LlmResult {
  ok: boolean;
  text: string;
  model: string;
  error?: string;
}

/** OpenRouter chat completion (OpenAI-compatible). */
export async function chat(system: string, user: string, timeoutMs = 90_000): Promise<LlmResult> {
  const key = env.openrouterKey();
  const model = env.openrouterModel();
  if (!key) return { ok: false, text: "", model, error: "OPENROUTER_API_KEY not set" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Creative Performance Portal",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 4000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, text: "", model, error: `OpenRouter ${res.status}: ${body?.error?.message ?? "error"}` };
    const text: string = body?.choices?.[0]?.message?.content ?? "";
    if (!text) return { ok: false, text: "", model, error: "Empty model response" };
    return { ok: true, text, model: body?.model ?? model };
  } catch (e) {
    return { ok: false, text: "", model, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reasoning models often wrap JSON in <think> blocks or ``` fences, or add prose.
 * Take the last balanced top-level JSON object in the text.
 */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  let depth = 0, startIdx = -1, inStr = false, esc = false;
  let last: string | null = null;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && startIdx >= 0) last = cleaned.slice(startIdx, i + 1);
    }
  }
  if (!last) throw new Error("No JSON object in model output");
  return JSON.parse(last);
}
