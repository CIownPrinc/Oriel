import "server-only";
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { HttpError } from "@/lib/api/errors";
import { logEvent } from "@/lib/costs/events";
import { recordTokenCost } from "@/lib/costs/record";
import { getLanguageModel } from "@/lib/ai/providers/registry";
import { CATEGORIES, COMPETENCY, competency, criterion, type Category } from "@/lib/training/competencies";
import { advance, attemptStageOf, chooseCompetency, nextReviewAt, outcomeOf, pickExercise, type AttemptRecord, type CompetencyHistory, type Evaluation, type LoopState, type Outcome, type Step } from "@/lib/training/engine";
import { evaluate, evaluateCode } from "@/lib/training/evaluate";
import { asResponse, validResults, type CodeSpec, type CodeSubmission } from "@/lib/training/code";
import { generateExercise } from "@/lib/training/generate";
import type { Exercise } from "@/lib/training/questions";
import { assertWithinDailyCost } from "@/lib/security/shared-limits";

/*
 * The practice loop on the server. The engine (lib/training/engine) decides; this file loads,
 * authorises, evaluates and persists. Every read and write is scoped to the signed-in user: a
 * loop, attempt, evaluation or review that belongs to someone else is "not found".
 */

type LoopRow = typeof schema.trainingLoops.$inferSelect;

const isCategory = (c: string): c is Category => CATEGORIES.some((x) => x.id === c);

async function ownLoop(userId: string, loopId: string): Promise<LoopRow> {
  const row = await getDb().select().from(schema.trainingLoops).where(and(eq(schema.trainingLoops.id, loopId), eq(schema.trainingLoops.userId, userId))).get();
  if (!row) throw new HttpError(404, "Practice not found");
  return row;
}

async function usedExercises(userId: string, competencyId: string) {
  const rows = await getDb().select({ questionId: schema.trainingAttempts.questionId, loopId: schema.trainingAttempts.loopId })
    .from(schema.trainingAttempts).innerJoin(schema.trainingLoops, eq(schema.trainingLoops.id, schema.trainingAttempts.loopId))
    .where(and(eq(schema.trainingAttempts.userId, userId), eq(schema.trainingLoops.competencyId, competencyId))).all();
  return new Set(rows.map((r) => r.questionId));
}

const seedOf = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);

// ─── Starting ───────────────────────────────────────────────────────────────

export async function startPractice(userId: string, input: { category: string; competencyId?: string | null }): Promise<string> {
  if (!isCategory(input.category)) throw new HttpError(400, "Unknown interview type");
  await assertWithinDailyCost(userId);
  const category = input.category;
  const competencyId = input.competencyId ?? chooseCompetency(category, await history(userId));
  const c = COMPETENCY[competencyId];
  if (!c || !c.categories.includes(category)) throw new HttpError(400, "That skill isn't practised in this interview type");
  const id = newId("trn");
  const q = pickExercise(c.id, category, await usedExercises(userId, c.id), new Set(), seedOf(id));
  if (!q) throw new HttpError(409, "No question is available for this skill yet");
  await getDb().insert(schema.trainingLoops).values({ id, userId, kind: "practice", category, competencyId: c.id, rubricVersion: c.version, stage: "attempt", question: q }).run();
  logEvent("training", "loop_started", { userId, data: { loopId: id, competencyId: c.id, category, questionId: q.id } });
  return id;
}

/** Start (or resume) the review a past loop scheduled. A different question from any used before. */
export async function startReview(userId: string, reviewId: string): Promise<string> {
  const db = getDb();
  const r = await db.select().from(schema.trainingReviews).where(and(eq(schema.trainingReviews.id, reviewId), eq(schema.trainingReviews.userId, userId))).get();
  if (!r) throw new HttpError(404, "Review not found");
  if (r.startedLoopId) return r.startedLoopId;
  if (!isCategory(r.category)) throw new HttpError(400, "Unknown interview type");
  const c = competency(r.competencyId);
  const source = await db.select().from(schema.trainingLoops).where(eq(schema.trainingLoops.id, r.sourceLoopId)).get();
  const seenSituations = new Set((await db.select({ q: schema.trainingLoops.question }).from(schema.trainingLoops)
    .where(and(eq(schema.trainingLoops.userId, userId), eq(schema.trainingLoops.competencyId, c.id))).all()).map((x) => x.q.situation));
  const id = newId("trn");
  const used = await usedExercises(userId, c.id);
  const q = pickExercise(c.id, r.category, used, seenSituations, seedOf(id)) ?? pickExercise(c.id, r.category, used, new Set(source ? [source.question.situation] : []), seedOf(id));
  if (!q) throw new HttpError(409, "No question is available for this review yet");
  await db.transaction(async (tx) => {
    await tx.insert(schema.trainingLoops).values({ id, userId, kind: "review", category: r.category, competencyId: c.id, rubricVersion: c.version, stage: "attempt", targetCriterion: r.targetCriterion, question: q, reviewOfLoopId: r.sourceLoopId }).run();
    await tx.update(schema.trainingReviews).set({ startedLoopId: id }).where(eq(schema.trainingReviews.id, r.id)).run();
  });
  return id;
}

// ─── Answering ──────────────────────────────────────────────────────────────

export interface AttemptInput { response: string; inputMode: "voice" | "text"; durationMs: number; clientKey: string; code?: CodeSubmission }

const inFlight = new Set<string>();

export async function submitAttempt(userId: string, loopId: string, attempt: AttemptInput): Promise<LoopView> {
  let input = attempt;
  const db = getDb();
  // A resent request (double click, retry after a dropped connection) returns what it already made.
  const dupe = await db.select().from(schema.trainingAttempts).where(and(eq(schema.trainingAttempts.userId, userId), eq(schema.trainingAttempts.clientKey, input.clientKey))).get();
  if (dupe) {
    if (dupe.loopId !== loopId) throw new HttpError(409, "That submission belongs to another practice");
    return loopView(userId, loopId);
  }
  const loop = await ownLoop(userId, loopId);
  if (loop.stage === "done") throw new HttpError(409, "This practice is finished");
  if (inFlight.has(loopId)) throw new HttpError(409, "An answer is already being assessed");
  inFlight.add(loopId);
  try {
    const c = competency(loop.competencyId);
    const state: LoopState = { kind: loop.kind, stage: loop.stage, targetCriterion: loop.targetCriterion, scaffold: loop.scaffold as 0 | 1 | 2, retries: loop.retries, insufficientStreak: loop.insufficientStreak };
    const stage = attemptStageOf(state);
    const q = loop.question;
    const llm = getLanguageModel();
    // Evaluate before writing anything: a failed model call falls back inside `evaluate`, and an
    // exception here leaves the loop exactly as it was.
    if (q.code && (!input.code || !validResults(q.code, input.code.results))) throw new HttpError(400, "Run the tests before submitting");
    const { evaluation, usage, error } = q.code
      ? await evaluateCode(llm, { competency: c, question: q.text, spec: q.code, submission: input.code!, target: loop.targetCriterion })
      : await evaluate(llm, { competency: c, question: q.text, expected: q.expected, answer: input.response, inputMode: input.inputMode, target: loop.targetCriterion });
    if (q.code) input = { ...input, response: asResponse(input.code!.source, input.code!.explanation), inputMode: "text" };
    if (usage) await recordTokenCost({ userId }, llm.id, "llm", "training_evaluation", usage);
    if (error) logEvent("fallback", "training_pattern_evaluator", { userId, data: { loopId, error } });

    const { state: next, step } = advance(c, state, evaluation);
    // The transfer needs a new exercise: curated first, in a situation not yet met; generated only if the bank is exhausted.
    let nextQuestion: Exercise = q;
    if (next.stage === "transfer" && state.stage !== "transfer") {
      const used = await usedExercises(userId, c.id);
      used.add(q.id);
      const picked = pickExercise(c.id, loop.category as Category, used, new Set([q.situation]), seedOf(loop.id + "t"))
        ?? await generateExercise(llm, c, loop.category as Category, [{ text: q.text, situation: q.situation }], q.difficulty);
      if (picked) nextQuestion = picked;
      else return finishWithout(userId, loop, input, stage, evaluation, "No new question was available for the transfer test.");
    }

    const attemptId = newId("tat");
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(schema.trainingAttempts).values({
        id: attemptId, loopId, userId, stage, questionId: q.id, questionText: q.text, questionSource: q.source,
        response: input.response.slice(0, 12000), inputMode: input.inputMode, durationMs: Math.max(0, Math.round(input.durationMs)), clientKey: input.clientKey,
      }).run();
      await tx.insert(schema.trainingEvaluations).values({
        id: newId("tev"), attemptId, userId, competencyId: c.id, rubricVersion: evaluation.rubricVersion, evaluator: evaluation.evaluator,
        criteria: evaluation.criteria, enoughEvidence: evaluation.enoughEvidence, confidence: evaluation.confidence, primary: evaluation.primary,
        secondary: evaluation.secondary, limitations: evaluation.limitations, insufficientReason: evaluation.insufficientReason,
      }).run();
      await tx.update(schema.trainingLoops).set({
        stage: next.stage, targetCriterion: next.targetCriterion, scaffold: next.scaffold, retries: next.retries, insufficientStreak: next.insufficientStreak, question: nextQuestion,
      }).where(eq(schema.trainingLoops.id, loopId)).run();
    });
    if (next.stage === "done") await complete(userId, loopId, now);
    logEvent("training", "attempt_assessed", { userId, data: { loopId, stage, step: step.kind, evaluator: evaluation.evaluator, enough: evaluation.enoughEvidence } });
    return loopView(userId, loopId, step);
  } finally {
    inFlight.delete(loopId);
  }
}

/** The transfer couldn't be set up: keep the attempt, close the loop honestly. */
async function finishWithout(userId: string, loop: LoopRow, input: AttemptInput, stage: ReturnType<typeof attemptStageOf>, e: Evaluation, note: string): Promise<LoopView> {
  const db = getDb();
  const attemptId = newId("tat");
  await db.transaction(async (tx) => {
    await tx.insert(schema.trainingAttempts).values({ id: attemptId, loopId: loop.id, userId, stage, questionId: loop.question.id, questionText: loop.question.text, questionSource: loop.question.source, response: input.response.slice(0, 12000), inputMode: input.inputMode, durationMs: Math.max(0, Math.round(input.durationMs)), clientKey: input.clientKey }).run();
    await tx.insert(schema.trainingEvaluations).values({ id: newId("tev"), attemptId, userId, competencyId: loop.competencyId, rubricVersion: e.rubricVersion, evaluator: e.evaluator, criteria: e.criteria, enoughEvidence: e.enoughEvidence, confidence: e.confidence, primary: e.primary, secondary: e.secondary, limitations: [e.limitations, note].filter(Boolean).join(" "), insufficientReason: e.insufficientReason }).run();
    await tx.update(schema.trainingLoops).set({ stage: "done" }).where(eq(schema.trainingLoops.id, loop.id)).run();
  });
  await complete(userId, loop.id, new Date());
  return loopView(userId, loop.id, { kind: "done" });
}

/** Close a loop: record its outcomes and schedule the next review. A review closes the review that started it. */
async function complete(userId: string, loopId: string, now: Date) {
  const db = getDb();
  const loop = await ownLoop(userId, loopId);
  const o = outcomeOf(loop.kind, loop.targetCriterion, await attemptsOf(userId, loopId));
  await db.transaction(async (tx) => {
    await tx.update(schema.trainingLoops).set({ outcome: o, completedAt: now }).where(eq(schema.trainingLoops.id, loopId)).run();
    if (loop.kind === "review") await tx.update(schema.trainingReviews).set({ completedAt: now }).where(and(eq(schema.trainingReviews.startedLoopId, loopId), eq(schema.trainingReviews.userId, userId))).run();
    // Nothing assessed at all: nothing to review.
    const assessed = o.improvedOnRetry !== "not_assessed" || o.transferred !== "not_assessed" || o.retained !== "not_assessed";
    if (assessed) {
      await tx.insert(schema.trainingReviews).values({ id: newId("trv"), userId, competencyId: loop.competencyId, category: loop.category, sourceLoopId: loop.kind === "review" ? (loop.reviewOfLoopId ?? loopId) : loopId, targetCriterion: loop.targetCriterion, dueAt: nextReviewAt(loop.kind, o, now) }).run();
    }
  });
}

// ─── Reading ────────────────────────────────────────────────────────────────

type EvalRow = typeof schema.trainingEvaluations.$inferSelect;
const toEvaluation = (e: EvalRow): Evaluation => ({
  competencyId: e.competencyId, rubricVersion: e.rubricVersion, evaluator: e.evaluator, criteria: e.criteria, enoughEvidence: e.enoughEvidence,
  confidence: e.confidence, primary: e.primary ?? null, secondary: e.secondary, limitations: e.limitations, insufficientReason: e.insufficientReason,
});

export interface AttemptView { id: string; stage: AttemptRecord["stage"]; question: string; questionSource: "curated" | "generated"; response: string; createdAt: string; evaluation: Evaluation | null }

function attemptRows(userId: string, loopId: string) {
  return getDb().select().from(schema.trainingAttempts).leftJoin(schema.trainingEvaluations, eq(schema.trainingEvaluations.attemptId, schema.trainingAttempts.id))
    .where(and(eq(schema.trainingAttempts.loopId, loopId), eq(schema.trainingAttempts.userId, userId))).orderBy(asc(schema.trainingAttempts.createdAt)).all();
}

async function attemptsOf(userId: string, loopId: string): Promise<AttemptRecord[]> {
  return (await attemptRows(userId, loopId)).map((r) => ({ stage: r.training_attempts.stage, createdAt: r.training_attempts.createdAt, evaluation: r.training_evaluations ? toEvaluation(r.training_evaluations) : null }));
}

export interface LoopView {
  id: string;
  kind: "practice" | "review";
  category: Category;
  stage: "attempt" | "retry" | "transfer" | "done";
  /** Shown only once the loop is done (or on the hub): never while answering. */
  competency: { id: string; label: string; summary: string };
  question: { text: string; source: "curated" | "generated"; code: CodeSpec | null };
  target: { id: string; label: string; principle: string; why: string } | null;
  /** Scaffolding for the current retry: none, a focused question, or a partial outline. */
  scaffold: string | null;
  attempts: AttemptView[];
  step: Step | null;
  outcome: ReturnType<typeof outcomeOf> | null;
  nextReview: string | null;
}

export async function loopView(userId: string, loopId: string, step: Step | null = null): Promise<LoopView> {
  const loop = await ownLoop(userId, loopId);
  const c = competency(loop.competencyId);
  const t = loop.targetCriterion ? criterion(c, loop.targetCriterion) : undefined;
  const attempts: AttemptView[] = (await attemptRows(userId, loopId)).map((r) => ({
    id: r.training_attempts.id, stage: r.training_attempts.stage, question: r.training_attempts.questionText, questionSource: r.training_attempts.questionSource,
    response: r.training_attempts.response, createdAt: r.training_attempts.createdAt.toISOString(), evaluation: r.training_evaluations ? toEvaluation(r.training_evaluations) : null,
  }));
  const review = await getDb().select({ dueAt: schema.trainingReviews.dueAt }).from(schema.trainingReviews)
    .where(and(eq(schema.trainingReviews.userId, userId), eq(schema.trainingReviews.sourceLoopId, loop.kind === "review" ? (loop.reviewOfLoopId ?? loopId) : loopId), isNull(schema.trainingReviews.startedLoopId)))
    .orderBy(desc(schema.trainingReviews.dueAt)).get();
  return {
    id: loop.id, kind: loop.kind, category: loop.category as Category, stage: loop.stage,
    competency: { id: c.id, label: c.label, summary: c.summary },
    question: { text: loop.question.text, source: loop.question.source, code: loop.question.code ?? null },
    target: t ? { id: t.id, label: t.label, principle: t.principle, why: t.why } : null,
    scaffold: loop.stage === "retry" && t && loop.scaffold > 0 ? t.scaffold[loop.scaffold - 1] : null,
    attempts, step, outcome: loop.outcome ?? null,
    nextReview: loop.stage === "done" && review ? review.dueAt.toISOString() : null,
  };
}

/** The question this person is answering now (for speaking it aloud). Only stored questions can be spoken. */
export async function currentQuestion(userId: string, loopId: string): Promise<string> {
  return (await ownLoop(userId, loopId)).question.text;
}

export async function deleteLoop(userId: string, loopId: string) {
  const loop = await ownLoop(userId, loopId);
  await getDb().delete(schema.trainingLoops).where(eq(schema.trainingLoops.id, loop.id)).run();
}

// ─── Learning state ─────────────────────────────────────────────────────────

export interface SkillState {
  competencyId: string;
  label: string;
  summary: string;
  categories: Category[];
  assessed: boolean;
  /** Attempts with enough evidence to judge, and how many of those were low confidence. */
  evidence: { judged: number; lowConfidence: number };
  improvedOnRetry: { outcome: Outcome; at: string | null };
  transferred: { outcome: Outcome; at: string | null };
  retained: { outcome: Outcome; at: string | null };
  lastPracticedAt: string | null;
  nextReviewAt: string | null;
}

/** Per competency, the latest of each outcome, kept apart. No single score. */
export async function learningState(userId: string): Promise<SkillState[]> {
  const db = getDb();
  const loops = await db.select().from(schema.trainingLoops).where(eq(schema.trainingLoops.userId, userId)).orderBy(asc(schema.trainingLoops.createdAt)).all();
  const evals = await db.select({ competencyId: schema.trainingEvaluations.competencyId, enough: schema.trainingEvaluations.enoughEvidence, confidence: schema.trainingEvaluations.confidence })
    .from(schema.trainingEvaluations).where(eq(schema.trainingEvaluations.userId, userId)).all();
  const reviews = await db.select().from(schema.trainingReviews).where(and(eq(schema.trainingReviews.userId, userId), isNull(schema.trainingReviews.completedAt))).all();
  return Object.values(COMPETENCY).map((c) => {
    const mine = loops.filter((l) => l.competencyId === c.id);
    const latest = (key: "improvedOnRetry" | "transferred" | "retained") => {
      const hit = [...mine].reverse().find((l) => l.outcome && l.outcome[key] !== "not_assessed");
      return { outcome: (hit?.outcome?.[key] ?? "not_assessed") as Outcome, at: hit?.completedAt?.toISOString() ?? null };
    };
    const judged = evals.filter((e) => e.competencyId === c.id && e.enough);
    const due = reviews.filter((r) => r.competencyId === c.id).map((r) => r.dueAt.getTime()).sort((a, b) => a - b)[0];
    return {
      competencyId: c.id, label: c.label, summary: c.summary, categories: c.categories, assessed: judged.length > 0,
      evidence: { judged: judged.length, lowConfidence: judged.filter((e) => e.confidence === "low").length },
      improvedOnRetry: latest("improvedOnRetry"), transferred: latest("transferred"), retained: latest("retained"),
      lastPracticedAt: mine.at(-1)?.createdAt.toISOString() ?? null, nextReviewAt: due ? new Date(due).toISOString() : null,
    };
  });
}

async function history(userId: string): Promise<CompetencyHistory[]> {
  return (await learningState(userId)).map((s) => ({ competencyId: s.competencyId, lastPracticedAt: s.lastPracticedAt ? new Date(s.lastPracticedAt) : null, assessed: s.assessed, transferred: s.transferred.outcome, retained: s.retained.outcome }));
}

export interface DueReview { id: string; competencyId: string; label: string; category: Category; dueAt: string; startedLoopId: string | null }

/** Reviews whose time has come, oldest first. Nothing runs in the background: they surface on the next visit. */
export async function dueReviews(userId: string, now = new Date()): Promise<DueReview[]> {
  return (await getDb().select().from(schema.trainingReviews)
    .where(and(eq(schema.trainingReviews.userId, userId), isNull(schema.trainingReviews.completedAt), lte(schema.trainingReviews.dueAt, now)))
    .orderBy(asc(schema.trainingReviews.dueAt)).all())
    .map((r) => ({ id: r.id, competencyId: r.competencyId, label: COMPETENCY[r.competencyId]?.label ?? r.competencyId, category: r.category as Category, dueAt: r.dueAt.toISOString(), startedLoopId: r.startedLoopId }));
}

/** Practice that was started and not finished, newest first. */
export function openLoops(userId: string) {
  return getDb().select({ id: schema.trainingLoops.id, kind: schema.trainingLoops.kind, category: schema.trainingLoops.category, createdAt: schema.trainingLoops.createdAt })
    .from(schema.trainingLoops).where(and(eq(schema.trainingLoops.userId, userId), isNull(schema.trainingLoops.completedAt))).orderBy(desc(schema.trainingLoops.createdAt)).all();
}

// ─── Is it working? (admin) ─────────────────────────────────────────────────

export interface EvidenceCell { n: number; yes: number }
export interface TrainingEvidence {
  loops: number;
  /** Transfer outcome, split by whether the retry improved. */
  transferAfterImproved: EvidenceCell;
  transferAfterNotImproved: EvidenceCell;
  /** Review outcome, split by whether the practice it followed transferred. */
  retainedAfterTransfer: EvidenceCell;
  retainedAfterNoTransfer: EvidenceCell;
  evaluators: { model: number; pattern: number; insufficient: number };
}

/**
 * The numbers needed to test whether the loop helps, across everyone. Observational: people
 * choose what to practise and when to return, so these are associations, never effects.
 */
export async function trainingEvidence(): Promise<TrainingEvidence> {
  const db = getDb();
  const loops = (await db.select().from(schema.trainingLoops).where(isNull(schema.trainingLoops.reviewOfLoopId)).all()).filter((l) => l.outcome);
  const reviews = (await db.select().from(schema.trainingLoops).all()).filter((l) => l.kind === "review" && l.outcome);
  const byId = new Map(loops.map((l) => [l.id, l]));
  const cell = (rows: Outcome[]): EvidenceCell => ({ n: rows.filter((r) => r !== "not_assessed").length, yes: rows.filter((r) => r === "yes").length });
  const practice = loops.filter((l) => l.kind === "practice");
  const ev = await db.select({ evaluator: schema.trainingEvaluations.evaluator, enough: schema.trainingEvaluations.enoughEvidence }).from(schema.trainingEvaluations).all();
  return {
    loops: practice.length,
    transferAfterImproved: cell(practice.filter((l) => l.outcome!.improvedOnRetry === "yes").map((l) => l.outcome!.transferred)),
    transferAfterNotImproved: cell(practice.filter((l) => l.outcome!.improvedOnRetry === "no").map((l) => l.outcome!.transferred)),
    retainedAfterTransfer: cell(reviews.filter((r) => byId.get(r.reviewOfLoopId ?? "")?.outcome?.transferred === "yes").map((r) => r.outcome!.retained)),
    retainedAfterNoTransfer: cell(reviews.filter((r) => byId.get(r.reviewOfLoopId ?? "")?.outcome?.transferred === "no").map((r) => r.outcome!.retained)),
    evaluators: { model: ev.filter((e) => e.evaluator === "model" && e.enough).length, pattern: ev.filter((e) => e.evaluator === "pattern" && e.enough).length, insufficient: ev.filter((e) => !e.enough).length },
  };
}
