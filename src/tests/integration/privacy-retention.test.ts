import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oriel-retention-"));

// Route handlers read the signed-in user from cookies; tests choose the user directly.
const currentUser = vi.hoisted(() => ({ value: null as null | { id: string; email: string; role: "user" | "admin" } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value, createSession: async () => undefined }));

// Lets a test make storage deletes fail, to check that cleanup retries instead of lying.
const storage = vi.hoisted(() => ({ failDeletes: false }));
vi.mock("@/lib/privacy/media-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/privacy/media-store")>();
  return {
    ...real,
    deleteMedia: async (userId: string, mediaId: string) => {
      if (storage.failDeletes) throw new Error("storage unavailable");
      return real.deleteMedia(userId, mediaId);
    },
  };
});

import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { appendSegment, createMedia, mediaInfo } from "@/lib/privacy/media-store";
import { createInterview } from "@/server/interview/service";
import { registerAccount, setAccountRole } from "@/server/accounts";
import { updatePrivacySettings } from "@/server/privacy/settings";
import { CLEANUP_LEASE_MS, DAY_MS, runScheduledCleanup, sweepExpiredMedia } from "@/server/privacy/retention";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { POST as postSignals } from "@/app/api/sessions/[id]/signals/route";
import { GET as cronCleanup } from "@/app/api/cron/cleanup/route";
import { POST as postResume } from "@/app/api/resume/route";

const base = { role: "Product Manager", domain: "product", level: "hiring_manager", type: "behavioral" as const, pressure: 2, persona: "skeptic" as const, mode: "single" as const, panelSize: 3, ladderLevel: null, targetMinutes: 15, cameraMetrics: true };

async function makeUser() {
  const db = getDb();
  const id = newId("usr");
  const email = `${id}@oriel.test`;
  await db.insert(schema.users).values({ id, email, passwordHash: "x", onboardedAt: new Date() }).run();
  await db.insert(schema.profiles).values({ userId: id, name: "Sam Rivera", targetRole: "Product Manager", domain: "product" }).run();
  await db.insert(schema.subscriptions).values({ id: newId("sub"), userId: id, plan: "pro", periodStart: new Date() }).run();
  await db.insert(schema.ladderProgress).values({ userId: id, level: 1, unlockedAt: new Date() }).run();
  return { id, email };
}

async function sessionWithData(userId: string) {
  const db = getDb();
  const { sessionId } = await createInterview(userId, base);
  for (const kind of ["audio", "vision", "setup"] as const) {
    await db.insert(schema.signalTimelines).values({ id: newId("sig"), sessionId, kind, startMs: 0, samples: [] }).run();
  }
  const session = (await db.select().from(schema.interviewSessions).where(eq(schema.interviewSessions.id, sessionId)).get())!;
  const mediaId = newId("med");
  const storageKey = await createMedia(userId, mediaId, "video/webm");
  await appendSegment(userId, mediaId, 0, Buffer.from("recording bytes"));
  await db.insert(schema.mediaObjects).values({ id: mediaId, userId, sessionId, kind: "session_recording", mimeType: "video/webm", storageKey, bytes: 15, segments: 1, expiresAt: session.videoExpiresAt }).run();
  return { sessionId, mediaId, createdAt: session.createdAt };
}

const loadSession = (id: string) => getDb().select().from(schema.interviewSessions).where(eq(schema.interviewSessions.id, id)).get();
const loadMedia = (id: string) => getDb().select().from(schema.mediaObjects).where(eq(schema.mediaObjects.id, id)).get();
const signalKinds = async (sessionId: string) =>
  (await getDb().select({ kind: schema.signalTimelines.kind }).from(schema.signalTimelines).where(eq(schema.signalTimelines.sessionId, sessionId)).all()).map((r) => r.kind).sort();

function signalRequest(sessionId: string, kind: "audio" | "vision") {
  const samples = kind === "audio"
    ? [{ t: 0, rms: 0.1, voiced: true, pitch: 120 }]
    : [{ t: 0, face: true, engaged: 0.8, yaw: 0, pitch: 0, lean: 0, slouch: 0, sway: 0, motion: 0, brightness: 0.5 }];
  const req = new Request(`http://localhost/api/sessions/${sessionId}/signals`, { method: "POST", body: JSON.stringify({ kind, startMs: 0, samples }) });
  return postSignals(req, { params: Promise.resolve({ id: sessionId }) });
}

async function clearCleanupRuns() {
  await getDb().delete(schema.cleanupRuns).run();
}

beforeEach(() => {
  resetRateLimits();
  storage.failDeletes = false;
  currentUser.value = null;
  delete process.env.ORIEL_ADMIN_EMAILS;
});

describe("FIX-01 · signup never grants admin", () => {
  it("creates a regular user even when the email is on the old admin allowlist", async () => {
    process.env.ORIEL_ADMIN_EMAILS = "boss@oriel.test";
    const id = await registerAccount("boss@oriel.test", "long enough password", null);
    const user = await getDb().select().from(schema.users).where(eq(schema.users.id, id)).get();
    expect(user!.role).toBe("user");
  });

  it("refuses a second account with the same email", async () => {
    await registerAccount("twice@oriel.test", "long enough password", null);
    await expect(registerAccount("twice@oriel.test", "another password", null)).rejects.toMatchObject({ status: 409 });
  });

  it("provisions an admin through the operator path and signs them out so the role applies", async () => {
    const id = await registerAccount("ops@oriel.test", "long enough password", null);
    await getDb().insert(schema.authSessions).values({ id: newId("ses"), userId: id, expiresAt: new Date(Date.now() + DAY_MS) }).run();
    expect(await setAccountRole("OPS@oriel.test", "admin")).toBe(true);
    expect((await getDb().select().from(schema.users).where(eq(schema.users.id, id)).get())!.role).toBe("admin");
    expect(await getDb().select().from(schema.authSessions).where(eq(schema.authSessions.userId, id)).all()).toHaveLength(0);
    expect(await setAccountRole("nobody@oriel.test", "admin")).toBe(false);
  });
});

describe("FIX-02 · withdrawing camera consent", () => {
  it("turns camera metrics off on existing sessions and deletes camera-derived timelines, keeping audio", async () => {
    const { id: userId } = await makeUser();
    const { sessionId } = await sessionWithData(userId);
    await updatePrivacySettings(userId, { cameraMetricsEnabled: false }, null);
    expect((await loadSession(sessionId))!.cameraMetricsEnabled).toBe(false);
    expect(await signalKinds(sessionId)).toEqual(["audio"]);
  });

  it("drops camera samples that arrive after withdrawal (e.g. queued in an open tab)", async () => {
    const user = await makeUser();
    const { sessionId } = await sessionWithData(user.id);
    await updatePrivacySettings(user.id, { cameraMetricsEnabled: false }, null);
    currentUser.value = { ...user, role: "user" };
    const res = await signalRequest(sessionId, "vision");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "camera metrics disabled" });
    expect(await signalKinds(sessionId)).toEqual(["audio"]);
  });

  it("starts new sessions with camera metrics off after withdrawal", async () => {
    const { id: userId } = await makeUser();
    await updatePrivacySettings(userId, { cameraMetricsEnabled: false }, null);
    const { sessionId } = await createInterview(userId, base);
    expect((await loadSession(sessionId))!.cameraMetricsEnabled).toBe(false);
  });

  it("logs the withdrawal as a consent record", async () => {
    const { id: userId } = await makeUser();
    await updatePrivacySettings(userId, { cameraMetricsEnabled: false }, "test-agent");
    const records = await getDb().select().from(schema.consentRecords).where(eq(schema.consentRecords.userId, userId)).all();
    expect(records).toEqual([expect.objectContaining({ kind: "camera_metrics", granted: false, source: "settings" })]);
  });
});

describe("FIX-03 · one retention deadline for recordings and signals", () => {
  it.each([1, 7, 30] as const)("shortening to %i day(s) moves the session and recording deadlines together", async (days) => {
    const { id: userId } = await makeUser();
    await updatePrivacySettings(userId, { videoRetentionDays: 90 }, null);
    const { sessionId, mediaId, createdAt } = await sessionWithData(userId);
    await updatePrivacySettings(userId, { videoRetentionDays: days }, null);
    const expected = createdAt.getTime() + days * DAY_MS;
    expect((await loadSession(sessionId))!.videoExpiresAt!.getTime()).toBe(expected);
    expect((await loadMedia(mediaId))!.expiresAt!.getTime()).toBe(expected);
  });

  it("applies to sessions without a recording", async () => {
    const { id: userId } = await makeUser();
    const { sessionId } = await createInterview(userId, base);
    const createdAt = (await loadSession(sessionId))!.createdAt;
    await updatePrivacySettings(userId, { videoRetentionDays: 1 }, null);
    expect((await loadSession(sessionId))!.videoExpiresAt!.getTime()).toBe(createdAt.getTime() + DAY_MS);
  });

  it("never extends a deadline that was already shorter", async () => {
    const { id: userId } = await makeUser();
    await updatePrivacySettings(userId, { videoRetentionDays: 1 }, null);
    const { sessionId, createdAt } = await sessionWithData(userId);
    await updatePrivacySettings(userId, { videoRetentionDays: 90 }, null);
    expect((await loadSession(sessionId))!.videoExpiresAt!.getTime()).toBe(createdAt.getTime() + DAY_MS);
  });

  it("deletes the recording and every signal timeline once the shortened deadline arrives, not before", async () => {
    const { id: userId } = await makeUser();
    const { sessionId, mediaId, createdAt } = await sessionWithData(userId);
    await updatePrivacySettings(userId, { videoRetentionDays: 1 }, null);
    const deadline = createdAt.getTime() + DAY_MS;

    await sweepExpiredMedia(new Date(deadline - 1));
    expect((await loadMedia(mediaId))!.status).not.toBe("deleted");
    expect(await signalKinds(sessionId)).toEqual(["audio", "setup", "vision"]);

    const r = await sweepExpiredMedia(new Date(deadline));
    expect(r.failures).toEqual([]);
    expect((await loadMedia(mediaId))!.status).toBe("deleted");
    expect(await mediaInfo(userId, mediaId)).toBeNull();
    expect(await signalKinds(sessionId)).toEqual([]);
  });

  it("refuses new signals once a session is past its deadline", async () => {
    const user = await makeUser();
    const { sessionId } = await sessionWithData(user.id);
    await getDb().update(schema.interviewSessions).set({ videoExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.interviewSessions.id, sessionId)).run();
    currentUser.value = { ...user, role: "user" };
    const res = await signalRequest(sessionId, "audio");
    expect(res.status).toBe(410);
  });
});

describe("FIX-04 · scheduled cleanup", () => {
  beforeEach(clearCleanupRuns);

  it("records each run with what it deleted", async () => {
    const { id: userId } = await makeUser();
    const { mediaId } = await sessionWithData(userId);
    await updatePrivacySettings(userId, { videoRetentionDays: 1 }, null);
    const result = await runScheduledCleanup("manual", new Date(Date.now() + 2 * DAY_MS));
    expect(result.status).toBe("succeeded");
    if (result.status === "skipped") throw new Error("unexpected skip");
    expect(result.counts.mediaDeleted).toBeGreaterThanOrEqual(1);
    expect((await loadMedia(mediaId))!.status).toBe("deleted");
    const run = await getDb().select().from(schema.cleanupRuns).where(eq(schema.cleanupRuns.id, result.runId)).get();
    expect(run).toMatchObject({ status: "succeeded", trigger: "manual" });
    expect(run!.finishedAt).not.toBeNull();
  });

  it("leaves a recording for the next run when storage fails to delete it", async () => {
    const { id: userId } = await makeUser();
    const { mediaId } = await sessionWithData(userId);
    await updatePrivacySettings(userId, { videoRetentionDays: 1 }, null);
    const later = new Date(Date.now() + 2 * DAY_MS);

    storage.failDeletes = true;
    const failed = await runScheduledCleanup("manual", later);
    expect(failed.status).toBe("partial");
    if (failed.status === "skipped") throw new Error("unexpected skip");
    expect(failed.failures).toEqual(expect.arrayContaining([expect.objectContaining({ task: "media", target: mediaId })]));
    expect((await loadMedia(mediaId))!.status).not.toBe("deleted");

    storage.failDeletes = false;
    const retried = await runScheduledCleanup("manual", later);
    expect(retried.status).toBe("succeeded");
    expect((await loadMedia(mediaId))!.status).toBe("deleted");
  });

  it("skips while another run holds the lease, and takes over a lease that expired", async () => {
    const now = new Date();
    await getDb().insert(schema.cleanupRuns).values({ id: newId("cln"), trigger: "cron", status: "running", leaseExpiresAt: new Date(now.getTime() + CLEANUP_LEASE_MS) }).run();
    expect((await runScheduledCleanup("timer", now)).status).toBe("skipped");

    const afterLease = new Date(now.getTime() + CLEANUP_LEASE_MS + 1);
    expect((await runScheduledCleanup("timer", afterLease)).status).toBe("succeeded");
    const stale = await getDb().select().from(schema.cleanupRuns).where(eq(schema.cleanupRuns.trigger, "cron")).get();
    expect(stale!.status).toBe("failed");
  });

  it("is safe when two runs start at once", async () => {
    const [a, b] = await Promise.all([runScheduledCleanup("cron"), runScheduledCleanup("timer")]);
    expect([a.status, b.status].sort()).toEqual(["skipped", "succeeded"]);
  });

  it("only answers the cron caller that knows the secret", async () => {
    const call = (auth?: string) => cronCleanup(new Request("http://localhost/api/cron/cleanup", { headers: auth ? { authorization: auth } : {} }));
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(503);
    process.env.CRON_SECRET = "test-cron-secret-of-reasonable-length";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("Bearer test-cron-secret-of-reasonable-length")).status).toBe(200);
  });
});

describe("FIX-05 · replacing a document deletes the old version", () => {
  it("keeps only the newest resume", async () => {
    const user = await makeUser();
    currentUser.value = { ...user, role: "user" };
    const upload = (text: string) => {
      const form = new FormData();
      form.set("text", text);
      return postResume(new Request("http://localhost/api/resume", { method: "POST", body: form }), {});
    };
    expect((await upload("Sam Rivera. Product manager at Contoso, 2019 to 2024. Led onboarding.")).status).toBe(200);
    expect((await upload("Sam Rivera. Senior product manager at Fabrikam since 2024. Led pricing.")).status).toBe(200);
    const rows = await getDb().select().from(schema.resumes).where(eq(schema.resumes.userId, user.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].rawText).toContain("Fabrikam");
  });
});
