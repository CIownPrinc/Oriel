import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/db/client";
import { ladderState } from "@/server/queries";
import { loadEntitlementContext } from "@/lib/billing/entitlement-context";
import { canStartSession, canUseLadder, canUsePanelMode, maxPanelSize, maxSessionMinutes } from "@/lib/billing/entitlements";
import { PLANS } from "@/lib/billing/plans";
import { savedStyles } from "@/server/avatar-styles";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Practice" };

export default async function PracticePage({ searchParams }: { searchParams: Promise<{ ladder?: string; first?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const profile = (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get())!;
  const resume = await db.select({ id: schema.resumes.id, fileName: schema.resumes.fileName, parsed: schema.resumes.parsed }).from(schema.resumes).where(and(eq(schema.resumes.userId, user.id), eq(schema.resumes.isActive, true))).orderBy(desc(schema.resumes.createdAt)).get();
  const jd = await db.select({ id: schema.jobDescriptions.id, parsed: schema.jobDescriptions.parsed }).from(schema.jobDescriptions).where(and(eq(schema.jobDescriptions.userId, user.id), eq(schema.jobDescriptions.isActive, true))).orderBy(desc(schema.jobDescriptions.createdAt)).get();
  const ent = await loadEntitlementContext(user.id);
  const { steps, current } = await ladderState(user.id);
  const start = canStartSession(ent);
  return (
    <SetupForm
      profile={{ targetRole: profile.targetRole, domain: profile.domain, type: profile.preferredInterviewType, persona: profile.preferredPersona, experience: profile.experienceLevel, cameraMetrics: profile.cameraMetricsEnabled }}
      resume={resume ? { name: resume.fileName ?? "Pasted resume", roles: resume.parsed?.roles.length ?? 0 } : null}
      jd={jd ? { title: jd.parsed?.title ?? "Job description", competencies: jd.parsed?.competencies.map((c) => c.label) ?? [] } : null}
      ladder={steps.map((s) => ({ level: s.level, name: s.name, description: s.description, unlocked: s.unlocked, mode: s.mode, pressure: s.pressure, personaIds: s.personaIds }))}
      currentLadder={current.level}
      initialLadder={sp.ladder ? Number(sp.ladder) : null}
      firstRun={sp.first === "1"}
      styles={await savedStyles(user.id)}
      limits={{
        plan: PLANS[ent.plan].name, canStart: start.allowed ? null : start.reason, panel: canUsePanelMode(ent, 2).allowed,
        maxPanel: maxPanelSize(ent), ladder: canUseLadder(ent).allowed, maxMinutes: maxSessionMinutes(ent),
      }}
    />
  );
}
