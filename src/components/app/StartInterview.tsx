import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { loadEntitlementContext } from "@/lib/billing/entitlement-context";
import { listSessions } from "@/server/queries";
import { quickStartSetup } from "@/server/quick-start";
import { ButtonLink } from "@/components/ui/Button";
import { QuickStart } from "./QuickStart";

/** "Start interview", wherever a page offers it: the same one tap as on Home, with your saved setup. */
export async function StartInterview({ userId, label }: { userId: string; label?: string }) {
  const [profile, ent, sessions] = await Promise.all([
    getDb().select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).get(),
    loadEntitlementContext(userId),
    listSessions(userId, 1),
  ]);
  if (!profile) return <ButtonLink href="/practice" size="lg">{label ?? "Start interview"}</ButtonLink>;
  const q = quickStartSetup(profile, ent, sessions.length === 0);
  return <QuickStart setup={q.setup} blocked={q.blocked} label={label} />;
}
