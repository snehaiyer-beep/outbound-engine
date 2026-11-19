import { NextResponse } from "next/server";
import { HttpError } from "./drafts";
import { StoppedError } from "./safety/kill";

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown> | unknown) {
  return async (...args: A) => {
    try {
      const data = await fn(...args);
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      if (e instanceof StoppedError) return NextResponse.json({ error: e.message, stopped: true }, { status: 423 });
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

export type IdCtx = { params: Promise<{ id: string }> };
