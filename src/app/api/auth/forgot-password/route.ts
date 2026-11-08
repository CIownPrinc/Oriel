import { z } from "zod";
import { after } from "next/server";
import { sharedRateLimit } from "@/lib/security/shared-limits";
import { clientIp, errorResponse, json, parseBody } from "@/lib/api/http";
import { canDeliverEmail } from "@/lib/email";
import { requestPasswordReset } from "@/server/password-reset";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

/**
 * Ask for a reset link. The answer is the same whether or not the email has an account, and the
 * work happens after the response, so neither the reply nor its timing says which emails exist.
 */
export async function POST(req: Request) {
  try {
    const ip = await clientIp();
    const body = await parseBody(req, Body);
    if (!(await sharedRateLimit(`reset:${ip}`, 5, 15 * 60_000)).ok || !(await sharedRateLimit(`reset:${body.email}`, 3, 60 * 60_000)).ok) {
      return json({ error: "Too many reset requests. Try again later." }, { status: 429 });
    }
    if (!canDeliverEmail()) return json({ error: "Password reset by email isn't available yet." }, { status: 503 });
    after(() => requestPasswordReset(body.email).catch((err) => console.error("[reset]", err)));
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
