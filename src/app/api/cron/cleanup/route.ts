import { createHash, timingSafeEqual } from "node:crypto";
import { json } from "@/lib/api/http";
import { runScheduledCleanup } from "@/server/privacy/retention";

export const maxDuration = 300;

/**
 * Retention cleanup, called on a schedule (vercel.json → crons). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused, and without
 * CRON_SECRET set the route refuses everything.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "Scheduled cleanup isn't configured: set CRON_SECRET" }, { status: 503 });
  if (!bearerMatches(req.headers.get("authorization"), secret)) return json({ error: "Not authorized" }, { status: 401 });
  const result = await runScheduledCleanup("cron");
  const failed = result.status === "failed";
  if (result.status !== "succeeded" && result.status !== "skipped") console.error("[cleanup]", JSON.stringify(result));
  return json(result, { status: failed ? 500 : 200 });
}

function bearerMatches(header: string | null, secret: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
