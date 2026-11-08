import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { authed, json, parseBody, type IdParams } from "@/lib/api/http";
import { audit } from "@/lib/security/audit";
import { logEvent } from "@/lib/costs/events";
import { avatarMinuteRate, recordUnitCost } from "@/lib/costs/record";
import { enqueueAnalysis } from "@/server/processing/pipeline";
import { loadSession } from "@/server/interview/service";

const Body = z.object({
  reason: z.enum(["completed", "ended_early", "disconnected"]),
  durationMs: z.number().min(0).max(4 * 3600_000),
  avatarProvider: z.string().max(40),
  degradedMode: z.enum(["voice", "text"]).nullable(),
  clientLatency: z.object({ turns: z.number(), medianMs: z.number().nullable(), p90Ms: z.number().nullable() }).optional(),
});

/** End the session (idempotent) and queue the Read. The interview data is already stored turn by turn. */
// Analysis runs after the response; give it room to finish on serverless hosts.
export const maxDuration = 300;

export const POST = authed<IdParams>(async (req, { params, user }) => {
  const { id } = await params;
  const { session } = await loadSession(id, user.id);
  const body = await parseBody(req, Body);
  const db = getDb();
  // Two completions can race (a retry, two tabs, two instances): the one whose update ends the
  // session records the usage, so minutes are never counted twice.
  const ended = session.status === "ended" ? null : await db.update(schema.interviewSessions)
    .set({ status: "ended", endedAt: new Date(), avatarProvider: body.avatarProvider, degradedMode: body.degradedMode, phase: "COMPLETE" })
    .where(and(eq(schema.interviewSessions.id, id), ne(schema.interviewSessions.status, "ended"))).run();
  if (ended?.rowsAffected === 1) {
    const minutes = body.durationMs / 60000;
    const avatarKey = body.avatarProvider === "local" ? "avatar-local" : "avatar-managed-premium";
    await recordUnitCost({ userId: user.id, sessionId: id }, body.avatarProvider, "avatar", "interviewer_minutes", minutes, "minutes", minutes * avatarMinuteRate(avatarKey));
    if (body.avatarProvider !== "local") await db.insert(schema.usageRecords).values({ id: newId("use"), userId: user.id, sessionId: id, kind: "managed_avatar_minutes", quantity: minutes }).run();
    await db.insert(schema.usageRecords).values({ id: newId("use"), userId: user.id, sessionId: id, kind: "avatar_minutes", quantity: minutes }).run();
    if (body.clientLatency) logEvent("latency", "turn_perceived_summary", { sessionId: id, userId: user.id, durationMs: body.clientLatency.medianMs ?? undefined, data: body.clientLatency });
    await audit("interview.complete", { userId: user.id, target: id, data: { reason: body.reason, minutes: Math.round(minutes * 10) / 10 } });
  }
  const jobId = await enqueueAnalysis(id);
  return json({ ok: true, jobId });
}, { limit: 20 });
