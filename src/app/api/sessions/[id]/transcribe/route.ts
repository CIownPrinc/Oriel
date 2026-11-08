import { authed, HttpError, json, type IdParams } from "@/lib/api/http";
import { getSpeechToText } from "@/lib/ai/providers/registry";
import { recordTokenCost } from "@/lib/costs/record";
import { logEvent } from "@/lib/costs/events";
import { loadSession } from "@/server/interview/service";

/** Live-turn transcription for browsers without built-in speech recognition. Audio is not stored. */
export const POST = authed<IdParams>(async (req, { params, user }) => {
  const { id } = await params;
  await loadSession(id, user.id);
  const stt = getSpeechToText();
  if (stt.isMock) throw new HttpError(501, "Server transcription is not configured");
  const mime = req.headers.get("content-type") ?? "audio/webm";
  if (!/^audio\/(webm|mp4|ogg|wav)/.test(mime)) throw new HttpError(415, "Unsupported audio type");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new HttpError(413, "Audio too large");
  if (buf.length < 800) return json({ text: "" });
  const r = await stt.transcribe({ audio: buf, mimeType: mime, timeoutMs: 20000 });
  if (r.usage) await recordTokenCost({ userId: user.id, sessionId: id }, stt.id, "stt", "live_turn_transcription", r.usage);
  logEvent("latency", "stt_live_turn", { sessionId: id, userId: user.id, durationMs: r.latencyMs, data: { bytes: buf.length } });
  return json({ text: r.text });
}, { limit: 60, name: "live-transcribe", shared: true });
