import { z } from "zod";
import { llmJson, llmMode } from "../services/llm";
import { RULE_KEYS, type Qualification, type RuleKey, type ScrapeResult } from "../types";

// A rule can be true, false, or null ("not enough evidence yet"). null triggers the agent loop.
const ruleSchema = z.object({ pass: z.boolean().nullable(), reason: z.string() });
export const qualifySchema = z.object({
  b2b_software: ruleSchema,
  employees_20_plus: ruleSchema,
  open_roles_3_plus: ruleSchema,
  no_visible_certification: ruleSchema,
});
export type RawQualification = z.infer<typeof qualifySchema>;

export type Qualifier = (s: ScrapeResult) => Promise<RawQualification & { _model?: string }>;

const pageName = (p: string) => (p === "/" ? "the homepage" : `the ${p.replace(/^\//, "")} page`);

const SYSTEM = `You qualify prospects for Sprinto, which automates SOC 2 / ISO 27001 compliance for SaaS companies.
Judge ONLY from the evidence given. For each rule return pass=true, pass=false, or pass=null if the evidence is insufficient to decide.
Rules:
- b2b_software: the company sells software (SaaS/platform/API) to businesses, not consumers.
- employees_20_plus: the company has 20 or more employees.
- open_roles_3_plus: the company currently lists 3 or more open roles (careers page, job board or a web search answer with sources). If no job titles were detected and the text does not clearly say there are no openings, return null: jobs are often on JavaScript job boards the scraper cannot read.
- no_visible_certification: no SOC 2, ISO 27001, HIPAA or PCI certification is shown to visitors (in page text or as a badge image). Hints only in page source do not count.
Each reason must cite the evidence in one sentence.
JSON shape: {"b2b_software":{"pass":bool|null,"reason":str},"employees_20_plus":{...},"open_roles_3_plus":{...},"no_visible_certification":{...}}`;

function evidence(s: ScrapeResult): string {
  const pages = s.pages
    .filter((p) => p.ok)
    .map((p) => `## ${p.path}\n${p.text.slice(0, 1500)}`)
    .join("\n\n");
  return `Company: ${s.companyName}
Detected job titles (${s.openRoles}): ${s.jobTitles.join("; ") || "none"}
Employee count hint from text: ${s.employeeHint ?? "not found"}
Certifications visible on the site: ${s.certs.visible.map((c) => `${c.cert} on ${c.page}${c.source === "image" ? " (badge image)" : ""}`).join(", ") || "none"}
Certification hints only in page source (not shown to visitors): ${s.certs.hidden.map((c) => `${c.cert} (${c.source} on ${c.page})`).join(", ") || "none"}
Pages fetched: ${s.pages.map((p) => `${p.path} (${p.ok ? "ok" : p.status || "failed"})`).join(", ")}

${pages}`;
}

// If the LLM is unavailable (quota, outage) the deterministic qualifier takes over and says so.
const llmQualifier: Qualifier = async (s) => {
  try {
    const { data, model } = await llmJson(SYSTEM, evidence(s), qualifySchema);
    return { ...data, _model: model };
  } catch (e) {
    return { ...(await mockQualifier(s)), _model: `mock (LLM failed: ${(e as Error).message.slice(0, 120)})` };
  }
};

const CONSUMER = /\b(add to cart|free shipping|shop now|subscribe & save|for coffee lovers|consumers?|for families|our store)\b/i;
const B2B = /\b(b2b|saas|platform|api|enterprise|for (?:\w+ )?teams|businesses|customers|integrations?|software)\b/i;

/** Deterministic offline stand-in for the LLM. */
export const mockQualifier: Qualifier = async (s) => {
  const text = s.pages.map((p) => p.text).join(" ");
  const consumer = CONSUMER.test(text);
  const b2b = B2B.test(text);
  const b2bRule =
    consumer
      ? { pass: false, reason: `Consumer signals on site ("${CONSUMER.exec(text)![0]}"), not B2B software.` }
      : b2b
        ? { pass: true, reason: `Site describes business software ("${B2B.exec(text)![0]}").` }
        : { pass: null, reason: "No clear description of what the company sells." };
  const emp =
    s.employeeHint === null
      ? { pass: null, reason: "No employee count found on fetched pages." }
      : { pass: s.employeeHint >= 20, reason: `Site states about ${s.employeeHint} people.` };
  const careersOk = s.pages.some((p) => p.ok && /career|job/.test(p.path));
  const roles =
    s.openRoles === 0 && !careersOk
      ? { pass: null, reason: "No careers page found yet." }
      : { pass: s.openRoles >= 3, reason: `${s.openRoles} open role(s) listed${s.jobTitles.length ? `: ${s.jobTitles.slice(0, 3).join(", ")}` : ""}.` };
  const certs = s.certs.visible;
  const certRule = certs.length
    ? { pass: false, reason: `Shows ${certs.map((c) => `${c.cert} on ${pageName(c.page)}${c.source === "image" ? " (badge image)" : ""}`).join(", ")}.` }
    : { pass: true, reason: "No SOC 2, ISO 27001, HIPAA or PCI shown in visible text." };
  return { b2b_software: b2bRule, employees_20_plus: emp, open_roles_3_plus: roles, no_visible_certification: certRule };
};

export function getQualifier(): { fn: Qualifier; model: string } {
  return llmMode() !== "mock" ? { fn: llmQualifier, model: llmMode() } : { fn: mockQualifier, model: "mock" };
}

/**
 * Agent loop: ask the model; if any rule is undecided (null), fetch more pages and ask again.
 * After the loop, still-undecided rules fail with "insufficient evidence".
 * The certification rule is also cross-checked against the deterministic scrape.
 */
export async function qualify(
  initial: ScrapeResult,
  fetchMore: (round: number, undecided: RuleKey[]) => Promise<{ scrape: ScrapeResult; fetched: string[] } | null>,
  qualifier: Qualifier = getQualifier().fn,
  model = getQualifier().model,
  maxRounds = 2,
): Promise<{ qualification: Qualification; scrape: ScrapeResult }> {
  let scrape = initial;
  let raw = await qualifier(scrape);
  let usedModel = raw._model ?? model;
  let iterations = 1;
  const extra: string[] = [];
  for (let round = 0; round < maxRounds && RULE_KEYS.some((k) => raw[k].pass === null); round++) {
    const more = await fetchMore(round, RULE_KEYS.filter((k) => raw[k].pass === null));
    if (!more || more.fetched.length === 0) break;
    extra.push(...more.fetched);
    scrape = more.scrape;
    raw = await qualifier(scrape);
    usedModel = raw._model ?? usedModel;
    iterations++;
  }

  const rules = {} as Qualification["rules"];
  for (const k of RULE_KEYS) {
    const r = raw[k];
    rules[k] = r.pass === null ? { pass: false, reason: `Insufficient evidence after ${iterations} pass(es): ${r.reason}` } : { pass: r.pass, reason: r.reason };
  }
  if (scrape.certs.visible.length && rules.no_visible_certification.pass) {
    rules.no_visible_certification = {
      pass: false,
      reason: `Shows ${scrape.certs.visible.map((c) => `${c.cert} on ${pageName(c.page)}`).join(", ")} (found by the website check).`,
    };
  }
  const failing = RULE_KEYS.filter((k: RuleKey) => !rules[k].pass);
  const undecided = RULE_KEYS.filter((k) => raw[k].pass === null && !rules[k].pass && !(k === "no_visible_certification" && scrape.certs.visible.length));
  return {
    scrape,
    qualification: {
      rules,
      qualified: failing.length === 0,
      undecided,
      disqualifyReasons: failing.map((k) => `${k}: ${rules[k].reason}`),
      iterations,
      extraPagesFetched: extra,
      model: usedModel,
    },
  };
}
