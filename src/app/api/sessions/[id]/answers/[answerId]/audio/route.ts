import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { authed, HttpError, json } from "@/lib/api/http";
import { getSpeechToText } from "@/lib/ai/providers/registry";
import { recordTokenCost } from "@/lib/costs/record";
import { logEvent } from "@/lib/costs/events";
import { loadSession } from "@/server/interview/service";
import { enqueueAnalysis } from "@/server/processing/pipeline";

/**
 * Server transcription of one answer's microphone audio. Browser live recognition
 * drops disfluencies, so this becomes the authoritative transcript for the Read.
 * The audio is transcribed and discarded — it is not stored.
 */
export const POST = authed<{ params: Promise<{ id: string; answerId: string }> }>(async (req, { params, user }) => {
  const { id, answerId } = await params;
  await loadSession(id, user.id);
  const db = getDb();
  const answer = await db.select().from(schema.answers).where(and(eq(schema.answers.id, answerId), eq(schema.answers.sessionId, id))).get();
  if (!answer) throw new HttpError(404, "Answer not found");
  const mime = req.headers.get("content-type") ?? "audio/webm";
  if (!/^audio\/(webm|mp4|ogg|wav)/.test(mime)) throw new HttpError(415, "Unsupported audio type");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length < 1000) return json({ ok: true, skipped: "too short" });
  if (buf.length > 20 * 1024 * 1024) throw new HttpError(413, "Audio too large");
  const stt = getSpeechToText();
  if (stt.isMock) return json({ ok: true, skipped: "server transcription not configured" });
  try {
    const r = await stt.transcribe({ audio: buf, mimeType: mime });
    if (r.usage) await recordTokenCost({ userId: user.id, sessionId: id }, stt.id, "stt", "answer_transcription", r.usage);
    logEvent("latency", "stt_answer", { sessionId: id, userId: user.id, durationMs: r.latencyMs, data: { bytes: buf.length, words: r.text.split(/\s+/).length } });
    if (r.text) {
      await db.update(schema.answers).set({ serverText: r.text }).where(eq(schema.answers.id, answerId)).run();
      // Arrived after the session ended: the analysis may already have run without it. Queue it again
      // (a run in progress is asked to repeat once it ends), so the feedback uses this transcript.
      const fresh = await db.select({ status: schema.interviewSessions.status, analysis: schema.interviewSessions.analysisStatus }).from(schema.interviewSessions).where(eq(schema.interviewSessions.id, id)).get();
      if (fresh && fresh.status !== "live" && fresh.analysis !== "not_started") await enqueueAnalysis(id);
    }
    return json({ ok: true, chars: r.text.length });
  } catch (err) {
    logEvent("error", "stt_failed", { sessionId: id, userId: user.id, data: { error: String(err) } });
    return json({ ok: false, error: "Transcription failed; the live transcript will be used." }, { status: 202 });
  }
}, { limit: 120, name: "answer-audio", shared: true });
