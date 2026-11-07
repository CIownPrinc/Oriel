import { authed, ndjson, type IdParams } from "@/lib/api/http";
import { voiceFor } from "@/lib/avatar/style";
import { savedStyles } from "@/server/avatar-styles";
import { speak, type RoomEvent } from "@/server/interview/service";
import { currentQuestion } from "@/server/training/service";

/** Speak the practice's current question in the interviewer's voice (as this person styled it). */
// Streams speech, which can outlast a short default limit on serverless hosts.
export const maxDuration = 60;

export const POST = authed<IdParams>(async (_req, { params, user }) => {
  const { id } = await params;
  const text = await currentQuestion(user.id, id);
  const voice = voiceFor("hiring_manager", (await savedStyles(user.id)).hiring_manager);
  return ndjson<RoomEvent>(speak(null, user.id, text, voice, 2));
}, { limit: 30, name: "training-speak" });
