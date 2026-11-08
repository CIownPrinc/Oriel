import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { assertWithinDailyCost, dailyCostLimitUsd, pruneRateLimits, sharedRateLimit } from "@/lib/security/shared-limits";

/*
 * FIX-09: limits that hold across instances, and a daily ceiling on AI spend per person.
 * "Another instance" is simulated by clearing the in-memory limiter between calls: the shared
 * limit lives in the database, so it must not care.
 */

describe("FIX-09 · shared rate limits", () => {
  it("counts requests across instances", async () => {
    const key = `test:${newId("k")}`;
    for (let i = 0; i < 3; i++) {
      resetRateLimits();
      expect((await sharedRateLimit(key, 3, 60_000)).ok).toBe(true);
    }
    resetRateLimits();
    const over = await sharedRateLimit(key, 3, 60_000);
    expect(over.ok).toBe(false);
    expect(over.retryAfterMs).toBeGreaterThan(0);
  });

  it("starts a new window once the old one has passed", async () => {
    const key = `test:${newId("k")}`;
    const t0 = Date.now();
    await sharedRateLimit(key, 1, 1000, t0);
    expect((await sharedRateLimit(key, 1, 1000, t0 + 10)).ok).toBe(false);
    expect((await sharedRateLimit(key, 1, 1000, t0 + 1000)).ok).toBe(true);
  });

  it("holds under concurrent requests", async () => {
    const key = `test:${newId("k")}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => sharedRateLimit(key, 4, 60_000)));
    expect(results.filter((r) => r.ok)).toHaveLength(4);
  });

  it("prunes counters from long-finished windows", async () => {
    const key = `test:${newId("k")}`;
    await sharedRateLimit(key, 5, 1000, Date.now() - 3 * 86_400_000);
    await pruneRateLimits();
    expect(await getDb().select().from(schema.rateLimits).where(eq(schema.rateLimits.key, key)).get()).toBeUndefined();
  });
});

describe("FIX-09 · daily AI cost ceiling", () => {
  async function userWithSpend(usd: number, at = new Date()) {
    const id = newId("usr");
    await getDb().insert(schema.users).values({ id, email: `${id}@oriel.test`, passwordHash: "x" }).run();
    await getDb().insert(schema.costRecords).values({ id: newId("cst"), userId: id, provider: "test", category: "llm", operation: "test", units: 1, unitName: "calls", usd, createdAt: at }).run();
    return id;
  }

  it("allows work under the limit", async () => {
    await expect(assertWithinDailyCost(await userWithSpend(dailyCostLimitUsd() / 2))).resolves.toBeUndefined();
  });

  it("refuses new AI work at the limit, with a clear message", async () => {
    await expect(assertWithinDailyCost(await userWithSpend(dailyCostLimitUsd()))).rejects.toMatchObject({ status: 429, code: "daily_cost_limit" });
  });

  it("only counts the last 24 hours", async () => {
    const id = await userWithSpend(dailyCostLimitUsd() * 3, new Date(Date.now() - 2 * 86_400_000));
    await expect(assertWithinDailyCost(id)).resolves.toBeUndefined();
  });
});
