import { z } from "zod";
import { authed, HttpError, ndjson, parseBody } from "@/lib/api/http";
import { VOICE_SAMPLE } from "@/lib/avatar/style";
import { voiceSchema } from "@/lib/avatar/style-schema";
import { speak, type RoomEvent } from "@/server/interview/service";
import { isCached, ttsBudgetRemaining } from "@/server/interview/speech";

/**
 * Hear a voice before choosing it: one fixed line per voice, synthesised once and then
 * served from the speech cache. Uncached previews never eat into the budget live
 * interviews rely on.
 */
// Streams speech, which can outlast a short default limit on serverless hosts.
export const maxDuration = 60;

export const POST = authed(async (req, { user }) => {
  const { voice } = await parseBody(req, z.object({ voice: voiceSchema }));
  if (!isCached(voice, VOICE_SAMPLE) && ttsBudgetRemaining() <= 3) throw new HttpError(429, "Voice previews are busy. Try again in a few seconds.");
  return ndjson<RoomEvent>(speak(null, user.id, VOICE_SAMPLE, voice, 2));
}, { limit: 30, name: "voice-preview" });
