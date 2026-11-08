import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oriel-durable-"));

const currentUser = vi.hoisted(() => ({ value: null as null | { id: string; email: string; role: "user" | "admin" } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));

import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { setProvidersForTesting } from "@/lib/ai/providers/registry";
import type { SpeechToTextProvider } from "@/lib/ai/providers/types";
import { PROGRESS_METRICS } from "@/lib/practice/progress";
import { createInterview, runOpening, runTurn, type RoomEvent, type TurnInput } from "@/server/interview/service";
import { ANALYSIS_LEASE_MS, MAX_AUTO_ATTEMPTS, enqueueAnalysis, recoverStaleJobs, runJob } from "@/server/processing/pipeline";
import { POST as postComplete } from "@/app/api/sessions/[id]/complete/route";
import { POST as postAnswerAudio } from "@/app/api/sessions/[id]/answers/[answerId]/audio/route";

const base = { role: "Product Manager", domain: "product", level: "hiring_manager", type: "behavioral" as const, pressure: 2, persona: "skeptic" as const, mode: "single" as const, panelSize: 3, ladderLevel: null as number | null, targetMinutes: 15, cameraMetrics: false };

async function drain(gen: AsyncGenerator<RoomEvent>) {
  const out: RoomEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function makeUser() {
  const db = getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, email: `${id}@oriel.test`, passwordHash: "x", onboardedAt: new Date() }).run();
  await db.insert(schema.profiles).values({ userId: id, name: "Morgan Diaz", targetRole: "Product Manager", domain: "product" }).run();
  await db.insert(schema.subscriptions).values({ id: newId("sub"), userId: id, plan: "pro", periodStart: new Date() }).run();
  await db.insert(schema.ladderProgress).values({ userId: id, level: 1, unlockedAt: new Date() }).run();
  currentUser.value = { id, email: `${id}@oriel.test`, role: "user" };
  return id;
}

const turn = (i: number, turnKey?: string): TurnInput => ({
  answerText: "In 2024 our activation was flat, so I led the onboarding relaunch. I ran twelve customer interviews, proposed cutting two steps, and convinced engineering to ship it. As a result activation rose from 31 to 44 percent in six weeks.",
  startMs: 1000 + i * 30000, endMs: 20000 + i * 30000, firstWordLatencyMs: 700, interrupted: false, inputMode: "text", prevQuestion: null, turnKey,
});

/** A finished interview with two answers, ready to analyse. */
async function endedSession(userId: string, overrides: Partial<typeof base> = {}, answers = 2) {
  const db = getDb();
  const { sessionId } = await createInterview(userId, { ...base, ...overrides });
  await drain(runOpening(sessionId, userId));
  for (let i = 0; i < answers; i++) await drain(runTurn(sessionId, userId, turn(i)));
  await db.update(schema.interviewSessions).set({ status: "ended", endedAt: new Date(), startedAt: new Date(Date.now() - 300_000) }).where(eq(schema.interviewSessions.id, sessionId)).run();
  return sessionId;
}

const jobsFor = (sessionId: string) => getDb().select().from(schema.processingJobs).where(eq(schema.processingJobs.sessionId, sessionId)).all();
const sessionRow = (id: string) => getDb().select().from(schema.interviewSessions).where(eq(schema.interviewSessions.id, id)).get();

beforeEach(() => resetRateLimits());

describe("FIX-08 · analysis is durable and idempotent", () => {
  it("keeps one job per session when analysis is queued twice at once", async () => {
    const sessionId = await endedSession(await makeUser());
    const [a, b] = await Promise.all([enqueueAnalysis(sessionId), enqueueAnalysis(sessionId)]);
    expect(a).toBe(b);
    expect(await jobsFor(sessionId)).toHaveLength(1);
  });

  it("lets only one worker run a job, so one session gets one outcome", async () => {
    const sessionId = await endedSession(await makeUser());
    const jobId = await enqueueAnalysis(sessionId);
    await Promise.all([runJob(jobId), runJob(jobId)]);
    const [job] = await jobsFor(sessionId);
    expect(job).toMatchObject({ status: "complete", attempts: 1 });
    const snapshots = await getDb().select().from(schema.progressSnapshots).where(eq(schema.progressSnapshots.sessionId, sessionId)).all();
    expect(snapshots).toHaveLength(1);
  });

  it("finishes a job whose worker died mid-run", async () => {
    const sessionId = await endedSession(await makeUser());
    const jobId = await enqueueAnalysis(sessionId);
    // A worker claimed it and was killed at the third step: running, lease long gone.
    const past = new Date(Date.now() - ANALYSIS_LEASE_MS - 1000);
    await getDb().update(schema.processingJobs).set({ status: "running", step: "audio_analysis", attempts: 1, leaseExpiresAt: past, updatedAt: past }).where(eq(schema.processingJobs.id, jobId)).run();
    await getDb().update(schema.interviewSessions).set({ analysisStatus: "running" }).where(eq(schema.interviewSessions.id, sessionId)).run();
    expect(await recoverStaleJobs()).toEqual({ restarted: 1, gaveUp: 0 });
    expect((await jobsFor(sessionId))[0].status).toBe("complete");
    expect((await sessionRow(sessionId))!.analysisStatus).toBe("complete");
  });

  it("leaves a live run alone", async () => {
    const sessionId = await endedSession(await makeUser());
    const jobId = await enqueueAnalysis(sessionId);
    const soon = new Date(Date.now() + ANALYSIS_LEASE_MS);
    await getDb().update(schema.processingJobs).set({ status: "running", attempts: 1, leaseExpiresAt: soon }).where(eq(schema.processingJobs.id, jobId)).run();
    await runJob(jobId);
    expect(await recoverStaleJobs()).toEqual({ restarted: 0, gaveUp: 0 });
    expect((await jobsFor(sessionId))[0]).toMatchObject({ status: "running", attempts: 1 });
  });

  it("stops retrying on its own after the attempt limit, and says so", async () => {
    const sessionId = await endedSession(await makeUser());
    const jobId = await enqueueAnalysis(sessionId);
    const past = new Date(Date.now() - ANALYSIS_LEASE_MS - 1000);
    await getDb().update(schema.processingJobs).set({ status: "running", attempts: MAX_AUTO_ATTEMPTS, leaseExpiresAt: past }).where(eq(schema.processingJobs.id, jobId)).run();
    expect(await recoverStaleJobs()).toEqual({ restarted: 0, gaveUp: 1 });
    const s = await sessionRow(sessionId);
    expect(s!.analysisStatus).toBe("failed");
    expect(s!.analysisError).toMatch(/Retry/);
    // A manual retry still works and resets the count.
    await runJob(await enqueueAnalysis(sessionId));
    expect((await jobsFor(sessionId))[0]).toMatchObject({ status: "complete", attempts: 1 });
  });

  it("counts a Ladder session once, however many times it's reanalysed", async () => {
    const userId = await makeUser();
    // An earlier session whose numbers were far worse, so this one is above baseline.
    const earlier = (await createInterview(userId, base)).sessionId;
    const awful = Object.fromEntries(PROGRESS_METRICS.map((m) => [m.key, m.better === "lower" ? 1e6 : m.better === "higher" ? -1e6 : 1e6]));
    await getDb().insert(schema.progressSnapshots).values({ id: newId("prg"), userId, sessionId: earlier, metrics: awful, baseline: {} }).run();
    // Enough full answers that structure and specificity are measured too (three comparable measures).
    const sessionId = await endedSession(userId, { ladderLevel: 1 }, 5);
    for (let i = 0; i < 3; i++) await runJob(await enqueueAnalysis(sessionId));
    const prog = await getDb().select().from(schema.ladderProgress).where(and(eq(schema.ladderProgress.userId, userId), eq(schema.ladderProgress.level, 1))).get();
    expect(prog!.qualifyingSessions).toBe(1);
    expect((await sessionRow(sessionId))!.ladderCreditedAt).not.toBeNull();
  });

  it("stores a retried turn's answer once, and repeats the reply instead of moving on twice", async () => {
    const userId = await makeUser();
    const { sessionId } = await createInterview(userId, base);
    await drain(runOpening(sessionId, userId));
    await drain(runTurn(sessionId, userId, turn(0, "turn-key-0001")));
    const questionsBefore = (await getDb().select().from(schema.questions).where(eq(schema.questions.sessionId, sessionId)).all()).length;
    const retry = await drain(runTurn(sessionId, userId, turn(0, "turn-key-0001")));
    const answers = await getDb().select().from(schema.answers).where(eq(schema.answers.sessionId, sessionId)).all();
    expect(answers).toHaveLength(1);
    expect((await getDb().select().from(schema.questions).where(eq(schema.questions.sessionId, sessionId)).all()).length).toBe(questionsBefore);
    expect(retry.some((e) => e.type === "text" && e.text.startsWith("Let's pick up where we left off."))).toBe(true);
    // A new answer (new key) is a new turn.
    await drain(runTurn(sessionId, userId, turn(1, "turn-key-0002")));
    expect(await getDb().select().from(schema.answers).where(eq(schema.answers.sessionId, sessionId)).all()).toHaveLength(2);
  });

  it("records usage once when the session is completed twice at the same time", async () => {
    const userId = await makeUser();
    const { sessionId } = await createInterview(userId, base);
    await drain(runOpening(sessionId, userId));
    const complete = () => postComplete(new Request(`http://localhost/api/sessions/${sessionId}/complete`, {
      method: "POST", body: JSON.stringify({ reason: "completed", durationMs: 600_000, avatarProvider: "local", degradedMode: null }),
    }), { params: Promise.resolve({ id: sessionId }) });
    const [a, b] = await Promise.all([complete(), complete()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const usage = await getDb().select().from(schema.usageRecords).where(eq(schema.usageRecords.sessionId, sessionId)).all();
    expect(usage.filter((u) => u.kind === "avatar_minutes")).toHaveLength(1);
    expect(await jobsFor(sessionId)).toHaveLength(1);
  });

  it("reanalyses when a server transcript arrives after the feedback was made", async () => {
    const stt: SpeechToTextProvider = {
      id: "fake-stt", isMock: false,
      async transcribe() { return { text: "Um, so, uh, in 2024 I led the onboarding relaunch.", words: [], usage: null, latencyMs: 5 }; },
    } as unknown as SpeechToTextProvider;
    setProvidersForTesting({ stt });
    try {
      const userId = await makeUser();
      const sessionId = await endedSession(userId);
      await runJob(await enqueueAnalysis(sessionId));
      const [answer] = await getDb().select().from(schema.answers).where(eq(schema.answers.sessionId, sessionId)).all();
      const before = (await jobsFor(sessionId))[0].updatedAt!.getTime();
      const res = await postAnswerAudio(new Request(`http://localhost/api/sessions/${sessionId}/answers/${answer.id}/audio`, {
        method: "POST", headers: { "content-type": "audio/webm" }, body: Buffer.alloc(4000),
      }), { params: Promise.resolve({ id: sessionId, answerId: answer.id }) });
      expect(res.status).toBe(200);
      const [job] = await jobsFor(sessionId);
      expect(job.status).toBe("queued");
      expect(job.updatedAt!.getTime()).toBeGreaterThanOrEqual(before);
      await runJob(job.id);
      expect((await jobsFor(sessionId))[0].status).toBe("complete");
    } finally {
      setProvidersForTesting({ stt: { id: "mock-stt", isMock: true, async transcribe() { throw new Error("mock"); } } as unknown as SpeechToTextProvider });
    }
  });
});
