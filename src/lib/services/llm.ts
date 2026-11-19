import type { z } from "zod";
import { config } from "../config";

export function llmMode(): "gemini" | "anthropic" | "mock" {
  if (config.geminiKey()) return "gemini";
  if (config.anthropicKey()) return "anthropic";
  return "mock";
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LLM did not return JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function anthropicText(system: string, user: string, maxTokens: number): Promise<{ text: string; model: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.anthropicKey(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: config.anthropicModel(),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return { text: data.content.filter((c) => c.type === "text").map((c) => c.text).join(""), model: config.anthropicModel() };
}

// Gemini free tier limits requests per model per day, so try each model in turn.
async function geminiText(system: string, user: string, maxTokens: number): Promise<{ text: string; model: string }> {
  const errors: string[] = [];
  for (const model of config.geminiModels()) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.geminiKey() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: Math.max(maxTokens, 4096), temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch((e: Error) => e);
    if (res instanceof Error) {
      errors.push(`${model}: ${res.message}`);
      continue;
    }
    if (!res.ok) {
      errors.push(`${model}: ${res.status}`);
      if ([400, 401, 403].includes(res.status) && !(await res.text()).includes("not found")) break; // bad key: stop
      continue; // 404 model gone, 429 quota, 5xx overloaded → next model
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (text) return { text, model };
    errors.push(`${model}: empty reply`);
  }
  throw new Error(`Gemini unavailable (${errors.join("; ")})`);
}

/** Calls the configured LLM and validates the JSON reply against a zod schema (one retry on bad JSON). */
export async function llmJson<T>(system: string, user: string, schema: z.ZodType<T>, maxTokens = 1200): Promise<{ data: T; model: string }> {
  const call = llmMode() === "gemini" ? geminiText : anthropicText;
  const sys = `${system}\nRespond with a single JSON object only, no prose.`;
  let lastErr: unknown;
  let prompt = user;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, model } = await call(sys, prompt, maxTokens);
    try {
      return { data: schema.parse(extractJson(text)), model };
    } catch (e) {
      lastErr = e;
      prompt = `${user}\n\nYour previous reply was not valid JSON for the required schema (${(e as Error).message.slice(0, 300)}). Return only the JSON object.`;
    }
  }
  throw lastErr;
}

/** Agent-loop tool: one web-grounded question via Gemini + Google Search. Returns null if unavailable. */
export async function webResearch(question: string): Promise<{ answer: string; sources: string[]; model: string } | null> {
  if (llmMode() !== "gemini") return null;
  for (const model of config.geminiModels()) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.geminiKey() },
        body: JSON.stringify({ tools: [{ google_search: {} }], contents: [{ role: "user", parts: [{ text: question }] }] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { title?: string } }[] } }[];
      };
      const c = data.candidates?.[0];
      const answer = c?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (!answer) continue;
      const sources = [...new Set((c?.groundingMetadata?.groundingChunks ?? []).map((g) => g.web?.title).filter((t): t is string => Boolean(t)))];
      return { answer, sources, model };
    } catch {
      continue;
    }
  }
  return null;
}
