import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { authed, HttpError, json, parseBody, type IdParams } from "@/lib/api/http";
import { loadSession } from "@/server/interview/service";
import { isPastRetention } from "@/server/privacy/retention";

// Only derived numbers are accepted — the schema has no field that could carry an image or landmarks.
const Audio = z.object({ t: z.number(), rms: z.number().min(0).max(1), voiced: z.boolean(), pitch: z.number().nullable() });
const Vision = z.object({
  t: z.number(), face: z.boolean(), engaged: z.number().min(0).max(1).nullable(), yaw: z.number().nullable(), pitch: z.number().nullable(),
  lean: z.number().nullable(), slouch: z.number().nullable(), sway: z.number().nullable(), motion: z.number().nullable(), brightness: z.number().nullable(),
});
const Setup = z.object({ brightness: z.number().nullable(), faceX: z.number().nullable(), faceY: z.number().nullable(), faceSize: z.number().nullable(), micLevelDb: z.number().nullable(), noiseFloorDb: z.number().nullable() });
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("audio"), startMs: z.number(), samples: z.array(Audio).max(2000) }),
  z.object({ kind: z.literal("vision"), startMs: z.number(), samples: z.array(Vision).max(2000) }),
  z.object({ kind: z.literal("setup"), startMs: z.number(), samples: z.array(Setup).max(1) }),
]);

export const POST = authed<IdParams>(async (req, { params, user }) => {
  const { id } = await params;
  const { session } = await loadSession(id, user.id);
  if (isPastRetention(session)) throw new HttpError(410, "This session is past its retention period, so it no longer accepts new data", "retention_expired");
  const body = await parseBody(req, Body);
  if (body.kind !== "audio" && !session.cameraMetricsEnabled) return json({ ok: true, ignored: "camera metrics disabled" });
  await getDb().insert(schema.signalTimelines).values({ id: newId("sig"), sessionId: id, kind: body.kind, startMs: Math.round(body.startMs), samples: body.samples }).run();
  return json({ ok: true });
}, { limit: 240, name: "session-signals" });
