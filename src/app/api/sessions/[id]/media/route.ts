import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { authed, HttpError, json, type IdParams } from "@/lib/api/http";
import { appendSegment, createMedia } from "@/lib/privacy/media-store";
import { loadSession } from "@/server/interview/service";
import { isPastRetention } from "@/server/privacy/retention";

const MAX_CHUNK = 12 * 1024 * 1024;
const ALLOWED = /^(video|audio)\/(webm|mp4)(;.*)?$/;

const PART_KEY = /^[\w-]{8,64}$/;
/** Clients from before recording parts send no part: they get one shared part, as before. */
const LEGACY_PART = "legacy-recording";

/**
 * Append one MediaRecorder chunk to a part of the session recording. Encrypted at rest.
 * `?part=<key>&offset=<ms>&seq=<n>`: each recorder (a page load of the Room) uploads its own part,
 * starting at `offset` on the session clock; `seq` orders chunks within the part, and retrying a
 * chunk that was already stored is a no-op.
 */
export const POST = authed<IdParams>(async (req, { params, user }) => {
  const { id } = await params;
  const { session, profile } = await loadSession(id, user.id);
  if (profile && !profile.recordVideo) throw new HttpError(403, "Recording is turned off in your privacy settings");
  if (isPastRetention(session)) throw new HttpError(410, "This session is past its retention period, so it no longer accepts recordings", "retention_expired");
  const query = new URL(req.url).searchParams;
  const seq = Number(query.get("seq"));
  if (!Number.isInteger(seq) || seq < 0) throw new HttpError(400, "Missing seq");
  const partKey = query.get("part") ?? LEGACY_PART;
  if (!PART_KEY.test(partKey)) throw new HttpError(400, "Invalid recording part");
  const offset = Number(query.get("offset") ?? 0);
  if (!Number.isFinite(offset) || offset < 0) throw new HttpError(400, "Invalid recording offset");
  const mime = req.headers.get("x-media-type") ?? "video/webm";
  if (!ALLOWED.test(mime)) throw new HttpError(415, "Unsupported media type");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return json({ ok: true, empty: true });
  if (buf.length > MAX_CHUNK) throw new HttpError(413, "Chunk too large");
  const db = getDb();
  const findPart = () => db.select().from(schema.mediaObjects).where(and(eq(schema.mediaObjects.sessionId, id), eq(schema.mediaObjects.kind, "session_recording"), eq(schema.mediaObjects.partKey, partKey))).get();
  let media = await findPart();
  if (!media) {
    const mediaId = newId("med");
    const storageKey = await createMedia(user.id, mediaId, mime);
    // Two first chunks for the same part can race (a retry while the first is in flight): the unique
    // index on (session, part) lets only one insert win, and both then use that row.
    await db.insert(schema.mediaObjects).values({
      id: mediaId, userId: user.id, sessionId: id, kind: "session_recording", mimeType: mime, storageKey, expiresAt: session.videoExpiresAt, partKey, startOffsetMs: Math.round(offset),
    }).onConflictDoNothing().run();
    media = (await findPart())!;
  }
  if (media.status === "deleted") throw new HttpError(410, "Recording was deleted");
  let r;
  try {
    r = await appendSegment(user.id, media.id, seq, buf);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("out-of-order")) throw new HttpError(409, err.message, "out_of_order");
    throw err;
  }
  await db.update(schema.mediaObjects).set({ bytes: r.totalBytes, segments: r.segments }).where(eq(schema.mediaObjects.id, media.id)).run();
  return json({ ok: true, stored: r.stored, segments: r.segments });
}, { limit: 400, name: "session-media" });
