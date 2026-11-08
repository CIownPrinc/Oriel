import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { authed, json, type IdParams } from "@/lib/api/http";
import { enqueueAnalysis, isJobStale } from "@/server/processing/pipeline";
import { loadSession } from "@/server/interview/service";

/** Analysis status for the "processing" screen. */
// Analysis runs after the response; give it room to finish on serverless hosts.
export const maxDuration = 300;

export const GET = authed<IdParams>(async (_req, { params, user }) => {
  const { id } = await params;
  const { session } = await loadSession(id, user.id);
  const job = await getDb().select().from(schema.processingJobs).where(eq(schema.processingJobs.sessionId, id)).get();
  return json({ status: session.analysisStatus, step: job?.step ?? null, error: session.analysisError, stuck: job ? isJobStale(job) : false });
}, { limit: 240, name: "analysis-status" });

/** Retry analysis. Never re-runs the interview; only reprocesses stored data. */
export const POST = authed<IdParams>(async (_req, { params, user }) => {
  const { id } = await params;
  await loadSession(id, user.id);
  return json({ ok: true, jobId: await enqueueAnalysis(id) });
}, { limit: 10, name: "analysis-retry", shared: true });
