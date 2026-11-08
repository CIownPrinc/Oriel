import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, inArray, is } from "drizzle-orm";
import { SQLiteTable, type SQLiteColumn } from "drizzle-orm/sqlite-core";

process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oriel-export-"));

import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { appendSegment, createMedia, mediaInfo } from "@/lib/privacy/media-store";
import { createInterview, runOpening, runTurn, type RoomEvent } from "@/server/interview/service";
import { enqueueAnalysis, runJob } from "@/server/processing/pipeline";
import { startPractice, submitAttempt } from "@/server/training/service";
import { DATA_INVENTORY, exportUserData } from "@/server/privacy/inventory";
import { deleteAccount } from "@/server/privacy/deletion";
import { updatePrivacySettings } from "@/server/privacy/settings";

const base = { role: "Product Manager", domain: "product", level: "hiring_manager", type: "behavioral" as const, pressure: 2, persona: "skeptic" as const, mode: "single" as const, panelSize: 3, ladderLevel: null, targetMinutes: 15, cameraMetrics: true };

async function drain(gen: AsyncGenerator<RoomEvent>) {
  for await (const e of gen) void e;
}

/** An account with data in as many categories as the product can produce. */
async function populatedUser() {
  const db = getDb();
  const userId = newId("usr");
  await db.insert(schema.users).values({ id: userId, email: `${userId}@oriel.test`, passwordHash: "scrypt$secret-hash", onboardedAt: new Date() }).run();
  await db.insert(schema.authSessions).values({ id: newId("tok"), userId, expiresAt: new Date(Date.now() + 86400_000) }).run();
  await db.insert(schema.profiles).values({ userId, name: "Riley Chen", targetRole: "Product Manager", domain: "product" }).run();
  await db.insert(schema.subscriptions).values({ id: newId("sub"), userId, plan: "pro", periodStart: new Date() }).run();
  await db.insert(schema.ladderProgress).values({ userId, level: 1, unlockedAt: new Date() }).run();
  await db.insert(schema.resumes).values({ id: newId("res"), userId, rawText: "Riley Chen, PM at Contoso", parsed: { name: "Riley Chen", roles: [], skills: [], education: [], achievements: [] } as never }).run();
  await db.insert(schema.consentRecords).values({ id: newId("cns"), userId, kind: "camera_metrics", version: "test", granted: true, textHash: "abc", signature: "Riley Chen", source: "room_consent", userAgent: "Test Browser" }).run();

  const { sessionId } = await createInterview(userId, base);
  await drain(runOpening(sessionId, userId));
  await drain(runTurn(sessionId, userId, { answerText: "In 2024 I led the onboarding relaunch. I ran twelve interviews and activation rose from 31 to 44 percent.", startMs: 1000, endMs: 20000, firstWordLatencyMs: 700, interrupted: false, inputMode: "text", prevQuestion: null }));
  await db.insert(schema.signalTimelines).values({ id: newId("sig"), sessionId, kind: "vision", startMs: 0, samples: [] }).run();
  await db.update(schema.interviewSessions).set({ status: "ended", endedAt: new Date(), startedAt: new Date(Date.now() - 300_000) }).where(eq(schema.interviewSessions.id, sessionId)).run();
  await runJob(await enqueueAnalysis(sessionId));

  const mediaId = newId("med");
  const storageKey = await createMedia(userId, mediaId, "video/webm");
  await appendSegment(userId, mediaId, 0, Buffer.from("video"));
  await db.insert(schema.mediaObjects).values({ id: mediaId, userId, sessionId, kind: "session_recording", mimeType: "video/webm", storageKey, bytes: 5, segments: 1 }).run();

  const loopId = await startPractice(userId, { category: "behavioral" });
  await submitAttempt(userId, loopId, { response: "We shipped it.", inputMode: "text", durationMs: 3000, clientKey: "export-test-1" });
  await db.insert(schema.costRecords).values({ id: newId("cst"), userId, sessionId, category: "analysis", provider: "mock", operation: "export_test", units: 1, unitName: "tokens", usd: 0 }).run();
  return { userId, sessionId, mediaId };
}

const col = (t: SQLiteTable, k: string) => (t as unknown as Record<string, SQLiteColumn | undefined>)[k];

/** Rows in `table` that belong to the user, by the same rule the inventory uses. */
async function ownedRows(table: SQLiteTable, scope: string, userId: string) {
  const db = getDb();
  if (table === schema.users) return db.select().from(schema.users).where(eq(schema.users.id, userId)).all();
  const sessions = (await db.select({ id: schema.interviewSessions.id }).from(schema.interviewSessions).where(eq(schema.interviewSessions.userId, userId)).all()).map((s) => s.id);
  const interviews = (await db.select({ id: schema.interviews.id }).from(schema.interviews).where(eq(schema.interviews.userId, userId)).all()).map((s) => s.id);
  const [key, ids] = scope === "user" ? ["userId", [userId]] : scope === "session" ? ["sessionId", sessions] : ["interviewId", interviews];
  if (!ids.length) return [];
  return db.select().from(table).where(inArray(col(table, key as string)!, ids as string[])).all();
}

describe("FIX-05 · data inventory, export and deletion", () => {
  it("classifies every table in the schema", () => {
    const tables = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable => is(v, SQLiteTable));
    const covered = new Set(Object.values(DATA_INVENTORY).map((e) => e.table));
    const missing = tables.filter((t) => !covered.has(t)).map((t) => (t as unknown as { [k: symbol]: string })[Symbol.for("drizzle:Name")]);
    expect(missing).toEqual([]);
  });

  it("exports every row stored about the person, including training history, without secrets", async () => {
    const { userId } = await populatedUser();
    const exported = await exportUserData(userId);
    for (const [name, entry] of Object.entries(DATA_INVENTORY)) {
      if (entry.scope === "catalog" || entry.scope === "excluded") {
        expect(exported.data[name], name).toBeUndefined();
        continue;
      }
      const stored = await ownedRows(entry.table, entry.scope, userId);
      expect(exported.data[name]?.length, name).toBe(stored.length);
    }
    for (const name of ["trainingLoops", "trainingAttempts", "answers", "questions", "transcriptSegments", "metrics", "consentRecords", "mediaObjects", "resumes"]) {
      expect(exported.data[name]?.length, name).toBeGreaterThan(0);
    }
    const text = JSON.stringify(exported);
    expect(text).not.toContain("scrypt$secret-hash");
    expect(exported.data.authSessions[0]).not.toHaveProperty("id");
    expect(exported.data.mediaObjects[0]).not.toHaveProperty("storageKey");
  });

  it("deletes the account everywhere and keeps consent proof without the name or signature", async () => {
    const { userId, mediaId } = await populatedUser();
    await updatePrivacySettings(userId, { recordVideo: false }, "Test Browser");
    await deleteAccount(userId, "oriel.test");
    for (const [name, entry] of Object.entries(DATA_INVENTORY)) {
      if (entry.scope === "catalog" || entry.scope === "excluded") continue;
      expect((await ownedRows(entry.table, entry.scope, userId)).length, name).toBe(0);
    }
    expect(await mediaInfo(userId, mediaId)).toBeNull();
    const archived = await getDb().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "privacy.consent_archived")).all();
    const mine = archived.filter((a) => a.userId === userId);
    expect(mine.length).toBe(2);
    const text = JSON.stringify(mine);
    expect(text).not.toContain("Riley Chen");
    expect(text).not.toContain("Test Browser");
    expect(mine.map((a) => (a.data as { kind: string }).kind).sort()).toEqual(["camera_metrics", "recording"]);
  });
});
