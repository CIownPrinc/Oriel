import "server-only";
import { and, gt, lt, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { HttpError } from "@/lib/api/errors";

/**
 * Rate limits that hold across server instances, kept in the database. One atomic upsert per
 * check: the row's window restarts when it has passed, otherwise its count goes up. Used for
 * the routes that cost money (AI calls) and for sign-in, where per-instance limits are too loose.
 */
export async function sharedRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<{ ok: boolean; retryAfterMs: number }> {
  const t = schema.rateLimits;
  const expired = sql`${t.windowStart} <= ${now - windowMs}`;
  const [row] = await getDb().insert(t).values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${t.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN ${now} ELSE ${t.windowStart} END`,
      },
    })
    .returning({ count: t.count, windowStart: t.windowStart });
  return row.count <= limit ? { ok: true, retryAfterMs: 0 } : { ok: false, retryAfterMs: Math.max(0, row.windowStart + windowMs - now) };
}

/** Remove counters whose window ended over a day ago (the scheduled cleanup calls this). */
export async function pruneRateLimits(now = Date.now()): Promise<number> {
  const r = await getDb().delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, now - 86_400_000)).run();
  return r.rowsAffected;
}

/** Default daily AI spend per person; generous for practice, a ceiling for abuse or a runaway loop. */
const DEFAULT_DAILY_COST_USD = 5;

export function dailyCostLimitUsd(): number {
  const v = Number(process.env.ORIEL_DAILY_COST_LIMIT_USD);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_COST_USD;
}

/** Refuse to start more AI work for someone whose spend over the last 24 hours is at the limit. */
export async function assertWithinDailyCost(userId: string, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - 86_400_000);
  const row = await getDb().select({ usd: sql<number>`coalesce(sum(${schema.costRecords.usd}), 0)` }).from(schema.costRecords)
    .where(and(eq(schema.costRecords.userId, userId), gt(schema.costRecords.createdAt, since))).get();
  if ((row?.usd ?? 0) >= dailyCostLimitUsd()) {
    throw new HttpError(429, "You've reached today's practice limit. It resets within 24 hours, and everything you've done is saved.", "daily_cost_limit");
  }
}
