import { authed, HttpError, ndjson, type IdParams } from "@/lib/api/http";
import { getDrill } from "@/lib/practice/catalog";
import { voiceFor } from "@/lib/avatar/style";
import { savedStyles } from "@/server/avatar-styles";
import { speak, type RoomEvent } from "@/server/interview/service";

/** Speak a drill's prompt in an interviewer voice (only fixed catalog prompts can be spoken). */
// Streams speech, which can outlast a short default limit on serverless hosts.
export const maxDuration = 60;

export const POST = authed<IdParams>(async (_req, { params, user }) => {
  const { id } = await params;
  const drill = getDrill(id);
  if (!drill) throw new HttpError(404, "Unknown drill");
  // The drill's interviewer sounds the way this person chose for that persona.
  const persona = drill.id === "hard_recovery" ? "skeptic" : "hiring_manager";
  const voice = voiceFor(persona, (await savedStyles(user.id))[persona]);
  return ndjson<RoomEvent>(speak(null, user.id, drill.prompt, voice, drill.id === "hard_recovery" ? 5 : 2));
}, { limit: 30, name: "drill-speak", shared: true });
