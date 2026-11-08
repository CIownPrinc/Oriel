import { z } from "zod";
import { authed, HttpError, ndjson, parseBody, type IdParams } from "@/lib/api/http";
import { runTurn, type RoomEvent } from "@/server/interview/service";

const Body = z.object({
  answerText: z.string().max(12000),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  firstWordLatencyMs: z.number().min(0).max(600000).nullable(),
  interrupted: z.boolean(),
  inputMode: z.enum(["voice", "text"]),
  prevQuestion: z.object({ questionId: z.string(), startMs: z.number(), endMs: z.number() }).nullable(),
  clientTimings: z.record(z.string(), z.number()).optional(),
  /** Same key on a retried request, so the answer is stored once. Optional for older clients. */
  turnKey: z.string().regex(/^[\w-]{8,64}$/).optional(),
});

// Streams speech, which can outlast a short default limit on serverless hosts.
export const maxDuration = 60;

export const POST = authed<IdParams>(async (req, { params, user }) => {
  const { id } = await params;
  const body = await parseBody(req, Body);
  return ndjson<RoomEvent>(runTurn(id, user.id, body), (err) => ({
    type: "error", message: err instanceof HttpError ? err.message : "The interviewer lost the thread", recoverable: true,
  }));
}, { limit: 60, name: "session-turn", shared: true });
