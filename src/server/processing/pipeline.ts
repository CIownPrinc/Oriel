import "server-only";
import { after } from "next/server";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { logEvent } from "@/lib/costs/events";
import { recordTokenCost, recordUnitCost } from "@/lib/costs/record";
import { computeRead, candidateMoments, interviewTypeOf, selectMoments, type AudioSample, type VisionSample, type SetupSample, type AnswerInputRow, type MetricResult } from "@/lib/analysis/read";
import { generateCoaching, type MomentForCoaching } from "@/lib/ai/analyzers";
import { getLanguageModel } from "@/lib/ai/providers/registry";
import { canUsePlayback } from "@/lib/billing/entitlements";
import { loadEntitlementContext } from "@/lib/billing/entitlement-context";
import { aboveBaseline, compare, computeBaseline, type MetricMap } from "@/lib/practice/progress";
import { LADDER, LADDER_QUALIFYING_SESSIONS } from "@/lib/practice/catalog";
import { getPack } from "@/lib/interview/domain-packs";
import { planFromSession } from "@/server/lessons";

/**
 * Session complete → store → transcript alignment → audio analysis → pose/gaze →
 * answer segmentation → competency analysis → weak moments → Playback selection →
 * coaching → progress update → lessons.
 *
 * Runs asynchronously after the interview. Each step's duration is persisted; a
 * failure marks the job failed but never touches the stored interview, so analysis
 * can be retried (admin console or the Playback page).
 */
export const PIPELINE_STEPS = [
  "store_session", "transcript_alignment", "audio_analysis", "pose_gaze_analysis", "answer_segmentation",
  "competency_analysis", "weak_moment_detection", "playback_selection", "coaching_generation", "progress_update", "lesson_planning",
] as const;

/** A run that hasn't finished in this long is presumed dead; another worker may take the job over. */
export const ANALYSIS_LEASE_MS = 6 * 60_000;
/** Automatic recovery gives up after this many attempts; the person can still retry by hand. */
export const MAX_AUTO_ATTEMPTS = 3;

/**
 * Queue analysis for a session. One job row per session (unique index), so concurrent calls,
 * from two tabs or two instances, share it. A job that is running under a live lease is left
 * alone and asked to run once more when it ends, so new input is never lost.
 */
export async function enqueueAnalysis(sessionId: string, now = new Date()): Promise<string> {
  const db = getDb();
  await db.insert(schema.processingJobs).values({ id: newId("job"), sessionId, status: "queued" }).onConflictDoNothing().run();
  const job = (await db.select().from(schema.processingJobs).where(eq(schema.processingJobs.sessionId, sessionId)).get())!;
  const liveRun = job.status === "running" && job.leaseExpiresAt !== null && job.leaseExpiresAt > now;
  if (liveRun) {
    await db.update(schema.processingJobs).set({ rerunRequested: true, updatedAt: now }).where(eq(schema.processingJobs.id, job.id)).run();
    return job.id;
  }
  await db.update(schema.processingJobs).set({ status: "queued", error: null, attempts: 0, leaseExpiresAt: null, updatedAt: now }).where(eq(schema.processingJobs.id, job.id)).run();
  await db.update(schema.interviewSessions).set({ analysisStatus: "queued", analysisError: null }).where(eq(schema.interviewSessions.id, sessionId)).run();
  if (process.env.ORIEL_SYNC_PIPELINE !== "1") runAfterResponse(() => runJob(job.id));
  return job.id;
}

/**
 * Inside a request, `after()` keeps a serverless function alive until the work finishes (on a
 * long-lived server it just runs after the response). Outside a request (boot tasks), fall back.
 */
function runAfterResponse(work: () => Promise<void>) {
  try {
    after(work);
  } catch {
    setTimeout(() => void work(), 0);
  }
}

/**
 * Take the job if nobody else holds it: it's queued, or failed, or its last run's lease ran out.
 * The claim is one conditional update, so two workers can never both win it.
 */
async function claimJob(jobId: string, now: Date): Promise<boolean> {
  const db = getDb();
  const claimable = or(
    inArray(schema.processingJobs.status, ["queued", "failed"]),
    and(eq(schema.processingJobs.status, "running"), or(isNull(schema.processingJobs.leaseExpiresAt), lt(schema.processingJobs.leaseExpiresAt, now))),
  );
  const r = await db.update(schema.processingJobs)
    .set({ status: "running", attempts: sql`${schema.processingJobs.attempts} + 1`, leaseExpiresAt: new Date(now.getTime() + ANALYSIS_LEASE_MS), rerunRequested: false, updatedAt: now })
    .where(and(eq(schema.processingJobs.id, jobId), claimable)).run();
  return r.rowsAffected === 1;
}

export async function runJob(jobId: string): Promise<void> {
  const db = getDb();
  if (!(await claimJob(jobId, new Date()))) return;
  const job = (await db.select().from(schema.processingJobs).where(eq(schema.processingJobs.id, jobId)).get())!;
  const timings: Record<string, number> = {};
  const setStep = async (step: string) => await db.update(schema.processingJobs)
    .set({ step, leaseExpiresAt: new Date(Date.now() + ANALYSIS_LEASE_MS), updatedAt: new Date() }).where(eq(schema.processingJobs.id, jobId)).run();
  await db.update(schema.interviewSessions).set({ analysisStatus: "running" }).where(eq(schema.interviewSessions.id, job.sessionId)).run();
  const t0 = performance.now();
  let ctx: PipelineCtx | null = null;
  try {
    for (const step of PIPELINE_STEPS) {
      await setStep(step);
      // Fault injection for resilience tests (never set in production).
      if (process.env.ORIEL_PIPELINE_FAIL_STEP === step) throw new Error(`injected failure at ${step}`);
      const ts = performance.now();
      ctx = await STEP_IMPL[step](job.sessionId, ctx);
      timings[step] = Math.round(performance.now() - ts);
    }
    await db.update(schema.processingJobs).set({ status: "complete", step: null, stepTimings: timings, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.processingJobs.id, jobId)).run();
    await db.update(schema.interviewSessions).set({ analysisStatus: "complete" }).where(eq(schema.interviewSessions.id, job.sessionId)).run();
    logEvent("pipeline", "analysis_complete", { sessionId: job.sessionId, durationMs: performance.now() - t0, data: timings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(schema.processingJobs).set({ status: "failed", error: msg, stepTimings: timings, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.processingJobs.id, jobId)).run();
    await db.update(schema.interviewSessions).set({ analysisStatus: "failed", analysisError: msg }).where(eq(schema.interviewSessions.id, job.sessionId)).run();
    logEvent("error", "analysis_failed", { sessionId: job.sessionId, durationMs: performance.now() - t0, data: { error: msg, timings } });
  }
  // A late transcript arrived during this run: analyse once more so it is reflected.
  const ended = await db.select({ rerun: schema.processingJobs.rerunRequested }).from(schema.processingJobs).where(eq(schema.processingJobs.id, jobId)).get();
  if (ended?.rerun) await runJob(await enqueueAnalysis(job.sessionId));
}

/** Analysis that is queued or running but hasn't moved for this long is treated as stuck. */
export const STALE_JOB_MS = 2 * 60_000;

export function isJobStale(job: { status: string; updatedAt: Date | null; createdAt: Date; leaseExpiresAt: Date | null }, now = new Date()): boolean {
  if (job.status === "queued") return now.getTime() - (job.updatedAt ?? job.createdAt).getTime() > STALE_JOB_MS;
  if (job.status === "running") return job.leaseExpiresAt === null || job.leaseExpiresAt <= now;
  return false;
}

/**
 * Restart analysis that a dead worker left queued or running (the scheduled cleanup calls this).
 * Gives up after MAX_AUTO_ATTEMPTS, marking the job failed so the person sees a retry button.
 */
export async function recoverStaleJobs(now = new Date()): Promise<{ restarted: number; gaveUp: number }> {
  const db = getDb();
  const open = await db.select().from(schema.processingJobs).where(inArray(schema.processingJobs.status, ["queued", "running"])).all();
  let restarted = 0;
  let gaveUp = 0;
  for (const job of open.filter((j) => isJobStale(j, now))) {
    if (job.attempts >= MAX_AUTO_ATTEMPTS) {
      const msg = `Analysis stopped after ${job.attempts} attempts. Retry it from the session page.`;
      await db.update(schema.processingJobs).set({ status: "failed", error: msg, leaseExpiresAt: null, updatedAt: now }).where(eq(schema.processingJobs.id, job.id)).run();
      await db.update(schema.interviewSessions).set({ analysisStatus: "failed", analysisError: msg }).where(eq(schema.interviewSessions.id, job.sessionId)).run();
      gaveUp++;
      continue;
    }
    await runJob(job.id);
    restarted++;
  }
  return { restarted, gaveUp };
}

// ─── Steps ────────────────────────────────────────────────────────────────

interface PipelineCtx {
  session: typeof schema.interviewSessions.$inferSelect;
  interview: typeof schema.interviews.$inferSelect;
  profile: typeof schema.profiles.$inferSelect | undefined;
  answers?: (typeof schema.answers.$inferSelect & { bestText: string })[];
  questions?: (typeof schema.questions.$inferSelect)[];
  audio?: AudioSample[];
  vision?: VisionSample[];
  setup?: SetupSample | null;
  rows?: AnswerInputRow[];
  read?: ReturnType<typeof computeRead>;
  competencies?: Record<string, { label: string; answers: number; avgQuality: number }>;
  moments?: ReturnType<typeof candidateMoments>;
  selected?: ReturnType<typeof selectMoments>;
}

type Step = (sessionId: string, ctx: PipelineCtx | null) => Promise<PipelineCtx>;

const STEP_IMPL: Record<(typeof PIPELINE_STEPS)[number], Step> = {
  async store_session(sessionId) {
    const db = getDb();
    const session = await db.select().from(schema.interviewSessions).where(eq(schema.interviewSessions.id, sessionId)).get();
    if (!session) throw new Error("session missing");
    if (session.status === "live" || session.status === "created") {
      await db.update(schema.interviewSessions).set({ status: "ended", endedAt: session.endedAt ?? new Date() }).where(eq(schema.interviewSessions.id, sessionId)).run();
    }
    await db.update(schema.mediaObjects).set({ status: "complete" }).where(and(eq(schema.mediaObjects.sessionId, sessionId), eq(schema.mediaObjects.status, "recording"))).run();
    const interview = (await db.select().from(schema.interviews).where(eq(schema.interviews.id, session.interviewId)).get())!;
    const profile = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, session.userId)).get();
    // Storage cost line for the recording.
    const media = await db.select().from(schema.mediaObjects).where(eq(schema.mediaObjects.sessionId, sessionId)).all();
    const bytes = media.reduce((a, m) => a + m.bytes, 0);
    if (bytes) await recordUnitCost({ userId: session.userId, sessionId }, "local-disk", "storage", "recording_30d", bytes, "bytes", (bytes / 1e9) * 0.023);
    return { session, interview, profile };
  },

  async transcript_alignment(sessionId, ctx) {
    const db = getDb();
    const answers = await db.select().from(schema.answers).where(eq(schema.answers.sessionId, sessionId)).orderBy(asc(schema.answers.seq)).all();
    const questions = await db.select().from(schema.questions).where(eq(schema.questions.sessionId, sessionId)).orderBy(asc(schema.questions.seq)).all();
    // Prefer the server transcription (keeps disfluencies) when it exists and is substantive.
    const aligned = await Promise.all(answers.map(async (a) => {
      const server = a.serverText?.trim();
      const bestText = server && server.split(/\s+/).length >= Math.max(3, a.text.split(/\s+/).length * 0.5) ? server : a.text;
      if (bestText !== a.text) {
        await db.update(schema.transcriptSegments).set({ text: bestText, source: "gemini" }).where(and(eq(schema.transcriptSegments.answerId, a.id), eq(schema.transcriptSegments.speaker, "candidate"))).run();
      }
      return { ...a, bestText };
    }));
    return { ...ctx!, answers: aligned, questions };
  },

  async audio_analysis(sessionId, ctx) {
    const rows = await getDb().select().from(schema.signalTimelines).where(and(eq(schema.signalTimelines.sessionId, sessionId), eq(schema.signalTimelines.kind, "audio"))).orderBy(asc(schema.signalTimelines.startMs)).all();
    const audio = rows.flatMap((r) => (Array.isArray(r.samples) ? (r.samples as AudioSample[]) : []))
      .filter((x) => x && typeof x.t === "number" && typeof x.rms === "number").sort((a, b) => a.t - b.t);
    return { ...ctx!, audio };
  },

  async pose_gaze_analysis(sessionId, ctx) {
    const db = getDb();
    if (!ctx!.session.cameraMetricsEnabled) return { ...ctx!, vision: [], setup: null };
    const rows = await db.select().from(schema.signalTimelines).where(and(eq(schema.signalTimelines.sessionId, sessionId), eq(schema.signalTimelines.kind, "vision"))).orderBy(asc(schema.signalTimelines.startMs)).all();
    const setupRow = await db.select().from(schema.signalTimelines).where(and(eq(schema.signalTimelines.sessionId, sessionId), eq(schema.signalTimelines.kind, "setup"))).orderBy(desc(schema.signalTimelines.startMs)).get();
    const vision = rows.flatMap((r) => (Array.isArray(r.samples) ? (r.samples as VisionSample[]) : [])).filter((x) => x && typeof x.t === "number").sort((a, b) => a.t - b.t);
    return { ...ctx!, vision, setup: Array.isArray(setupRow?.samples) ? ((setupRow!.samples[0] as SetupSample) ?? null) : null };
  },

  async answer_segmentation(_sessionId, ctx) {
    const qById = new Map(ctx!.questions!.map((q) => [q.id, q]));
    const rows: AnswerInputRow[] = ctx!.answers!.map((a) => {
      const q = qById.get(a.questionId);
      return {
        id: a.id, questionId: a.questionId, questionText: q?.text ?? "", questionKind: q?.kind ?? "primary",
        questionDifficulty: q?.difficulty ?? 2, questionEndMs: q?.speechEndMs ?? null, text: a.bestText,
        startMs: a.startMs, endMs: a.endMs, firstWordLatencyMs: a.firstWordLatencyMs, interrupted: a.interrupted, inputMode: a.inputMode,
      };
    });
    return { ...ctx!, rows };
  },

  async competency_analysis(sessionId, ctx) {
    const pack = getPack(ctx!.interview.domain);
    const opts = { cameraMetrics: ctx!.session.cameraMetricsEnabled, gaze: ctx!.profile?.gazeMetricEnabled ?? true, posture: ctx!.profile?.postureMetricEnabled ?? true, interviewType: interviewTypeOf(ctx!.interview.type) };
    const read = computeRead(ctx!.rows!, ctx!.audio!, ctx!.vision!, ctx!.setup ?? null, opts);
    const qById = new Map(ctx!.questions!.map((q) => [q.id, q]));
    const comp: Record<string, { label: string; answers: number; avgQuality: number }> = {};
    for (const p of read.per) {
      const key = qById.get(p.answer.questionId)?.competency;
      if (!key) continue;
      const label = pack.competencies.find((c) => c.key === key)?.label ?? key;
      const c = (comp[key] ??= { label, answers: 0, avgQuality: 0 });
      c.avgQuality = (c.avgQuality * c.answers + p.h.quality) / (c.answers + 1);
      c.answers += 1;
    }
    return { ...ctx!, read, competencies: comp };
  },

  async weak_moment_detection(_sessionId, ctx) {
    const opts = { cameraMetrics: ctx!.session.cameraMetricsEnabled, gaze: ctx!.profile?.gazeMetricEnabled ?? true, posture: ctx!.profile?.postureMetricEnabled ?? true, interviewType: interviewTypeOf(ctx!.interview.type) };
    return { ...ctx!, moments: candidateMoments(ctx!.read!.per, opts) };
  },

  async playback_selection(_sessionId, ctx) {
    const { maxClips } = canUsePlayback(await loadEntitlementContext(ctx!.session.userId));
    return { ...ctx!, selected: selectMoments(ctx!.moments!, maxClips) };
  },

  async coaching_generation(sessionId, ctx) {
    const db = getDb();
    const c = ctx!;
    const rowById = new Map(c.rows!.map((r) => [r.id, r]));
    const momentsForCoaching: MomentForCoaching[] = c.selected!.map((m, i) => {
      const r = rowById.get(m.answerId)!;
      return { id: String(i), question: r.questionText, transcript: r.text.slice(0, 1200), signal: m.signal, evidence: m.evidence };
    });
    const weakest = [...c.read!.per].filter((p) => p.h.wordCount >= 40 && p.answer.questionKind !== "closing").sort((a, b) => a.h.quality - b.h.quality)[0];
    const metricsSummary = c.read!.metrics.map((m) => `${m.label}: ${m.value ?? "n/a"} ${m.unit} (${m.confidence})`).join("; ");
    const llm = getLanguageModel();
    const coaching = await generateCoaching(llm, {
      role: c.interview.role, moments: momentsForCoaching, metricsSummary,
      weakestAnswer: weakest && canUsePlayback(await loadEntitlementContext(c.session.userId)).level === "full" ? { question: weakest.answer.questionText, answer: weakest.answer.text } : null,
    });
    if (coaching.usage) await recordTokenCost({ userId: c.session.userId, sessionId }, llm.id, "analysis", "coaching_generator", coaching.usage);
    logEvent("llm_output", "coaching_generator", { sessionId, durationMs: coaching.latencyMs, data: { source: coaching.source, output: coaching.data, error: coaching.error ?? null } });

    await db.transaction(async (tx) => {
      await tx.delete(schema.playbackClips).where(eq(schema.playbackClips.sessionId, sessionId)).run();
      // In order, inside the transaction: each insert finishes before the next.
      for (const [i, m] of c.selected!.entries()) {
        const r = rowById.get(m.answerId)!;
        const cm = coaching.data.moments.find((x) => x.id === String(i));
        await tx.insert(schema.playbackClips).values({
          id: newId("clp"), sessionId, questionId: m.questionId, answerId: m.answerId, rank: i, startMs: m.startMs, endMs: m.endMs,
          title: cm?.title ?? m.signal, questionText: r.questionText, transcript: r.text.slice(0, 600),
          // Observed text is always the measured evidence; the model may only add the title and the suggestion.
          observed: m.evidence, suggestion: cm?.suggestion ?? "Try: lead with the point, then the evidence.",
          signal: m.signal, confidence: m.confidence, source: coaching.source,
        }).run();
      }
      await tx.update(schema.interviewSessions).set({
        summary: {
          headline: coaching.data.headline, strengths: coaching.data.strengths, focus: coaching.data.focus,
          rewrittenAnswer: coaching.data.rewrite && weakest ? { questionId: weakest.answer.questionId, ...coaching.data.rewrite } : null,
          source: coaching.source,
        },
      }).where(eq(schema.interviewSessions.id, sessionId)).run();
    });
    return c;
  },

  async progress_update(sessionId, ctx) {
    const db = getDb();
    const c = ctx!;
    const userId = c.session.userId;
    await db.delete(schema.metrics).where(eq(schema.metrics.sessionId, sessionId)).run();
    const toRow = (m: MetricResult): typeof schema.metrics.$inferInsert => ({
      id: newId("met"), sessionId, userId, key: m.key, value: m.value, low: m.low, high: m.high, unit: m.unit,
      confidence: m.confidence, targetLow: m.targetLow, targetHigh: m.targetHigh, detail: { label: m.label, note: m.note, ...(m.detail ?? {}) },
    });
    const rows = c.read!.metrics.map(toRow);
    rows.push({ id: newId("met"), sessionId, userId, key: "competencies", value: null, low: null, high: null, unit: "", confidence: "medium", targetLow: null, targetHigh: null, detail: { label: "Competencies", note: "", competencies: c.competencies } });
    if (rows.length) await db.insert(schema.metrics).values(rows).run();

    const current: MetricMap = Object.fromEntries(c.read!.metrics.map((m) => [m.key, m.value]));
    const prior = await db.select().from(schema.progressSnapshots).where(and(eq(schema.progressSnapshots.userId, userId), isNotNull(schema.progressSnapshots.sessionId), ne(schema.progressSnapshots.sessionId, sessionId))).orderBy(asc(schema.progressSnapshots.createdAt)).all();
    const baseline = computeBaseline(prior.map((p) => p.metrics));
    await db.delete(schema.progressSnapshots).where(eq(schema.progressSnapshots.sessionId, sessionId)).run();
    await db.insert(schema.progressSnapshots).values({ id: newId("prg"), userId, sessionId, metrics: current, baseline }).run();

    // Ladder: qualifying sessions on the current level unlock the next one, each session counted once.
    const level = c.interview.ladderLevel;
    if (level && prior.length) {
      const { above } = aboveBaseline(compare(current, baseline));
      // Claim the session's credit first: a reanalysis of the same session finds it taken.
      const credited = above && (await db.update(schema.interviewSessions).set({ ladderCreditedAt: new Date() })
        .where(and(eq(schema.interviewSessions.id, sessionId), isNull(schema.interviewSessions.ladderCreditedAt))).run()).rowsAffected === 1;
      if (credited) {
        const prog = await db.select().from(schema.ladderProgress).where(and(eq(schema.ladderProgress.userId, userId), eq(schema.ladderProgress.level, level))).get();
        const qualifying = (prog?.qualifyingSessions ?? 0) + 1;
        if (prog) await db.update(schema.ladderProgress).set({ qualifyingSessions: qualifying, completedAt: qualifying >= LADDER_QUALIFYING_SESSIONS ? prog.completedAt ?? new Date() : null }).where(and(eq(schema.ladderProgress.userId, userId), eq(schema.ladderProgress.level, level))).run();
        if (qualifying >= LADDER_QUALIFYING_SESSIONS && LADDER.some((l) => l.level === level + 1)) {
          await db.insert(schema.ladderProgress).values({ userId, level: level + 1, qualifyingSessions: 0, unlockedAt: new Date() }).onConflictDoNothing().run();
          logEvent("pipeline", "ladder_unlocked", { sessionId, userId, data: { level: level + 1 } });
        }
      }
    }
    return c;
  },

  async lesson_planning(sessionId, ctx) {
    const c = ctx!;
    await planFromSession({ userId: c.session.userId, sessionId, role: c.interview.role, metrics: c.read!.metrics, per: c.read!.per });
    return c;
  },
};
