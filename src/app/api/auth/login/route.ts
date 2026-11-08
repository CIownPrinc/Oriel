import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { verifyPassword } from "@/lib/security/password";
import { sharedRateLimit } from "@/lib/security/shared-limits";
import { audit } from "@/lib/security/audit";
import { createSession } from "@/lib/auth/session";
import { clientIp, errorResponse, json, parseBody } from "@/lib/api/http";

const Body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const ip = await clientIp();
    const body = await parseBody(req, Body);
    if (!(await sharedRateLimit(`login:${ip}:${body.email}`, 8, 15 * 60_000)).ok) return json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
    const user = await getDb().select().from(schema.users).where(and(eq(schema.users.email, body.email), isNull(schema.users.deletedAt))).get();
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      await audit("auth.login_failed", { ip, data: { email: body.email } });
      return json({ error: "Email or password is incorrect" }, { status: 401 });
    }
    await createSession(user.id);
    await audit("auth.login", { userId: user.id, ip });
    return json({ ok: true, onboarded: !!user.onboardedAt });
  } catch (err) {
    return errorResponse(err);
  }
}
