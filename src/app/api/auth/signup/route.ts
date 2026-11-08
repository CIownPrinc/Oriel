import { z } from "zod";
import { sharedRateLimit } from "@/lib/security/shared-limits";
import { audit } from "@/lib/security/audit";
import { createSession } from "@/lib/auth/session";
import { clientIp, errorResponse, json, parseBody } from "@/lib/api/http";
import { registerAccount } from "@/server/accounts";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  acceptTerms: z.literal(true, { message: "Please accept the terms to continue" }),
});

export async function POST(req: Request) {
  try {
    const ip = await clientIp();
    if (!(await sharedRateLimit(`signup:${ip}`, 10, 60 * 60_000)).ok) return json({ error: "Too many sign-ups from this network. Try again later." }, { status: 429 });
    const body = await parseBody(req, Body);
    const id = await registerAccount(body.email, body.password, req.headers.get("user-agent"));
    await createSession(id);
    await audit("auth.signup", { userId: id, ip });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
