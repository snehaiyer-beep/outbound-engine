import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config";
import type { StoreData } from "./types";

// The whole app state is one JSON document.
// - Locally (no Supabase env): data/store.json.
// - On Vercel: a private Supabase Storage bucket, with a lock object so that a
//   read-modify-write (e.g. checking the send cap and reserving a send) never
//   interleaves with another request, even across serverless instances.

function empty(): StoreData {
  return {
    settings: { killSwitch: { engaged: false }, autoTrip: true, killHistory: [] },
    companies: [],
    contacts: [],
    drafts: [],
    edits: [],
    sends: [],
    threads: [],
    inbound: [],
    actions: [],
    suppression: [],
    mock: { outbox: [], inbox: [], bookings: [], crm: [] },
  };
}

function normalize(parsed: Partial<StoreData>): StoreData {
  const base = empty();
  return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings ?? {}) }, mock: { ...base.mock, ...(parsed.mock ?? {}) } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Backend {
  read(): Promise<StoreData>;
  write(data: StoreData): Promise<void>;
  lock(): Promise<() => Promise<void>>;
}

// ---------- local file ----------
function file(): string {
  return path.resolve(config.dataDir(), "store.json");
}

async function withRetry<T>(fn: () => T): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      return fn();
    } catch (e) {
      last = e;
      await sleep(15 * (i + 1)); // Windows rename-over can briefly lock/empty the file
    }
  }
  throw last;
}

// One server process owns the file. Next.js can load this module several times (one copy per
// route), so the lock and an in-memory copy of the data live on globalThis: every route shares
// them, reads never race a write on disk, and writes are serialized across all routes.
const g = globalThis as unknown as { __oeFile?: { queue: Promise<void>; cache: Map<string, string> } };
const shared = (g.__oeFile ??= { queue: Promise.resolve(), cache: new Map() });

const fileBackend: Backend = {
  async read() {
    const f = file();
    const cached = shared.cache.get(f);
    if (cached !== undefined) return normalize(JSON.parse(cached));
    if (!fs.existsSync(f)) return empty();
    const text = await withRetry(() => {
      const t = fs.readFileSync(f, "utf8");
      JSON.parse(t); // retry if caught mid-write
      return t;
    });
    shared.cache.set(f, text);
    return normalize(JSON.parse(text));
  },
  async write(data) {
    const f = file();
    const text = JSON.stringify(data, null, 2);
    shared.cache.set(f, text);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, text);
    await withRetry(() => fs.renameSync(tmp, f));
  },
  async lock() {
    let release!: () => void;
    const prev = shared.queue;
    shared.queue = new Promise<void>((r) => (release = r));
    await prev;
    return async () => release();
  },
};

// ---------- Supabase Storage ----------
const BUCKET = "outbound-engine";
const STATE = "state.json";
const LOCK = "state.lock";
const LOCK_STALE_MS = 30_000;

function sb(pathname: string, init: RequestInit = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return fetch(`${process.env.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1/${pathname}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${key}`, apikey: key, ...(init.headers ?? {}) },
  });
}

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const res = await sb(`bucket/${BUCKET}`);
  if (!res.ok) {
    const made = await sb("bucket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
    });
    if (!made.ok && !(await made.text()).includes("already exists")) throw new Error(`Supabase bucket: ${made.status}`);
  }
  bucketReady = true;
}

const supabaseBackend: Backend = {
  async read() {
    await ensureBucket();
    const res = await sb(`object/authenticated/${BUCKET}/${STATE}`);
    if (res.status === 400 || res.status === 404) return empty();
    if (!res.ok) throw new Error(`Supabase read ${res.status}`);
    return normalize(await res.json());
  },
  async write(data) {
    const res = await sb(`object/${BUCKET}/${STATE}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-upsert": "true" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase write ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
  async lock() {
    await ensureBucket();
    const token = crypto.randomUUID();
    for (let i = 0; i < 80; i++) {
      // Creating an existing object without x-upsert fails, so only one request can hold the lock.
      const res = await sb(`object/${BUCKET}/${LOCK}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-upsert": "false" },
        body: JSON.stringify({ token, at: Date.now() }),
      });
      if (res.ok) {
        return async () => {
          await sb(`object/${BUCKET}`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prefixes: [LOCK] }),
          });
        };
      }
      const held = await sb(`object/authenticated/${BUCKET}/${LOCK}`);
      if (held.ok) {
        const { at } = (await held.json().catch(() => ({ at: 0 }))) as { at: number };
        if (Date.now() - at > LOCK_STALE_MS)
          await sb(`object/${BUCKET}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: [LOCK] }) });
      }
      await sleep(100 + Math.random() * 150);
    }
    throw new Error("Could not acquire the data lock; try again");
  },
};

export function storeBackend(): "supabase" | "file" {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "file";
}
const backend = () => (storeBackend() === "supabase" ? supabaseBackend : fileBackend);

export async function readStore(): Promise<StoreData> {
  return backend().read();
}

/** Locked read-modify-write. `fn` must be synchronous; if it throws, nothing is written. */
export async function mutate<T>(fn: (s: StoreData) => T): Promise<T> {
  const b = backend();
  const release = await b.lock();
  try {
    const s = await b.read();
    const out = fn(s);
    await b.write(s);
    return out;
  } finally {
    await release();
  }
}

export async function resetStore(): Promise<void> {
  const b = backend();
  const release = await b.lock();
  try {
    await b.write(empty());
  } finally {
    await release();
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function now(): string {
  return new Date().toISOString();
}
