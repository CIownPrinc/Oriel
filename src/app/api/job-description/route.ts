import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { authed, json, parseBody } from "@/lib/api/http";
import { parseJobDescription } from "@/lib/ai/analyzers";
import { getLanguageModel } from "@/lib/ai/providers/registry";
import { recordTokenCost } from "@/lib/costs/record";
import { logEvent } from "@/lib/costs/events";
import { assertWithinDailyCost } from "@/lib/security/shared-limits";

const Body = z.object({ text: z.string().trim().min(40, "Paste the job description (at least a few lines)").max(30000) });

export const POST = authed(async (req, { user }) => {
  await assertWithinDailyCost(user.id);
  const { text } = await parseBody(req, Body);
  const llm = getLanguageModel();
  const parsed = await parseJobDescription(llm, text);
  if (parsed.usage) await recordTokenCost({ userId: user.id }, llm.id, "analysis", "jd_parser", parsed.usage);
  logEvent("llm_output", "jd_parser", { userId: user.id, durationMs: parsed.latencyMs, data: { source: parsed.source, competencies: parsed.data.competencies, error: parsed.error ?? null } });
  const db = getDb();
  const id = newId("jd");
  await db.transaction(async (tx) => {
    // Replacing a document deletes the old version (privacy policy: kept until replaced or deleted).
    await tx.delete(schema.jobDescriptions).where(eq(schema.jobDescriptions.userId, user.id)).run();
    await tx.insert(schema.jobDescriptions).values({ id, userId: user.id, rawText: text, parsed: parsed.data }).run();
  });
  return json({ id, parsed: parsed.data });
}, { limit: 10, shared: true });
