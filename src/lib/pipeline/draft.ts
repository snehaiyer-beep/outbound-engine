import { z } from "zod";
import { config } from "../config";
import { llmJson, llmMode } from "../services/llm";
import { lintEmail, MAX_WORDS } from "./lint";
import { formatExamples } from "./learning";
import type { Company, Contact, EditRecord, LintResult } from "../types";

export const draftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  painPoints: z.array(z.string()).min(1).max(3),
  hook: z.string(),
});
export type DraftOutput = z.infer<typeof draftSchema>;

export function painPointsFor(position: string): string[] {
  const p = position.toLowerCase();
  if (/secur|ciso|compliance|grc|risk/.test(p))
    return [
      "Evidence collection for an audit is manual and spread across many tools",
      "Enterprise security questionnaires keep landing on their desk",
    ];
  if (/cto|engineer|technology|devops|platform|infra/.test(p))
    return [
      "Audit prep pulls engineers off the roadmap",
      "Keeping controls monitored as infrastructure grows is hard to do by hand",
    ];
  if (/coo|operat/.test(p))
    return [
      "Policies, vendor reviews and access reviews live in spreadsheets",
      "Audit timelines are unpredictable and hard to plan around",
    ];
  return [
    "Enterprise deals stall in security review without a SOC 2 report",
    "Getting certified looks slow and expensive with a small team",
  ];
}

export function gapStatement(company: Company): { gap: string; sentence: string } {
  const s = company.scrape!;
  const order = ["SOC 2", "ISO 27001", "PCI", "HIPAA"];
  const hidden = [...s.certs.hidden].sort((a, b) => order.indexOf(a.cert) - order.indexOf(b.cert) || (a.source === "html-comment" ? -1 : 1))[0];
  const where = s.pages.some((p) => p.ok && (p.path === "/security" || p.path === "/trust"))
    ? `${company.name}'s ${s.pages.find((p) => p.ok && (p.path === "/trust" || p.path === "/security"))!.path.slice(1)} page`
    : `${company.name}'s website`;
  if (hidden)
    return {
      gap: `${hidden.cert} referenced in page source but not shown`,
      sentence:
        hidden.source === "html-comment"
          ? `${where} doesn't show a ${hidden.cert} report yet, though one looks to be in the works.`
          : `${where} doesn't show a ${hidden.cert} report yet.`,
    };
  return { gap: "no SOC 2 or ISO 27001 shown", sentence: `${where} doesn't show a SOC 2 or ISO 27001 certification yet.` };
}

function hiringSentence(company: Company): string {
  const titles = company.scrape?.jobTitles ?? [];
  const pick = titles.find((t) => /enterprise|security|solutions|account exec/i.test(t)) ?? titles[0];
  return pick
    ? `You're hiring for ${titles.length} roles, including ${pick}, which usually means bigger customers and more security reviews.`
    : "Growing teams usually start hitting enterprise security reviews at this stage.";
}

function painSentence(position: string): string {
  const p = position.toLowerCase();
  if (/secur|ciso|compliance|grc|risk/.test(p)) return "That tends to mean manual evidence collection and a stack of questionnaires for your team.";
  if (/cto|engineer|technology|devops|platform|infra/.test(p)) return "That prep usually pulls engineers off the roadmap for weeks.";
  if (/coo|operat/.test(p)) return "That prep usually means policies and access reviews tracked in spreadsheets.";
  return "Without a report, those reviews can stall deals for weeks.";
}

/** Offline drafter: deterministic template that satisfies the lint rules. */
export function mockDraft(company: Company, contact: Contact): DraftOutput {
  const { sentence } = gapStatement(company);
  const body = [
    `Hi ${contact.firstName},`,
    "",
    `${sentence} ${hiringSentence(company)} ${painSentence(contact.position)}`,
    "",
    `${config.senderCompany()} automates evidence collection and audit prep, so lean teams get SOC 2 ready in weeks.`,
    "",
    "Open to a 15-minute call next week to see if it fits?",
    "",
    "Best,",
    config.senderName(),
  ].join("\n");
  return {
    subject: `SOC 2 at ${company.name}`,
    body,
    painPoints: painPointsFor(contact.position),
    hook: sentence,
  };
}

const SYSTEM = `You write first-touch cold emails for ${"{SENDER_COMPANY}"}, which automates SOC 2 / ISO 27001 compliance for SaaS companies.
Hard rules (they are checked by code; violations are rejected):
1. Under ${MAX_WORDS} words total, including greeting and sign-off.
2. Start with "Hi <first name>," on its own line.
3. The FIRST sentence after the greeting states the specific compliance gap seen on their site.
4. No flattery or compliments of any kind.
5. No rhetorical questions. The only question allowed is the single ask.
6. Exactly one low-pressure ask (e.g. a 15-minute call), no urgency words.
7. Plain text. Sign off with "Best," then the sender name on the next line. Do not add an unsubscribe line.
Also return the two most likely pain points for this person's role and the hook you used.
JSON shape: {"subject": str, "body": str, "painPoints": [str, str], "hook": str}`;

export function buildDraftPrompt(company: Company, contact: Contact, examples: EditRecord[]): { system: string; user: string } {
  const s = company.scrape!;
  const gap = gapStatement(company);
  const user = `Sender: ${config.senderName()} at ${config.senderCompany()}
Prospect: ${contact.name} (${contact.position}) at ${company.name} (${company.domain})
Why they qualified: ${Object.values(company.qualification?.rules ?? {}).map((r) => r.reason).join(" ")}
Compliance gap: ${gap.gap}. Suggested gap sentence: "${gap.sentence}"
Hidden certification signals in page source: ${s.certs.hidden.map((h) => `${h.cert} (${h.source} on ${h.page})`).join(", ") || "none"}
Open roles (${s.openRoles}): ${s.jobTitles.join("; ") || "none"}
Likely pain points for this role: ${painPointsFor(contact.position).join("; ")}

${formatExamples(examples)}`.trim();
  return { system: SYSTEM.replace("{SENDER_COMPANY}", config.senderCompany()), user };
}

export async function generateDraft(
  company: Company,
  contact: Contact,
  examples: EditRecord[],
): Promise<{ out: DraftOutput; lint: LintResult; model: string; prompt: string }> {
  const { system, user } = buildDraftPrompt(company, contact, examples);
  if (llmMode() === "mock") {
    const out = mockDraft(company, contact);
    return { out, lint: lintEmail(out.subject, out.body, { firstName: contact.firstName }), model: "mock", prompt: user };
  }
  const mock = () => {
    const out = mockDraft(company, contact);
    return { out, lint: lintEmail(out.subject, out.body, { firstName: contact.firstName }) };
  };
  try {
    let prompt = user;
    let r = await llmJson(system, prompt, draftSchema);
    let lint = lintEmail(r.data.subject, r.data.body, { firstName: contact.firstName });
    for (let i = 0; i < 2 && !lint.ok; i++) {
      const issues = lint.issues.map((x) => `- ${x.message}`).join("\n");
      prompt = `${user}\n\nYour previous draft failed these checks:\n${issues}\nPrevious draft:\n${r.data.body}\nFix every issue.`;
      r = await llmJson(system, prompt, draftSchema);
      lint = lintEmail(r.data.subject, r.data.body, { firstName: contact.firstName });
    }
    return { out: r.data, lint, model: r.model, prompt: user };
  } catch (e) {
    return { ...mock(), model: `mock (LLM failed: ${(e as Error).message.slice(0, 120)})`, prompt: user };
  }
}
