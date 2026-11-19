import { handle } from "@/lib/http";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const s = (await readStore());
  return s.companies
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => {
      const drafts = s.drafts.filter((d) => d.companyId === c.id);
      const thread = s.threads.find((t) => t.companyId === c.id);
      return {
        id: c.id,
        domain: c.domain,
        name: c.name,
        status: c.status,
        error: c.error,
        rules: c.qualification?.rules ?? null,
        disqualifyReasons: c.qualification?.disqualifyReasons ?? [],
        certs: [...(c.scrape?.certs.visible ?? []), ...(c.scrape?.certs.hidden ?? [])].map((h) => `${h.cert} (${h.source})`),
        openRoles: c.scrape?.openRoles ?? 0,
        contacts: s.contacts.filter((x) => x.companyId === c.id).length,
        draftsPending: drafts.filter((d) => d.status === "draft").length,
        sent: drafts.some((d) => d.status === "sent"),
        threadStatus: thread?.status ?? null,
        employeeHint: c.scrape?.employeeHint ?? null,
        description: c.description ?? c.scrape?.description ?? "",
        fit: c.fit ?? null,
        undecided: c.qualification?.undecided ?? [],
        decidedBy: c.decidedBy ?? null,
        posture: !c.scrape ? "unknown" : c.scrape.certs.visible.length ? "shown" : c.scrape.certs.hidden.length ? "hint" : "none",
        certNames: [...new Set([...(c.scrape?.certs.visible ?? []), ...(c.scrape?.certs.hidden ?? [])].map((h) => h.cert))],
        topContact: (() => {
          const top = s.contacts.filter((x) => x.companyId === c.id).sort((a, b) => b.rankScore - a.rankScore)[0];
          return top ? { name: top.name, position: top.position } : null;
        })(),
        createdAt: c.createdAt,
      };
    });
});
