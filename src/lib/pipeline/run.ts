import { mutate, newId, now, readStore } from "../store";
import { normalizeDomain } from "../services/fetcher";
import { webResearch } from "../services/llm";
import { FIXTURE_SITES } from "../fixtures";
import { analyse, EXTRA_PAGES, scrapeCompany, scrapePages } from "./scrape";
import { qualify } from "./qualify";
import { findContacts } from "./contacts";
import { editContext, similarEdits } from "./learning";
import { gapStatement, generateDraft } from "./draft";
import { fitScore } from "./score";
import { assertRunning } from "../safety/kill";
import type { Company, Contact, Draft } from "../types";

export function contextFor(company: Company, contact: Contact): string {
  return editContext({
    position: contact.position,
    companyName: company.name,
    gap: company.scrape ? gapStatement(company).gap : "",
    signals: `${company.scrape?.openRoles ?? 0} open roles; ${company.scrape?.jobTitles.slice(0, 4).join(", ") ?? ""}`,
  });
}

export async function processDomain(input: string): Promise<Company> {
  const domain = normalizeDomain(input);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error(`Invalid domain: ${input}`);

  assertRunning(await readStore());
  const existing = (await readStore()).companies.find((c) => c.domain === domain);
  if (existing && (await readStore()).sends.some((x) => x.companyId === existing.id)) return existing; // never redo a contacted company

  const company: Company = {
    id: existing?.id ?? newId("co"),
    domain,
    name: domain,
    status: "scraped",
    createdAt: now(),
  };
  try {
    // 1. Ingest
    const { result, raw } = await scrapeCompany(domain);
    company.scrape = result;
    company.name = result.companyName;
    company.description = result.description;

    // 2. Qualify (agent loop fetches more pages while rules are undecided)
    const allPages = [...result.pages];
    const rounds = [EXTRA_PAGES.slice(0, 3), EXTRA_PAGES.slice(3)];
    const { qualification, scrape } = await qualify(result, async (round, undecided) => {
      const paths = rounds[round];
      if (!paths?.length) return null;
      const more = await scrapePages(domain, paths);
      for (const [k, v] of more.raw) raw.set(k, v);
      allPages.push(...more.pages);
      const fetched = more.pages.filter((p) => p.ok).map((p) => p.path);
      // Tool 2: web search (Gemini + Google Search) for facts company sites rarely show.
      if (round === 0 && !FIXTURE_SITES[domain]) {
        const name = `${result.companyName} (${domain})`;
        const questions: [string, string][] = [];
        if (undecided.includes("employees_20_plus"))
          questions.push([
            "web:headcount",
            `How many employees does the company ${name} have? Answer in one or two sentences with a number or range, the source, and how confident you are. If you cannot tell, say so.`,
          ]);
        if (undecided.includes("open_roles_3_plus"))
          questions.push([
            "web:open-roles",
            `How many open job roles does ${name} currently advertise (its careers page, LinkedIn, Wellfound, Naukri or job boards like Keka, Ashby, Greenhouse, Lever)? Give a number, list up to 5 role titles, and say how recent the information is. If you cannot tell, say so.`,
          ]);
        const answers = await Promise.all(questions.map(([, q]) => webResearch(q)));
        answers.forEach((web, i) => {
          if (!web) return;
          allPages.push({
            path: questions[i][0],
            url: `google-search via ${web.model}`,
            ok: true,
            status: 200,
            text: `Web search answer: ${web.answer} Sources: ${web.sources.join(", ") || "none listed"}`,
            jobTitles: [],
          });
          fetched.push(questions[i][0]);
        });
      }
      return { scrape: analyse(domain, allPages, raw, result.mode), fetched };
    });
    company.scrape = scrape;
    company.qualification = qualification;
    // A rule that is clearly "no" disqualifies. If the only problem is that the agent
    // could not find out, a person decides instead of the tool guessing.
    const clearlyFailed = Object.entries(qualification.rules).some(
      ([k, r]) => !r.pass && !qualification.undecided.includes(k as never),
    );
    company.status = qualification.qualified ? "qualified" : clearlyFailed ? "disqualified" : "needs_review";

    // 3. Contacts (qualified only) and 4. drafts
    const { contacts, drafts } = company.status === "qualified" ? await prepareOutreach(company) : { contacts: [], drafts: [] };
    await save(company, contacts, drafts);
  } catch (e) {
    company.status = "error";
    company.error = (e as Error).message;
    await save(company, [], []);
  }
  return company;
}

/** Steps 3 + 4 for a good-fit company: score it, find people, draft one email each. */
export async function prepareOutreach(company: Company): Promise<{ contacts: Contact[]; drafts: Draft[] }> {
  company.fit = fitScore(company);
  const found = await findContacts(company.id, company.domain);
  company.contactsNote = found.note;
  const contacts: Contact[] = [...found.contacts];
  const drafts: Draft[] = [];
  const snapshot = await readStore();
  for (const contact of contacts) {
    const examples = similarEdits(snapshot, contextFor(company, contact));
    const { out, lint, model } = await generateDraft(company, contact, examples);
    drafts.push({
      id: newId("dr"),
      companyId: company.id,
      contactId: contact.id,
      subject: out.subject,
      body: out.body,
      original: { subject: out.subject, body: out.body },
      painPoints: out.painPoints,
      hook: out.hook,
      status: "draft",
      lint,
      examplesUsed: examples.map((e) => e.id),
      model,
      createdAt: now(),
    });
  }
  return { contacts, drafts };
}

export async function save(company: Company, contacts: Contact[], drafts: Draft[]) {
  await mutate((s) => {
    s.companies = s.companies.filter((c) => c.id !== company.id);
    s.contacts = s.contacts.filter((c) => c.companyId !== company.id);
    s.drafts = s.drafts.filter((d) => d.companyId !== company.id);
    s.companies.push(company);
    s.contacts.push(...contacts);
    s.drafts.push(...drafts);
  });
}

export async function runPipeline(domains: string[]): Promise<Company[]> {
  const unique = [...new Set(domains.map(normalizeDomain).filter(Boolean))].slice(0, 50);
  const out: Company[] = [];
  for (const d of unique) out.push(await processDomain(d));
  return out;
}
