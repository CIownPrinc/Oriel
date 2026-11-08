import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { HttpError } from "@/lib/api/errors";
import { hashPassword } from "@/lib/security/password";
import { CONSENT_VERSION } from "@/lib/privacy/consent";

/**
 * Create an ordinary account from public signup. Signup never grants admin: an email address
 * typed into a form proves nothing about who owns it. Admins are provisioned with
 * `npm run admin:grant`, which needs direct database access.
 */
export async function registerAccount(email: string, password: string, userAgent: string | null): Promise<string> {
  const db = getDb();
  if (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get()) {
    throw new HttpError(409, "An account with that email already exists", "email_taken");
  }
  const id = newId("usr");
  await db.insert(schema.users).values({ id, email, passwordHash: await hashPassword(password), role: "user" }).run();
  await db.insert(schema.consentRecords).values({ id: newId("cns"), userId: id, kind: "terms", version: CONSENT_VERSION, granted: true, userAgent: userAgent?.slice(0, 200) ?? null }).run();
  await db.insert(schema.subscriptions).values({ id: newId("sub"), userId: id, plan: "free", periodStart: new Date() }).run();
  return id;
}

/** Operator-only: change an existing account's role and sign it out everywhere so the change takes effect. */
export async function setAccountRole(email: string, role: "user" | "admin"): Promise<boolean> {
  const db = getDb();
  const user = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email.trim().toLowerCase())).get();
  if (!user) return false;
  await db.update(schema.users).set({ role }).where(eq(schema.users.id, user.id)).run();
  await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, user.id)).run();
  return true;
}
