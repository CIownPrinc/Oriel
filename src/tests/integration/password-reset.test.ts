import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Capture the email instead of sending it; the test reads the link from it.
const outbox = vi.hoisted(() => ({ sent: [] as { to: string; text: string }[] }));
vi.mock("@/lib/email", () => ({
  emailConfigured: () => true,
  canDeliverEmail: () => true,
  sendEmail: async (m: { to: string; text: string }) => { outbox.sent.push(m); },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { RESET_TTL_MS, requestPasswordReset, resetPassword } from "@/server/password-reset";
import { POST as forgot } from "@/app/api/auth/forgot-password/route";

async function makeUser(email: string) {
  const id = newId("usr");
  await getDb().insert(schema.users).values({ id, email, passwordHash: await hashPassword("old password 123") }).run();
  await getDb().insert(schema.authSessions).values({ id: newId("tok"), userId: id, expiresAt: new Date(Date.now() + 86400_000) }).run();
  return id;
}
const tokenFrom = (text: string) => new URL(/https?:\/\/\S+/.exec(text)![0]).searchParams.get("token")!;
const userRow = (id: string) => getDb().select().from(schema.users).where(eq(schema.users.id, id)).get();

beforeEach(() => {
  outbox.sent = [];
  resetRateLimits();
});

describe("FIX-10 · password reset", () => {
  it("emails a link that sets a new password once and signs out every other session", async () => {
    const id = await makeUser("reset-a@oriel.test");
    await requestPasswordReset("Reset-A@oriel.test");
    expect(outbox.sent).toHaveLength(1);
    const token = tokenFrom(outbox.sent[0].text);
    expect(await resetPassword(token, "brand new password")).toBe(id);
    expect(await verifyPassword("brand new password", (await userRow(id))!.passwordHash)).toBe(true);
    expect(await getDb().select().from(schema.authSessions).where(eq(schema.authSessions.userId, id)).all()).toHaveLength(0);
    await expect(resetPassword(token, "another password 1")).rejects.toMatchObject({ status: 400 });
  });

  it("stores only a hash of the link's code", async () => {
    const id = await makeUser("reset-b@oriel.test");
    await requestPasswordReset("reset-b@oriel.test");
    const token = tokenFrom(outbox.sent[0].text);
    const rows = await getDb().select().from(schema.passwordResets).where(eq(schema.passwordResets.userId, id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(token);
  });

  it("refuses an expired link", async () => {
    await makeUser("reset-c@oriel.test");
    const asked = new Date(Date.now() - RESET_TTL_MS - 1000);
    await requestPasswordReset("reset-c@oriel.test", asked);
    await expect(resetPassword(tokenFrom(outbox.sent[0].text), "brand new password")).rejects.toMatchObject({ status: 400 });
  });

  it("makes an older link useless once a newer one is requested", async () => {
    await makeUser("reset-d@oriel.test");
    await requestPasswordReset("reset-d@oriel.test");
    await requestPasswordReset("reset-d@oriel.test");
    await expect(resetPassword(tokenFrom(outbox.sent[0].text), "brand new password")).rejects.toMatchObject({ status: 400 });
    await expect(resetPassword(tokenFrom(outbox.sent[1].text), "brand new password")).resolves.toBeTruthy();
  });

  it("lets only one of two simultaneous uses of a link through", async () => {
    await makeUser("reset-e@oriel.test");
    await requestPasswordReset("reset-e@oriel.test");
    const token = tokenFrom(outbox.sent[0].text);
    const results = await Promise.allSettled([resetPassword(token, "first new password"), resetPassword(token, "second new password")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("answers the same for an unknown email, without sending anything", async () => {
    await makeUser("reset-f@oriel.test");
    const ask = (email: string) => forgot(new Request("http://localhost/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }));
    const known = await ask("reset-f@oriel.test");
    const unknown = await ask("nobody-here@oriel.test");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect(outbox.sent.map((m) => m.to)).toEqual(["reset-f@oriel.test"]);
  });

  it("rejects a too-short new password before using up the link", async () => {
    await makeUser("reset-g@oriel.test");
    await requestPasswordReset("reset-g@oriel.test");
    const token = tokenFrom(outbox.sent[0].text);
    await expect(resetPassword(token, "short")).rejects.toMatchObject({ status: 400 });
    await expect(resetPassword(token, "long enough now")).resolves.toBeTruthy();
  });
});
