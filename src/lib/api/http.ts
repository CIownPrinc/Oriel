import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type { z } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { sharedRateLimit } from "@/lib/security/shared-limits";

import { HttpError } from "./errors";
export { HttpError };

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "validation");
  return parsed.data;
}

type Handler<C> = (req: Request, ctx: C & { user: CurrentUser }) => Promise<Response>;

/**
 * Wrap an authenticated route handler: auth, per-user rate limiting, uniform errors.
 * `limit` is requests per minute for this route for this user. `shared` keeps the count in the
 * database so it holds across server instances: use it for routes that spend money on AI calls.
 */
export function authed<C>(handler: Handler<C>, opts: { limit?: number; name?: string; admin?: boolean; shared?: boolean } = {}) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      // Defence in depth on top of SameSite cookies: mutating requests must come from our own origin.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== new URL(req.url).host && origin !== process.env.ORIEL_PUBLIC_ORIGIN) {
          return json({ error: "Cross-origin request refused" }, { status: 403 });
        }
      }
      const user = await getCurrentUser();
      if (!user) return json({ error: "Not signed in" }, { status: 401 });
      if (opts.admin && user.role !== "admin") return json({ error: "Forbidden" }, { status: 403 });
      const key = `${opts.name ?? new URL(req.url).pathname}:${user.id}`;
      const rl = opts.shared ? await sharedRateLimit(key, opts.limit ?? 60, 60_000) : rateLimit(key, opts.limit ?? 60, 60_000);
      if (!rl.ok) return json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } });
      return await handler(req, { ...ctx, user });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message, code: err.code }, { status: err.status });
  console.error("[api] unhandled", err);
  return json({ error: "Something went wrong" }, { status: 500 });
}

/** Stream an async generator of events as newline-delimited JSON. */
export function ndjson<T>(gen: AsyncGenerator<T>, onError?: (err: unknown) => T): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) return controller.close();
        controller.enqueue(enc.encode(JSON.stringify(value) + "\n"));
      } catch (err) {
        if (onError) controller.enqueue(enc.encode(JSON.stringify(onError(err)) + "\n"));
        controller.close();
      }
    },
    async cancel() {
      await gen.return(undefined as never);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

export type IdParams = { params: Promise<{ id: string }> };
