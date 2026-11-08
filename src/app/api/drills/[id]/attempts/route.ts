import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { authed, HttpError, json, parseBody, type IdParams } from "@/lib/api/http";
import { getDrill } from "@/lib/practice/catalog";
import { measureDrill } from "@/lib/practice/drill-scoring";
import { generateDrillFeedback } from "@/lib/ai/analyzers";
import { getLanguageModel } from "@/lib/ai/providers/registry";
import { recordTokenCost } from "@/lib/costs/record";
import { canStartDrill } from "@/lib/billing/entitlements";
import { loadEntitlementContext } from "@/lib/billing/entitlement-context";
import { medianOf } from "@/lib/practice/progress";
import { recordLessonPractice } from "@/server/lessons";

const Body = z.object({
  transcript: z.string().trim().min(1, "We didn't catch an answer. Try again.").max(8000),
  durationMs: z.number().min(500).max(10 * 60_000),
  firstWordLatencyMs: z.number().min(0).max(120_000).nullable(),
  cameraEngagement: z.number().min(0).max(1).nullable(),
  sourceSessionId: z.string().nullable().default(null),
  // Derived numbers only (loudness, voiced, pitch; posture ratios) — the same samples an interview stores.
  answerStartMs: z.number().min(0).max(30 * 60_000).optional(),
  audio: z.array(z.object({ t: z.number(), rms: z.number().min(0).max(2), voiced: z.boolean(), pitch: z.number().min(0).max(2000).nullable() })).max(7000).optional(),
  vision: z.array(z.object({
    t: z.number(), face: z.boolean(), engaged: z.number().nullable(), yaw: z.number().nullable(), pitch: z.number().nullable(),
    lean: z.number().nullable(), slouch: z.number().nullable(), sway: z.number().nullable(), motion: z.number().nullable(), brightness: z.number().nullable(),
  })).max(2400).optional(),
});

/** Session metric that seeds the baseline for each drill's target metric. */
const SESSION_BASELINE_KEY: Record<string, string | null> = {
  opener_seconds: null, filler_per_min: "filler_per_min", quantified_claims: null,
  recovery_ms: "recovery_ms", camera_engagement: "camera_engagement", structure_score: "structure_score",
  pace_wpm: "pace_wpm", vocal_variety: "vocal_variety", hedges_per_min: "hedges_per_min", answer_seconds: null, posture_upright: null,
};

export const POST = authed<IdParams>(async (req, { params, user }) => {
  const { id } = await params;
  const drill = getDrill(id);
  if (!drill) throw new HttpError(404, "Unknown drill");
  const verdict = canStartDrill(await loadEntitlementContext(user.id));
  if (!verdict.allowed) throw new HttpError(402, verdict.reason, "entitlement");
  const body = await parseBody(req, Body);
  const db = getDb();

  // Baseline: earlier attempts of this drill, else the user's recent session metric.
  const prior = await db.select().from(schema.drillAttempts).where(and(eq(schema.drillAttempts.userId, user.id), eq(schema.drillAttempts.drillId, id))).orderBy(desc(schema.drillAttempts.createdAt)).limit(5).all();
  let baseline = medianOf(prior.map((p) => p.value).filter((v): v is number => v !== null));
  const key = SESSION_BASELINE_KEY[drill.targetMetric];
  if (baseline === null && key) {
    const m = await db.select().from(schema.metrics).where(and(eq(schema.metrics.userId, user.id), eq(schema.metrics.key, key))).orderBy(desc(schema.metrics.createdAt)).limit(5).all();
    baseline = medianOf(m.map((x) => x.value).filter((v): v is number => v !== null));
  }
  const m = measureDrill(drill, body, baseline);
  const llm = getLanguageModel();
  const measured = `${m.label}: ${m.value ?? "not measured"} ${m.unit}${baseline !== null ? ` (your baseline: ${Math.round(baseline * 10) / 10})` : ""}; target: ${drill.passRule}`;
  const fb = await generateDrillFeedback(llm, drill, body.transcript, measured);
  if (fb.usage) await recordTokenCost({ userId: user.id }, llm.id, "analysis", "drill_feedback", fb.usage);
  const attemptId = newId("dra");
  await db.insert(schema.drillAttempts).values({
    id: attemptId, userId: user.id, drillId: id, sourceSessionId: body.sourceSessionId, promptText: drill.prompt, transcript: body.transcript,
    durationMs: Math.round(body.durationMs), result: { ...m.details, label: m.label, unit: m.unit }, feedback: `${fb.data.feedback} ${fb.data.nextTry}`.trim(),
    baselineValue: baseline, value: m.value, passed: m.passed,
  }).run();
  await db.insert(schema.usageRecords).values({ id: newId("use"), userId: user.id, kind: "drills", quantity: 1 }).run();
  const lesson = recordLessonPractice(user.id, id, m.passed);
  return json({ attemptId, measurement: m, baseline, feedback: fb.data, source: fb.source, lesson });
}, { limit: 20, name: "drill-attempt", shared: true });
