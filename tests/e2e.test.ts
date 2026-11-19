import { beforeEach, describe, expect, it } from "vitest";
import { freshEnv } from "./helpers";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { readStore } from "@/lib/store";
import { UNSUBSCRIBE_LINE } from "@/lib/safety/gates";
import { POST as runRoute } from "@/app/api/pipeline/run/route";
import { GET as companiesRoute } from "@/app/api/companies/route";
import { POST as approveRoute } from "@/app/api/drafts/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/drafts/[id]/reject/route";
import { PUT as saveRoute } from "@/app/api/drafts/[id]/route";
import { POST as simulateRoute } from "@/app/api/replies/simulate/route";
import { POST as checkRoute } from "@/app/api/replies/check/route";
import { POST as actionApproveRoute } from "@/app/api/actions/[id]/approve/route";

const H = { host: "localhost:3000", authorization: "Bearer test-token-123456", "content-type": "application/json" };
const req = (path: string, method = "GET", json?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: H, body: json === undefined ? undefined : JSON.stringify(json) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (r: NextRequest, c: any) => Promise<Response>;
async function call(handler: AnyHandler, r: NextRequest, c?: unknown) {
  expect(middleware(r).status).toBe(200); // every call goes through the token check first
  const res = await handler(r, c);
  return { status: res.status, data: await res.json() };
}

beforeEach(async () => {
  await freshEnv();
});

describe("end-to-end on mock data, through the API routes", () => {
  it("domains → qualified → drafts → approve & send → reply → slots → booking → CRM", async () => {
    const domains = ["acmeledger.io", "orbitops.dev", "vaultly.com", "brewbox.shop", "tinytask.app", "medsync.health"];
    const run = await call(runRoute, req("/api/pipeline/run", "POST", domains));
    expect(run.status).toBe(200);

    const companies = (await call(companiesRoute, req("/api/companies"))).data as { domain: string; status: string; disqualifyReasons: string[] }[];
    const by = Object.fromEntries(companies.map((c) => [c.domain, c]));
    expect(by["acmeledger.io"].status).toBe("qualified");
    expect(by["orbitops.dev"].status).toBe("qualified");
    for (const d of ["vaultly.com", "brewbox.shop", "tinytask.app", "medsync.health"]) {
      expect(by[d].status).toBe("disqualified");
      expect(by[d].disqualifyReasons.length).toBeGreaterThan(0);
    }

    let s = (await readStore());
    const acme = s.companies.find((c) => c.domain === "acmeledger.io")!;
    const acmeContacts = s.contacts.filter((c) => c.companyId === acme.id).sort((a, b) => b.rankScore - a.rankScore);
    const top = acmeContacts[0];
    expect(top.position).toBe("Head of Security");
    const draft = s.drafts.find((d) => d.contactId === top.id)!;

    // Nothing has been sent by the pipeline.
    expect(s.sends).toHaveLength(0);
    expect(s.mock.outbox).toHaveLength(0);

    // Without confirm:true the approve route refuses.
    expect((await call(approveRoute, req(`/api/drafts/${draft.id}/approve`, "POST", { subject: draft.subject, body: draft.body }), ctx(draft.id))).status).toBe(400);

    // A draft that breaks the rules cannot be sent.
    const flattering = draft.body.replace(/^Hi Priya,\n\n/, "Hi Priya,\n\nAmazing product! ");
    const bad = await call(approveRoute, req(`/api/drafts/${draft.id}/approve`, "POST", { subject: draft.subject, body: flattering, confirm: true }), ctx(draft.id));
    expect(bad.status).toBe(422);

    // Human edits then approves.
    const edited = draft.body.replace("Open to a 15-minute call next week to see if it fits?", "Worth a 15-minute call next week?");
    await call(saveRoute, req(`/api/drafts/${draft.id}`, "PUT", { subject: draft.subject, body: edited }), ctx(draft.id));
    const sent = await call(approveRoute, req(`/api/drafts/${draft.id}/approve`, "POST", { subject: draft.subject, body: edited, confirm: true }), ctx(draft.id));
    expect(sent.status).toBe(200);
    expect(sent.data.actualTo).toBe("me@example.com");

    s = (await readStore());
    expect(s.mock.outbox).toHaveLength(1);
    expect(s.mock.outbox[0].to).toBe("me@example.com");
    expect(s.mock.outbox[0].text).toContain("Worth a 15-minute call");
    expect(s.mock.outbox[0].text).toContain(UNSUBSCRIBE_LINE);
    expect(s.edits.some((e) => e.kind === "edit" && e.after?.body === edited)).toBe(true);

    // A second contact at the same company is blocked (one per company).
    const second = s.drafts.find((d) => d.contactId === acmeContacts[1].id)!;
    const blocked = await call(approveRoute, req(`/api/drafts/${second.id}/approve`, "POST", { subject: second.subject, body: second.body, confirm: true }), ctx(second.id));
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.data)).toMatch(/one per company/);
    // ...and a human rejects it with a reason.
    expect((await call(rejectRoute, req(`/api/drafts/${second.id}/reject`, "POST", { reason: "Already in touch with security lead" }), ctx(second.id))).status).toBe(200);

    // Reply: interested → slot proposal queued, waits for approval.
    const thread = (await readStore()).threads[0];
    await call(simulateRoute, req("/api/replies/simulate", "POST", { threadId: thread.id, body: "Thanks, this is timely. Happy to chat." }));
    await call(checkRoute, req("/api/replies/check", "POST"));
    s = (await readStore());
    expect(s.inbound[0].classification!.category).toBe("interested");
    const propose = s.actions.find((a) => a.status === "pending")!;
    expect(propose.type).toBe("send_email");
    expect(s.mock.outbox).toHaveLength(1);

    await call(actionApproveRoute, req(`/api/actions/${propose.id}/approve`, "POST"), ctx(propose.id));
    s = (await readStore());
    expect(s.threads[0].status).toBe("slots_proposed");
    expect(s.threads[0].proposedSlots).toHaveLength(3);
    expect(s.mock.outbox).toHaveLength(2);
    expect(s.mock.outbox[1].headers["In-Reply-To"]).toBe(s.threads[0].messageIds[0]);

    // Reply: asks for another time → 3 new slots.
    await call(simulateRoute, req("/api/replies/simulate", "POST", { threadId: thread.id, body: "None of those work, can we do next week?" }));
    await call(checkRoute, req("/api/replies/check", "POST"));
    s = (await readStore());
    expect(s.inbound[1].classification!.category).toBe("asks_other_time");
    const repropose = s.actions.find((a) => a.status === "pending")!;
    const firstSlots = s.threads[0].proposedSlots;
    await call(actionApproveRoute, req(`/api/actions/${repropose.id}/approve`, "POST"), ctx(repropose.id));
    s = (await readStore());
    const newSlots = s.threads[0].proposedSlots;
    expect(newSlots.some((n) => firstSlots.some((f) => f.start === n.start))).toBe(false);

    // Reply: picks option 2 → booking queued → approve → booked + confirmation + CRM action.
    await call(simulateRoute, req("/api/replies/simulate", "POST", { threadId: thread.id, body: "Option 2 works for me." }));
    await call(checkRoute, req("/api/replies/check", "POST"));
    s = (await readStore());
    expect(s.inbound[2].classification!.category).toBe("confirms_time");
    const book = s.actions.find((a) => a.status === "pending" && a.type === "book_meeting")!;
    await call(actionApproveRoute, req(`/api/actions/${book.id}/approve`, "POST"), ctx(book.id));
    s = (await readStore());
    expect(s.threads[0].status).toBe("booked");
    expect(s.threads[0].booking!.slot.start).toBe(newSlots[1].start);
    expect(s.mock.bookings).toHaveLength(1);
    expect(s.mock.outbox.at(-1)!.text).toContain(`Confirmed for ${newSlots[1].label}`);

    const crm = s.actions.find((a) => a.status === "pending" && a.type === "crm_log")!;
    await call(actionApproveRoute, req(`/api/actions/${crm.id}/approve`, "POST"), ctx(crm.id));
    s = (await readStore());
    expect(s.mock.crm).toHaveLength(1);
    expect(s.mock.crm[0]).toMatchObject({ outcome: "meeting_booked", email: "priya@acmeledger.io" });

    // Every email went to TEST_RECIPIENT and carried the unsubscribe line.
    for (const m of s.mock.outbox) {
      expect(m.to).toBe("me@example.com");
      expect(m.text).toContain(UNSUBSCRIBE_LINE);
    }
  });

  it("rejects API calls without the token", () => {
    const r = new NextRequest("http://localhost:3000/api/pipeline/run", { method: "POST", headers: { host: "localhost:3000" } });
    expect(middleware(r).status).toBe(401);
  });
});
