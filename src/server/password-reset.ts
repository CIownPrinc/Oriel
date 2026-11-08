import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { HttpError } from "@/lib/api/errors";
import { hashPassword } from "@/lib/security/password";
import { audit } from "@/lib/security/audit";
import { sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/site";

/**
 * Password reset by email link.
 *  - The link carries a random 256-bit token; only its SHA-256 is stored.
 *  - It works for 30 minutes and only once. Asking again replaces older links.
 *  - Asking never reveals whether an account exists: the caller answers the same either way.
 *  - Setting a new password signs the account out everywhere.
 */
export const RESET_TTL_MS = 30 * 60_000;
export const MIN_PASSWORD = 8;

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export async function requestPasswordReset(email: string, now = new Date()): Promise<void> {
  const db = getDb();
  const user = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users)
    .where(and(eq(schema.users.email, email.trim().toLowerCase()), isNull(schema.users.deletedAt))).get();
  if (!user) {
    await audit("auth.reset_requested_unknown");
    return;
  }
  const token = randomBytes(32).toString("base64url");
  await db.delete(schema.passwordResets).where(eq(schema.passwordResets.userId, user.id)).run();
  await db.insert(schema.passwordResets).values({ id: hashToken(token), userId: user.id, expiresAt: new Date(now.getTime() + RESET_TTL_MS) }).run();
  const link = `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your Oriel password",
    text: `Someone asked to reset the password for your Oriel account.\n\nTo choose a new password, open this link within 30 minutes:\n${link}\n\nIf you didn't ask for this, ignore this email. Your password won't change.`,
  });
  await audit("auth.reset_requested", { userId: user.id });
}

/** Set a new password from a reset link. Returns the user id, so the caller can sign them in. */
export async function resetPassword(token: string, newPassword: string, now = new Date()): Promise<string> {
  if (newPassword.length < MIN_PASSWORD) throw new HttpError(400, `Use at least ${MIN_PASSWORD} characters`, "weak_password");
  const db = getDb();
  // Claim the link first, in one conditional update, so it can't be used twice even concurrently.
  const id = hashToken(token);
  const claimed = await db.update(schema.passwordResets).set({ usedAt: now })
    .where(and(eq(schema.passwordResets.id, id), isNull(schema.passwordResets.usedAt), gt(schema.passwordResets.expiresAt, now))).run();
  if (claimed.rowsAffected !== 1) throw new HttpError(400, "This reset link has expired or was already used. Ask for a new one.", "invalid_reset");
  const reset = (await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.id, id)).get())!;
  await db.update(schema.users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(schema.users.id, reset.userId)).run();
  await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, reset.userId)).run();
  await audit("auth.password_reset", { userId: reset.userId });
  return reset.userId;
}
