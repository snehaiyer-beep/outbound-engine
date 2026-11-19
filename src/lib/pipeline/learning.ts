import type { EditRecord, StoreData } from "../types";

// Learning loop: every human edit and rejection is stored; the most similar ones
// are retrieved (TF cosine over context + draft text) and fed into future draft prompts.

const STOP = new Set("the a an and or of to in on for with at by is are be we our your you it this that as from i".split(" "));

export function tokens(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 2 || STOP.has(w)) continue;
    m.set(w, (m.get(w) ?? 0) + 1);
  }
  return m;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function editContext(opts: { position: string; companyName: string; gap: string; signals: string }): string {
  return `role: ${opts.position} | company: ${opts.companyName} | gap: ${opts.gap} | ${opts.signals}`;
}

/** Top 3-5 similar past edits: always the best 3 (if that many exist), up to 5 if similar enough. */
export function similarEdits(s: StoreData, context: string, draftText = "", min = 3, max = 5, threshold = 0.15): EditRecord[] {
  const q = tokens(`${context} ${context} ${draftText}`);
  const scored = s.edits
    .map((e) => ({ e, score: cosine(q, tokens(`${e.context} ${e.context} ${e.before.body}`)) }))
    .sort((a, b) => b.score - a.score);
  return scored.filter((x, i) => i < min || (i < max && x.score >= threshold)).slice(0, max).map((x) => x.e);
}

export function formatExamples(edits: EditRecord[]): string {
  if (!edits.length) return "";
  const parts = edits.map((e, i) =>
    e.kind === "edit"
      ? `Example ${i + 1} (human edit, context: ${e.context})\nBEFORE:\n${e.before.body}\nAFTER:\n${e.after?.body ?? ""}`
      : `Example ${i + 1} (REJECTED, context: ${e.context})\nDRAFT:\n${e.before.body}\nREJECT REASON: ${e.reason}`,
  );
  return `Past reviewer feedback on similar emails. Apply the same preferences:\n\n${parts.join("\n\n")}`;
}
