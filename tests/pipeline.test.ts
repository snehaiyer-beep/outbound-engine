import { beforeEach, describe, expect, it } from "vitest";
import { freshEnv } from "./helpers";
import { findCerts, hiddenCertHits, visibleText } from "@/lib/pipeline/certs";
import { analyse, extractEmployeeHint, extractJobTitles, scrapeCompany } from "@/lib/pipeline/scrape";
import { qualify, mockQualifier, type RawQualification } from "@/lib/pipeline/qualify";
import { findContacts, rankRole } from "@/lib/pipeline/contacts";
import { lintEmail } from "@/lib/pipeline/lint";
import { buildDraftPrompt, mockDraft } from "@/lib/pipeline/draft";
import { similarEdits, formatExamples } from "@/lib/pipeline/learning";
import { processDomain, runPipeline } from "@/lib/pipeline/run";
import { readStore, mutate } from "@/lib/store";
import { saveDraft, rejectDraft } from "@/lib/drafts";
import type { EditRecord, ScrapeResult } from "@/lib/types";

beforeEach(async () => {
  await freshEnv();
});

describe("1. ingest: scraping and certification detection", () => {
  it("finds certs in visible text only, ignoring comments and scripts", () => {
    const html = `<body><p>We are SOC 2 Type II certified</p><!-- ISO 27001 --><script>var x="HIPAA"</script></body>`;
    const text = visibleText(html);
    expect(text).toContain("SOC 2");
    expect(text).not.toContain("ISO");
    expect(text).not.toContain("HIPAA");
    expect(findCerts(text, "visible", "/").map((h) => h.cert)).toEqual(["SOC 2"]);
  });
  it("detects all four certifications and variants", () => {
    const certs = findCerts("SOC2, ISO/IEC 27001, HIPAA-compliant, PCI DSS", "visible", "/").map((h) => h.cert);
    expect(certs).toEqual(["SOC 2", "ISO 27001", "HIPAA", "PCI"]);
    expect(findCerts("PCIe cards and social media", "visible", "/")).toEqual([]);
  });
  it("checks raw HTML: comments, image names and script embeds", () => {
    const html = `<body><!-- soc 2 badge --><img src="/badges/iso27001.png"><img alt="HIPAA seal" src="x.png"><script src="https://cdn.trust.com/pci-dss-widget.js"></script></body>`;
    const hits = hiddenCertHits(html, "/trust");
    expect(hits.map((h) => `${h.cert}:${h.source}`).sort()).toEqual(["HIPAA:image", "ISO 27001:image", "PCI:script", "SOC 2:html-comment"]);
  });
  it("only checks raw HTML when nothing is visible", async () => {
    const vaultly = (await scrapeCompany("vaultly.com")).result;
    expect(vaultly.certs.visible.length).toBeGreaterThan(0);
    expect(vaultly.certs.hidden).toEqual([]);
    const acme = (await scrapeCompany("acmeledger.io")).result;
    expect(acme.certs.visible).toEqual([]);
    expect(acme.certs.hidden[0]).toMatchObject({ cert: "SOC 2", source: "html-comment", page: "/security" });
  });
  it("scrapes homepage, /about, /careers, /security and /trust", async () => {
    const { result } = await scrapeCompany("acmeledger.io");
    expect(result.pages.map((p) => p.path)).toEqual(["/", "/about", "/careers", "/security", "/trust"]);
    expect(result.openRoles).toBe(6);
    expect(result.employeeHint).toBe(85);
    expect(result.companyName).toBe("Acme Ledger");
  });
  it("extracts job titles and employee counts", () => {
    expect(extractJobTitles(`<a href="https://jobs.lever.co/x/1">Eng</a><li class="job">PM</li>`)).toEqual(["Eng", "PM"]);
    expect(extractEmployeeHint("We're 1,200 people strong")).toBe(1200);
    expect(extractEmployeeHint("no number here")).toBeNull();
  });
});

describe("2. qualify (structured rules + agent loop)", () => {
  it("returns a boolean and reason for every rule", async () => {
    const { result } = await scrapeCompany("acmeledger.io");
    const { qualification } = await qualify(result, async () => null);
    for (const r of Object.values(qualification.rules)) {
      expect(typeof r.pass).toBe("boolean");
      expect(r.reason.length).toBeGreaterThan(5);
    }
    expect(qualification.qualified).toBe(true);
  });
  it("fetches more pages when a rule is undecided (agent loop)", async () => {
    const c = await processDomain("orbitops.dev");
    expect(c.qualification!.iterations).toBe(2);
    expect(c.qualification!.extraPagesFetched).toContain("/company");
    expect(c.qualification!.rules.employees_20_plus.pass).toBe(true);
    expect(c.status).toBe("qualified");
  });
  it("undecided rules fail with 'insufficient evidence' after the loop", async () => {
    const s = (await scrapeCompany("acmeledger.io")).result;
    const undecided = async (): Promise<RawQualification> => ({ ...(await mockQualifier(s)), employees_20_plus: { pass: null, reason: "unknown" } });
    const { qualification } = await qualify(s, async () => null, undecided, "fake");
    expect(qualification.rules.employees_20_plus).toMatchObject({ pass: false });
    expect(qualification.rules.employees_20_plus.reason).toMatch(/Insufficient evidence/);
    expect(qualification.qualified).toBe(false);
  });
  it("overrides an LLM that misses a visible certification", async () => {
    const s = (await scrapeCompany("vaultly.com")).result;
    const wrong = async (): Promise<RawQualification> => ({ ...(await mockQualifier(s)), no_visible_certification: { pass: true, reason: "none" } });
    const { qualification } = await qualify(s, async () => null, wrong, "fake");
    expect(qualification.rules.no_visible_certification.pass).toBe(false);
  });
  it("gives reasons for every disqualified company", async () => {
    const out = await runPipeline(["vaultly.com", "brewbox.shop", "tinytask.app", "medsync.health"]);
    for (const c of out) {
      expect(c.status).toBe("disqualified");
      expect(c.qualification!.disqualifyReasons.length).toBeGreaterThan(0);
    }
    const tiny = out.find((c) => c.domain === "tinytask.app")!;
    expect(tiny.qualification!.disqualifyReasons.join()).toMatch(/employees_20_plus.*open_roles_3_plus/);
    expect(out.find((c) => c.domain === "brewbox.shop")!.qualification!.rules.b2b_software.pass).toBe(false);
  });
});

describe("3. contacts", () => {
  it("ranks by role and caps at 5", async () => {
    const { contacts } = await findContacts("co", "acmeledger.io");
    expect(contacts).toHaveLength(5);
    expect(contacts.map((c) => c.position)).toEqual(["Head of Security", "CTO", "VP Operations", "CEO & Co-founder", "Sales Manager"]);
  });
  it("role ranking prefers security/compliance owners", () => {
    expect(rankRole("CISO").score).toBeGreaterThan(rankRole("Compliance Manager").score);
    expect(rankRole("Compliance Manager").score).toBeGreaterThan(rankRole("CTO").score);
    expect(rankRole("CTO").score).toBeGreaterThan(rankRole("Account Executive").score);
  });
  it("only looks up contacts for qualified companies", async () => {
    await runPipeline(["vaultly.com", "acmeledger.io"]);
    const s = (await readStore());
    const vaultly = s.companies.find((c) => c.domain === "vaultly.com")!;
    expect(s.contacts.filter((c) => c.companyId === vaultly.id)).toHaveLength(0);
    const acme = s.companies.find((c) => c.domain === "acmeledger.io")!;
    expect(s.contacts.filter((c) => c.companyId === acme.id)).toHaveLength(5);
  });
});

describe("4. drafting rules (lint)", () => {
  const good = "Hi Priya,\n\nAcme's trust page doesn't show a SOC 2 report yet. You're hiring six roles.\n\nOpen to a 15-minute call next week?\n\nBest,\nSam";
  it("passes a compliant email", () => expect(lintEmail("SOC 2 at Acme", good, { firstName: "Priya" })).toMatchObject({ ok: true }));
  it("flags 90+ words", () => {
    const long = good.replace("You're hiring six roles.", "Word ".repeat(80) + "end.");
    expect(lintEmail("s", long).issues.map((i) => i.rule)).toContain("length");
  });
  it("requires the first sentence to state the gap", () => {
    const bad = good.replace("Acme's trust page doesn't show a SOC 2 report yet.", "Hope your week is going well.");
    expect(lintEmail("s", bad).issues.map((i) => i.rule)).toContain("gap-first");
  });
  it("flags flattery", () => {
    expect(lintEmail("s", good.replace("You're hiring", "Impressive growth. You're hiring")).issues.map((i) => i.rule)).toContain("no-flattery");
  });
  it("flags rhetorical questions", () => {
    const r = lintEmail("s", good.replace("You're hiring six roles.", "Did you know audits take months? You're hiring."));
    expect(r.issues.map((i) => i.rule)).toContain("no-rhetorical");
  });
  it("requires exactly one low-pressure ask", () => {
    expect(lintEmail("s", good.replace("Open to a 15-minute call next week?", "Thanks.")).issues.map((i) => i.rule)).toContain("one-ask");
    const two = good.replace("Open to a 15-minute call next week?", "Open to a quick call? Happy to send a short video too.");
    expect(lintEmail("s", two).issues.map((i) => i.rule)).toContain("one-ask");
    expect(lintEmail("s", good.replace("next week?", "ASAP?")).issues.map((i) => i.rule)).toContain("low-pressure");
  });
  it("requires greeting the contact by name", () => {
    expect(lintEmail("s", good, { firstName: "Daniel" }).issues.map((i) => i.rule)).toContain("greeting");
  });
  it("mock drafts pass every rule for every qualified contact", async () => {
    await runPipeline(["acmeledger.io", "orbitops.dev"]);
    const drafts = (await readStore()).drafts;
    expect(drafts.length).toBe(7);
    for (const d of drafts) {
      expect(d.lint.issues).toEqual([]);
      expect(d.lint.wordCount).toBeLessThan(90);
      expect(d.painPoints).toHaveLength(2);
    }
  });
});

describe("6. learning loop", () => {
  it("saves before/after edits and reject reasons", async () => {
    await runPipeline(["acmeledger.io"]);
    const [d1, d2] = (await readStore()).drafts;
    await saveDraft(d1.id, { subject: d1.subject, body: d1.body.replace("Open to a 15-minute call", "Worth a 15-minute call") });
    await rejectDraft(d2.id, "Too generic for a sales manager");
    const edits = (await readStore()).edits;
    expect(edits).toHaveLength(2);
    expect(edits[0]).toMatchObject({ kind: "edit", draftId: d1.id });
    expect(edits[0].after!.body).toContain("Worth a 15-minute call");
    expect(edits[1]).toMatchObject({ kind: "reject", reason: "Too generic for a sales manager" });
  });
  it("retrieves 3-5 most similar edits and puts them in the draft prompt", async () => {
    const mk = (i: number, context: string): EditRecord => ({
      id: `ed_${i}`, draftId: "d", companyId: "c", kind: "edit", context,
      before: { subject: "s", body: `before ${i}` }, after: { subject: "s", body: `after ${i}` }, at: new Date().toISOString(),
    });
    await mutate((s) => {
      s.edits.push(
        mk(1, "role: Head of Security | gap: SOC 2 referenced"),
        mk(2, "role: Head of Security | gap: no SOC 2"),
        mk(3, "role: CISO security | gap: SOC 2"),
        mk(4, "role: Head of Security compliance | gap: SOC 2"),
        mk(5, "role: Barista | gap: coffee"),
        mk(6, "role: Head of Security | gap: SOC 2 in page source"),
        mk(7, "role: Florist | gap: flowers"),
      );
    });
    const got = similarEdits((await readStore()), "role: Head of Security | gap: SOC 2");
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.length).toBeLessThanOrEqual(5);
    expect(got.map((e) => e.id)).not.toContain("ed_5");
    expect(got.map((e) => e.id)).not.toContain("ed_7");

    await runPipeline(["acmeledger.io"]);
    const s = (await readStore());
    const draft = s.drafts.find((d) => s.contacts.find((c) => c.id === d.contactId)?.position === "Head of Security")!;
    expect(draft.examplesUsed.length).toBeGreaterThanOrEqual(3);
    const company = s.companies[0];
    const contact = s.contacts.find((c) => c.id === draft.contactId)!;
    const examples = s.edits.filter((e) => draft.examplesUsed.includes(e.id));
    const { user } = buildDraftPrompt(company, contact, examples);
    expect(user).toContain(formatExamples(examples));
    expect(user).toContain("after 1");
  });
  it("mock draft opens with the gap and addresses the contact by name", async () => {
    await runPipeline(["acmeledger.io"]);
    const s = (await readStore());
    const contact = s.contacts[0];
    const d = mockDraft(s.companies[0], contact);
    expect(d.body.startsWith(`Hi ${contact.firstName},`)).toBe(true);
    expect(d.hook).toMatch(/SOC 2/);
  });
});

describe("analyse()", () => {
  it("merges extra pages into one result", () => {
    const pages = [
      { path: "/", url: "", ok: true, status: 200, text: "B2B SaaS", jobTitles: [] },
      { path: "/company", url: "", ok: true, status: 200, text: "We're 45 people", jobTitles: [] },
    ];
    const r: ScrapeResult = analyse("x.com", pages, new Map(), "mock");
    expect(r.employeeHint).toBe(45);
  });
});

describe("job boards (ATS)", () => {
  it("reads roles from a job board linked on the site, else guesses by name and labels it", async () => {
    const { findAtsJobs } = await import("@/lib/pipeline/scrape");
    const { vi } = await import("vitest");
    process.env.OFFLINE = "false";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("ashbyhq.com/posting-api/job-board/acme"))
        return new Response(JSON.stringify({ jobs: [{ title: "SRE" }, { title: "AE" }, { title: "PM" }] }), { status: 200 });
      return new Response("nope", { status: 404 });
    });
    try {
      const linked = await findAtsJobs("realco.com", new Map([["/careers", '<a href="https://jobs.ashbyhq.com/acme">Jobs</a>']]));
      expect(linked).toMatchObject({ path: "ashby:acme", jobTitles: ["SRE", "AE", "PM"] });
      expect(linked!.text).toContain("linked from the website");
      const guessed = await findAtsJobs("acme.io", new Map());
      expect(guessed!.text).toContain("guessed from the domain name");
      expect(await findAtsJobs("acmeledger.io", new Map())).toBeNull(); // demo domains never hit the network
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("role ranking with spelled-out titles", () => {
  it("treats 'Vice President of Engineering' like VP Engineering", () => {
    expect(rankRole("Vice President of Engineering").score).toBe(rankRole("VP Engineering").score);
    expect(rankRole("Vice President of Engineering").score).toBeGreaterThan(rankRole("Chief Operating Officer").score);
  });
});

describe("badge images", () => {
  it("a displayed badge image counts as a visible certification; a pending one does not", () => {
    const page = (path: string) => ({ path, url: "", ok: true, status: 200, text: "B2B SaaS platform", jobTitles: [] });
    const shown = analyse("x.com", [page("/security")], new Map([["/security", '<body><img src="/compliance/soc-2.svg"></body>']]), "mock");
    expect(shown.certs.visible).toMatchObject([{ cert: "SOC 2", source: "image" }]);
    const pending = analyse("x.com", [page("/trust")], new Map([["/trust", '<body><img src="/img/iso27001-badge-pending.png"></body>']]), "mock");
    expect(pending.certs.visible).toEqual([]);
    expect(pending.certs.hidden).toMatchObject([{ cert: "ISO 27001", source: "image" }]);
  });
});
