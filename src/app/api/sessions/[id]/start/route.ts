import { authed, ndjson, type IdParams } from "@/lib/api/http";
import { runOpening, type RoomEvent } from "@/server/interview/service";
import { HttpError } from "@/lib/api/http";

// Streams speech, which can outlast a short default limit on serverless hosts.
export const maxDuration = 60;

export const POST = authed<IdParams>(async (_req, { params, user }) => {
  const { id } = await params;
  return ndjson<RoomEvent>(runOpening(id, user.id), (err) => ({
    type: "error", message: err instanceof HttpError ? err.message : "The interviewer couldn't start", recoverable: !(err instanceof HttpError && err.status === 404),
  }));
}, { limit: 20, name: "session-start", shared: true });
