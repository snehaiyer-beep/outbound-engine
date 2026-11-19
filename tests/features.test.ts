import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshEnv } from "./helpers";
import { mutate, readStore } from "@/lib/store";
import { processDomain, runPipeline } from "@/lib/pipeline/run";
import { approveAndSend, decideCompany, rejectDraft } from "@/lib/drafts";
import { fitScore } from "@/lib/pipeline/score";
import { killMetrics, setKill, StoppedError } from "@/lib/safety/kill";
import { sendEmail } from "@/lib/safety/outbox";
import { looksLikeCompany, parseLeadLines, readListPage, searchLeads } from "@/lib/pipeline/discover";

beforeEach(async () => {
  await freshEnv();
});

describe("needs review (agent hands undecided companies to a person)", () => {
  it("only-undecided → needs_review, with no contacts looked up", async () => {
    const c = await processDomain("quietledger.io");
    expect(c.status).toBe("needs_review");
    expect(c.qualification!.undecided).toEqual(["employees_20_plus"]);
    expect((await readStore()).contacts).toHaveLength(0);
  });
  it("a clear 'no' still disqualifies", async () => {
    expect((await processDomain("tinytask.app")).status).toBe("disqualified");
  });
  it("a person can qualify it: contacts and drafts are then prepared", async () => {
    const c = await processDomain("quietledger.io");
    await decideCompany(c.id, "qualify", "I know they have ~40 people");
    const s = await readStore();
    const co = s.companies[0];
    expect(co).toMatchObject({ status: "qualified", decidedBy: "human", decisionNote: "I know they have ~40 people" });
    expect(s.contacts).toHaveLength(1);
    expect(s.drafts).toHaveLength(1);
    expect(co.fit!.score).toBeGreaterThan(50);
  });
  it("or disqualify it", async () => {
    const c = await processDomain("quietledger.io");
    await decideCompany(c.id, "disqualify", "");
    expect((await readStore()).companies[0].status).toBe("disqualified");
  });
});

describe("fit score", () => {
  it("explains every point and ranks the audit-in-progress company high", async () => {
    const [acme] = await runPipeline(["acmeledger.io"]);
    const f = fitScore(acme);
    expect(f.score).toBe(95);
    expect(f.reasons.join(" ")).toMatch(/audit is in progress/);
    expect(acme.fit!.score).toBe(95);
    expect(acme.description).toMatch(/Accounting automation/);
  });
});

describe("kill switch", () => {
  const send = {
    kind: "cold" as const,
    companyId: "c",
    contactId: "k",
    intendedTo: "x@y.com",
    approval: { by: "human" as const },
    subject: "s",
    body: "b",
    threadId: "t",
  };
  it("blocks sending and pipeline runs until a person releases it", async () => {
    await mutate((s) => setKill(s, true, "testing"));
    await expect(sendEmail(send)).rejects.toThrow(/kill switch/);
    await expect(processDomain("acmeledger.io")).rejects.toBeInstanceOf(StoppedError);
    expect((await readStore()).mock.outbox).toHaveLength(0);
    await mutate((s) => setKill(s, false, "done"));
    await expect(sendEmail(send)).resolves.toMatchObject({ actualTo: "me@example.com" });
    expect((await readStore()).settings.killHistory.map((h) => h.action)).toEqual(["engaged", "released"]);
  });
  it("trips automatically when contact accuracy falls under 60% (after 10+ reviews)", async () => {
    await runPipeline(["acmeledger.io", "orbitops.dev"]);
    const drafts = (await readStore()).drafts; // 7 drafts
    for (const d of drafts.slice(0, 6)) await rejectDraft(d.id, "", "Wrong contact", 30);
    expect((await readStore()).settings.killSwitch.engaged).toBe(false); // 6 samples, needs 10
    await mutate((st) => {
      for (let i = 0; i < 3; i++) st.drafts.push({ ...st.drafts[0], id: `x${i}`, status: "rejected", rejectCategory: "Wrong contact" });
    });
    await rejectDraft(drafts[6].id, "", "Wrong contact");
    const s = await readStore();
    expect(s.settings.killSwitch).toMatchObject({ engaged: true, by: "auto" });
    expect(s.settings.killSwitch.reason).toMatch(/Right person picked/);
  });
  it("measures rewrites, reject reasons and review time", async () => {
    await runPipeline(["acmeledger.io"]);
    const [d1, d2] = (await readStore()).drafts;
    await approveAndSend(d1.id, { subject: d1.subject, body: d1.body }, 90);
    await rejectDraft(d2.id, "Sounds like a robot", "Too generic", 30);
    const m = killMetrics(await readStore());
    expect(m.find((x) => x.key === "rewrite")!.explain).toMatch(/^1 of 2/);
    expect(m.find((x) => x.key === "review")!.display).toBe("2.0 min");
    expect((await readStore()).drafts.find((d) => d.id === d2.id)).toMatchObject({
      rejectCategory: "Too generic",
      rejectReason: "Too generic: Sounds like a robot",
    });
  });
});

describe("finding leads", () => {
  it("filters out social, news and directory sites", () => {
    expect(looksLikeCompany("acme.io")).toBe(true);
    expect(looksLikeCompany("linkedin.com")).toBe(false);
    expect(looksLikeCompany("blog.techcrunch.com")).toBe(false);
    expect(looksLikeCompany("cdn.topstartups.io", ["topstartups.io"])).toBe(false);
  });
  it("parses 'domain | name | what' lines from a search answer", () => {
    const leads = parseLeadLines("1. **acme.io** | Acme | Payroll API for startups\n- linkedin.com | nope | x\nwidgets.dev | Widgets | Dev tools", "search: x");
    expect(leads.map((l) => l.domain)).toEqual(["acme.io", "widgets.dev"]);
    expect(leads[0]).toMatchObject({ name: "Acme", note: "Payroll API for startups" });
  });
  it("practice mode search returns the practice companies", async () => {
    const r = await searchLeads(["fintech SaaS series A"]);
    expect(r.leads.length).toBeGreaterThan(3);
  });
  it("reads company links from a list page and refuses private addresses", async () => {
    process.env.OFFLINE = "false";
    vi.stubGlobal("fetch", async () =>
      new Response(
        `<ul><li><a href="https://acme.io">Acme</a> Payroll API</li><li><a href="https://twitter.com/x">tw</a></li>
         <li><a href="https://list.example/about">About</a></li><li><a href="https://www.widgets.dev/pricing">Widgets</a></li></ul>`,
        { status: 200 },
      ),
    );
    try {
      const r = await readListPage("https://list.example/startups");
      expect(r.leads.map((l) => l.domain)).toEqual(["acme.io", "widgets.dev"]);
      await expect(readListPage("http://localhost:3000")).rejects.toThrow(/public/);
      await expect(readListPage("http://127.0.0.1/")).rejects.toThrow(/public/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
