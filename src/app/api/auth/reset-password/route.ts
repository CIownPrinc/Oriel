import { z } from "zod";
import { sharedRateLimit } from "@/lib/security/shared-limits";
import { createSession } from "@/lib/auth/session";
import { clientIp, errorResponse, json, parseBody } from "@/lib/api/http";
import { MIN_PASSWORD, resetPassword } from "@/server/password-reset";

const Body = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`).max(200),
});

/** Set a new password from a reset link. Every other session is signed out; this one is signed in. */
export async function POST(req: Request) {
  try {
    const ip = await clientIp();
    if (!(await sharedRateLimit(`reset-set:${ip}`, 10, 15 * 60_000)).ok) return json({ error: "Too many attempts. Try again later." }, { status: 429 });
    const body = await parseBody(req, Body);
    const userId = await resetPassword(body.token, body.password);
    await createSession(userId);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
