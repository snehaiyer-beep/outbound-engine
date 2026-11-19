import { config } from "../config";
import { mutate, newId, now } from "../store";

export interface CrmLogInput {
  email: string;
  company: string;
  outcome: string;
  note: string;
}

export interface Crm {
  name: "hubspot" | "mock";
  log(entry: CrmLogInput): Promise<{ id: string }>;
}

const mockCrm: Crm = {
  name: "mock",
  async log(entry) {
    return mutate((s) => {
      const id = newId("crm");
      s.mock.crm.push({ id, at: now(), ...entry });
      return { id };
    });
  },
};

const hubspot: Crm = {
  name: "hubspot",
  async log(entry) {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.hubspotToken()}`, "content-type": "application/json" },
      body: JSON.stringify({
        properties: {
          hs_timestamp: now(),
          hs_note_body: `[Outbound Engine] ${entry.company} / ${entry.email}: ${entry.outcome}. ${entry.note}`,
        },
      }),
    });
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { id: string };
    return { id: data.id };
  },
};

export function getCrm(): Crm {
  return config.hubspotToken() ? hubspot : mockCrm;
}
