import { and, lt, lte, ne, isNotNull, eq, desc, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { CleanupCounts, CleanupFailure } from "@/db/schema";
import { deleteMedia } from "@/lib/privacy/media-store";
import { newId } from "@/lib/id";
import { audit } from "@/lib/security/audit";

/**
 * Retention schedule (published at /privacy):
 *  - raw video/audio recording: user's retention setting (default 30 days), then deleted
 *  - frame-level derived signals (camera + audio timelines): deleted with the raw video
 *  - aggregate Read metrics, transcript, Playback text: kept until the user deletes them
 *  - accounts with no sign-in for 3 years: deleted entirely
 *
 * One rule sets every deadline: a session's recording and its signals expire `days` after the
 * session was created. The session's `videoExpiresAt` is the authority; a recording's own
 * `expiresAt` is a copy of it.
 */
export const DAY_MS = 86_400_000;

export function retentionDeadline(sessionCreatedAt: Date, days: number): Date {
  return new Date(sessionCreatedAt.getTime() + days * DAY_MS);
}

export function isPastRetention(session: { videoExpiresAt: Date | null }, now = new Date()): boolean {
  return session.videoExpiresAt !== null && session.videoExpiresAt.getTime() <= now.getTime();
}

/**
 * Apply a new retention setting to everything the user already has. A shorter setting moves
 * deadlines earlier; a longer one never extends data that was promised a sooner deletion.
 */
export async function applyRetentionToExistingData(userId: string, days: number): Promise<void> {
  const db = getDb();
  const sessions = await db.select({ id: schema.interviewSessions.id, createdAt: schema.interviewSessions.createdAt, videoExpiresAt: schema.interviewSessions.videoExpiresAt })
    .from(schema.interviewSessions).where(eq(schema.interviewSessions.userId, userId)).all();
  for (const s of sessions) {
    const limit = retentionDeadline(s.createdAt, days);
    const deadline = s.videoExpiresAt && s.videoExpiresAt < limit ? s.videoExpiresAt : limit;
    await db.update(schema.interviewSessions).set({ videoExpiresAt: deadline }).where(eq(schema.interviewSessions.id, s.id)).run();
    await db.update(schema.mediaObjects).set({ expiresAt: deadline }).where(eq(schema.mediaObjects.sessionId, s.id)).run();
  }
}

export type SweepResult = { mediaDeleted: number; signalTimelinesDeleted: number; failures: CleanupFailure[] };

/**
 * Delete recordings and signal timelines whose deadline has arrived (same boundary as
 * `isPastRetention`). A recording is only marked deleted
 * after storage confirms the delete; a failure leaves it for the next run to retry.
 */
export async function sweepExpiredMedia(now = new Date()): Promise<SweepResult> {
  const db = getDb();
  const failures: CleanupFailure[] = [];
  const expiredSessionIds = db.select({ id: schema.interviewSessions.id }).from(schema.interviewSessions)
    .where(and(isNotNull(schema.interviewSessions.videoExpiresAt), lte(schema.interviewSessions.videoExpiresAt, now)));

  const signals = await db.delete(schema.signalTimelines).where(inArray(schema.signalTimelines.sessionId, expiredSessionIds)).run();
  const signalTimelinesDeleted = signals.rowsAffected;

  const expired = await db.select().from(schema.mediaObjects).where(and(
    ne(schema.mediaObjects.status, "deleted"),
    or(and(isNotNull(schema.mediaObjects.expiresAt), lte(schema.mediaObjects.expiresAt, now)), inArray(schema.mediaObjects.sessionId, expiredSessionIds)),
  )).all();

  let mediaDeleted = 0;
  for (const m of expired) {
    try {
      await deleteMedia(m.userId, m.id);
    } catch (err) {
      failures.push({ task: "media", target: m.id, error: errorMessage(err) });
      continue;
    }
    await db.update(schema.mediaObjects).set({ status: "deleted", bytes: 0 }).where(eq(schema.mediaObjects.id, m.id)).run();
    await audit("privacy.retention_delete", { userId: m.userId, target: m.id });
    mediaDeleted++;
  }
  return { mediaDeleted, signalTimelinesDeleted, failures };
}

/**
 * Sessions left "live" (tab closed, crash) are finalised after `idleMinutes` without
 * activity, and their Read is queued — nothing the candidate said is lost.
 * Safe to run twice at once: only the run whose update changes the status queues the Read.
 */
export async function finalizeAbandonedSessions(idleMinutes = 30, now = new Date()): Promise<string[]> {
  const db = getDb();
  const cutoff = now.getTime() - idleMinutes * 60_000;
  const openStatuses: ("live" | "created")[] = ["live", "created"];
  const live = await db.select().from(schema.interviewSessions).where(inArray(schema.interviewSessions.status, openStatuses)).all();
  const finalized: string[] = [];
  for (const s of live) {
    const lastQ = await db.select({ at: schema.questions.askedAtMs }).from(schema.questions).where(eq(schema.questions.sessionId, s.id)).orderBy(desc(schema.questions.seq)).get();
    const startedAt = (s.startedAt ?? s.createdAt).getTime();
    const lastActivity = startedAt + (lastQ?.at ?? 0);
    if (lastActivity > cutoff) continue;
    const answered = await db.select({ id: schema.answers.id }).from(schema.answers).where(eq(schema.answers.sessionId, s.id)).get();
    const claimed = await db.update(schema.interviewSessions).set({ status: answered ? "ended" : "abandoned", endedAt: new Date(lastActivity) })
      .where(and(eq(schema.interviewSessions.id, s.id), inArray(schema.interviewSessions.status, openStatuses))).run();
    if (claimed.rowsAffected === 0) continue;
    if (answered) {
      const { enqueueAnalysis } = await import("@/server/processing/pipeline");
      await enqueueAnalysis(s.id);
    }
    await audit("interview.auto_finalized", { userId: s.userId, target: s.id, data: { answered: !!answered } });
    finalized.push(s.id);
  }
  return finalized;
}

/** Delete accounts with no sign-in for `years` (BIPA's outer limit is 3 years from last interaction). */
export async function deleteInactiveAccounts(years = 3, now = new Date()): Promise<number> {
  const { deleteAccount } = await import("./deletion");
  const db = getDb();
  const cutoff = new Date(now.getTime() - years * 365 * DAY_MS);
  let n = 0;
  for (const u of await db.select().from(schema.users).all()) {
    const lastLogin = await db.select({ at: schema.authSessions.createdAt }).from(schema.authSessions).where(eq(schema.authSessions.userId, u.id)).orderBy(desc(schema.authSessions.createdAt)).get();
    const lastSession = await db.select({ at: schema.interviewSessions.createdAt }).from(schema.interviewSessions).where(eq(schema.interviewSessions.userId, u.id)).orderBy(desc(schema.interviewSessions.createdAt)).get();
    const last = Math.max(u.createdAt.getTime(), lastLogin?.at.getTime() ?? 0, lastSession?.at.getTime() ?? 0);
    if (last < cutoff.getTime()) {
      await deleteAccount(u.id, u.email.split("@")[1] ?? null);
      await audit("privacy.inactive_account_deleted", { userId: u.id });
      n++;
    }
  }
  return n;
}

// ─── Scheduled cleanup ───────────────────────────────────────────────────────

/** A run that hasn't finished within this window is presumed dead and its lease is released. */
export const CLEANUP_LEASE_MS = 10 * 60_000;

export type CleanupRunResult =
  | { status: "skipped"; reason: "another run holds the lease" }
  | { status: "succeeded" | "partial" | "failed"; runId: string; counts: CleanupCounts; failures: CleanupFailure[] };

/**
 * Run every retention task (and stuck-analysis recovery) once and record the outcome. Called by the authenticated cron route
 * (and, on a long-running server, by a timer). Tasks are independent: one failing doesn't stop
 * the others, and anything left undone is picked up by the next run.
 */
export async function runScheduledCleanup(trigger: "cron" | "timer" | "manual", now = new Date()): Promise<CleanupRunResult> {
  const runId = await claimCleanupLease(trigger, now);
  if (!runId) return { status: "skipped", reason: "another run holds the lease" };

  const counts: CleanupCounts = { mediaDeleted: 0, signalTimelinesDeleted: 0, sessionsFinalized: 0, accountsDeleted: 0, analysisRestarted: 0, analysisGaveUp: 0 };
  const failures: CleanupFailure[] = [];
  let tasksFailed = 0;
  const attempt = async (task: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (err) { tasksFailed++; failures.push({ task, error: errorMessage(err) }); }
  };

  await attempt("media", async () => {
    const r = await sweepExpiredMedia(now);
    counts.mediaDeleted = r.mediaDeleted;
    counts.signalTimelinesDeleted = r.signalTimelinesDeleted;
    failures.push(...r.failures);
  });
  await attempt("sessions", async () => { counts.sessionsFinalized = (await finalizeAbandonedSessions(30, now)).length; });
  await attempt("accounts", async () => { counts.accountsDeleted = await deleteInactiveAccounts(3, now); });
  await attempt("rate-limits", async () => {
    const { pruneRateLimits } = await import("@/lib/security/shared-limits");
    await pruneRateLimits(now.getTime());
  });
  await attempt("analysis", async () => {
    const { recoverStaleJobs } = await import("@/server/processing/pipeline");
    const r = await recoverStaleJobs(now);
    counts.analysisRestarted = r.restarted;
    counts.analysisGaveUp = r.gaveUp;
  });

  const status = tasksFailed === 5 ? "failed" : failures.length ? "partial" : "succeeded";
  await getDb().update(schema.cleanupRuns).set({ status, finishedAt: new Date(), counts, failures })
    .where(eq(schema.cleanupRuns.id, runId)).run();
  return { status, runId, counts, failures };
}

/** Insert this run as the one `running` row. Returns null when a live run already holds it. */
async function claimCleanupLease(trigger: "cron" | "timer" | "manual", now: Date): Promise<string | null> {
  const db = getDb();
  await db.update(schema.cleanupRuns).set({ status: "failed", finishedAt: now, failures: [{ task: "lease", error: "run did not finish before its lease expired" }] })
    .where(and(eq(schema.cleanupRuns.status, "running"), lt(schema.cleanupRuns.leaseExpiresAt, now))).run();
  const runId = newId("cln");
  try {
    await db.insert(schema.cleanupRuns).values({ id: runId, trigger, status: "running", leaseExpiresAt: new Date(now.getTime() + CLEANUP_LEASE_MS) }).run();
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(errorMessage(err))) return null;
    throw err;
  }
  return runId;
}

export async function lastCleanupRun() {
  return getDb().select().from(schema.cleanupRuns).orderBy(desc(schema.cleanupRuns.createdAt)).get();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return [err.message, (err.cause as Error | undefined)?.message].filter(Boolean).join(": ");
  return String(err);
}
