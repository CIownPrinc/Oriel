import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oriel-parts-"));

const currentUser = vi.hoisted(() => ({ value: null as null | { id: string; email: string; role: "user" | "admin" } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => currentUser.value }));

import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { readRange } from "@/lib/privacy/media-store";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { createInterview } from "@/server/interview/service";
import { sessionDetail } from "@/server/queries";
import { partAt } from "@/lib/playback/parts";
import { POST as postMedia } from "@/app/api/sessions/[id]/media/route";

const base = { role: "Product Manager", domain: "product", level: "hiring_manager", type: "behavioral" as const, pressure: 2, persona: "skeptic" as const, mode: "single" as const, panelSize: 3, ladderLevel: null, targetMinutes: 15, cameraMetrics: true };

async function signedInWithSession() {
  const db = getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, email: `${id}@oriel.test`, passwordHash: "x", onboardedAt: new Date() }).run();
  await db.insert(schema.profiles).values({ userId: id, name: "Ari Patel", targetRole: "PM", domain: "product" }).run();
  await db.insert(schema.subscriptions).values({ id: newId("sub"), userId: id, plan: "pro", periodStart: new Date() }).run();
  await db.insert(schema.ladderProgress).values({ userId: id, level: 1, unlockedAt: new Date() }).run();
  currentUser.value = { id, email: `${id}@oriel.test`, role: "user" };
  const { sessionId } = await createInterview(id, base);
  return { userId: id, sessionId };
}

function upload(sessionId: string, query: string, body: string) {
  const req = new Request(`http://localhost/api/sessions/${sessionId}/media?${query}`, { method: "POST", headers: { "x-media-type": "video/webm" }, body });
  return postMedia(req, { params: Promise.resolve({ id: sessionId }) });
}

beforeEach(() => resetRateLimits());

describe("FIX-06 · recordings survive a reload", () => {
  it("stores a second recorder's footage as its own part instead of discarding it as a duplicate", async () => {
    const { userId, sessionId } = await signedInWithSession();
    // First page load records two chunks...
    expect((await upload(sessionId, "part=first-load-0001&offset=0&seq=0", "AAAA")).status).toBe(200);
    expect((await upload(sessionId, "part=first-load-0001&offset=0&seq=1", "BBBB")).status).toBe(200);
    // ...the page reloads 30 s in, and the new recorder starts again at seq 0.
    const res = await upload(sessionId, "part=second-load-0002&offset=30000&seq=0", "CCCC");
    expect(await res.json()).toMatchObject({ stored: true, segments: 1 });

    const parts = await getDb().select().from(schema.mediaObjects).where(eq(schema.mediaObjects.sessionId, sessionId)).all();
    expect(parts).toHaveLength(2);
    const first = parts.find((p) => p.partKey === "first-load-0001")!;
    const second = parts.find((p) => p.partKey === "second-load-0002")!;
    expect((await readRange(userId, first.id, 0, 7)).toString()).toBe("AAAABBBB");
    expect((await readRange(userId, second.id, 0, 3)).toString()).toBe("CCCC");
    expect(second.startOffsetMs).toBe(30000);
    // Both parts carry the session's retention deadline.
    const session = await getDb().select().from(schema.interviewSessions).where(eq(schema.interviewSessions.id, sessionId)).get();
    expect(second.expiresAt?.getTime()).toBe(session!.videoExpiresAt!.getTime());
  });

  it("treats a retried chunk within a part as already stored", async () => {
    const { sessionId } = await signedInWithSession();
    await upload(sessionId, "part=retry-part-0001&offset=0&seq=0", "AAAA");
    const again = await upload(sessionId, "part=retry-part-0001&offset=0&seq=0", "AAAA");
    expect(await again.json()).toMatchObject({ stored: false, segments: 1 });
  });

  it("keeps clients without parts working, as one recording", async () => {
    const { sessionId } = await signedInWithSession();
    expect((await upload(sessionId, "seq=0", "AAAA")).status).toBe(200);
    expect((await upload(sessionId, "seq=1", "BBBB")).status).toBe(200);
    const parts = await getDb().select().from(schema.mediaObjects).where(eq(schema.mediaObjects.sessionId, sessionId)).all();
    expect(parts).toHaveLength(1);
    expect(parts[0].segments).toBe(2);
  });

  it("rejects malformed part keys and offsets", async () => {
    const { sessionId } = await signedInWithSession();
    expect((await upload(sessionId, "part=../../etc&seq=0", "A")).status).toBe(400);
    expect((await upload(sessionId, "part=valid-part-0001&offset=-5&seq=0", "A")).status).toBe(400);
  });

  it("gives Playback every part in session-clock order, and seeks into the right one", async () => {
    const { userId, sessionId } = await signedInWithSession();
    await upload(sessionId, "part=later-part-0002&offset=45000&seq=0", "LATER");
    await upload(sessionId, "part=early-part-0001&offset=0&seq=0", "EARLY");
    const d = await sessionDetail(sessionId, userId);
    expect(d!.media!.parts.map((p) => p.startMs)).toEqual([0, 45000]);
    expect(partAt(d!.media!.parts, 10_000)).toBe(0);
    expect(partAt(d!.media!.parts, 45_000)).toBe(1);
    expect(partAt(d!.media!.parts, 90_000)).toBe(1);
    expect(d!.mediaDeleted).toBe(false);
  });
});
