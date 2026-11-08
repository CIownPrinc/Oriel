import { authed, HttpError, json, type IdParams } from "@/lib/api/http";
import { getDrill } from "@/lib/practice/catalog";
import { getSpeechToText } from "@/lib/ai/providers/registry";
import { recordTokenCost } from "@/lib/costs/record";

/** Transcribe a drill attempt (keeps filler words). Audio is not stored. */
export const POST = authed<IdParams>(async (req, { params, user }) => {
  const { id } = await params;
  if (!getDrill(id)) throw new HttpError(404, "Unknown drill");
  const stt = getSpeechToText();
  if (stt.isMock) throw new HttpError(501, "Server transcription is not configured");
  const mime = req.headers.get("content-type") ?? "audio/webm";
  if (!/^audio\/(webm|mp4|ogg|wav)/.test(mime)) throw new HttpError(415, "Unsupported audio type");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new HttpError(413, "Audio too large");
  const r = await stt.transcribe({ audio: buf, mimeType: mime });
  if (r.usage) await recordTokenCost({ userId: user.id }, stt.id, "stt", "drill_transcription", r.usage);
  return json({ text: r.text });
}, { limit: 30, name: "drill-transcribe", shared: true });
