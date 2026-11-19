import { handle } from "@/lib/http";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const s = (await readStore());
  return {
    threads: s.threads.map((t) => ({
      ...t,
      company: s.companies.find((c) => c.id === t.companyId)?.name ?? "",
      contact: s.contacts.find((c) => c.id === t.contactId) ?? null,
      inbound: s.inbound.filter((m) => m.threadId === t.id),
    })),
    actions: [...s.actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    pendingMockReplies: s.mock.inbox.length,
    outbox: s.mock.outbox.slice(-20).reverse(),
    crm: s.mock.crm.slice(-20).reverse(),
    sends: s.sends.slice(-50).reverse(),
  };
});
