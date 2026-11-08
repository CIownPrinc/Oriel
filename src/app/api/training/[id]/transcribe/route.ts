import { authed, HttpError, json, type IdParams } from "@/lib/api/http";
import { getSpeechToText } from "@/lib/ai/providers/registry";
import { recordTokenCost } from "@/lib/costs/record";
import { currentQuestion } from "@/server/training/service";

/** Transcribe a spoken answer to this person's practice question. The audio is not stored. */
export const POST = authed<IdParams>(async (req, { params, user }) => {
  const { id } = await params;
  await currentQuestion(user.id, id); // 404 unless it's their practice
  const stt = getSpeechToText();
  if (stt.isMock) throw new HttpError(501, "Server transcription is not configured");
  const mime = req.headers.get("content-type") ?? "audio/webm";
  if (!/^audio\/(webm|mp4|ogg|wav)/.test(mime)) throw new HttpError(415, "Unsupported audio type");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new HttpError(413, "Audio too large");
  const r = await stt.transcribe({ audio: buf, mimeType: mime });
  if (r.usage) await recordTokenCost({ userId: user.id }, stt.id, "stt", "training_transcription", r.usage);
  return json({ text: r.text });
}, { limit: 30, name: "training-transcribe", shared: true });
