import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/db/client";
import { activeSubscription, loadEntitlementContext } from "@/lib/billing/entitlement-context";
import { PLANS } from "@/lib/billing/plans";
import { savedStyles } from "@/server/avatar-styles";
import { ProfileClient } from "./profile-client";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const db = getDb();
  const profile = (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get())!;
  const resume = await db.select().from(schema.resumes).where(and(eq(schema.resumes.userId, user.id), eq(schema.resumes.isActive, true))).orderBy(desc(schema.resumes.createdAt)).get();
  const jd = await db.select().from(schema.jobDescriptions).where(and(eq(schema.jobDescriptions.userId, user.id), eq(schema.jobDescriptions.isActive, true))).orderBy(desc(schema.jobDescriptions.createdAt)).get();
  const consents = await db.select().from(schema.consentRecords).where(eq(schema.consentRecords.userId, user.id)).orderBy(desc(schema.consentRecords.createdAt)).limit(12).all();
  const sub = await activeSubscription(user.id);
  const ent = await loadEntitlementContext(user.id);
  const media = await db.select().from(schema.mediaObjects).where(and(eq(schema.mediaObjects.userId, user.id), eq(schema.mediaObjects.status, "complete"))).all();
  return (
    <div>
      <h1 className="text-display-l text-fg">{profile.name}</h1>
      <p className="mt-3 text-body-l text-fg-muted">{user.email} · {profile.targetRole}</p>
      <ProfileClient
        privacy={{ cameraMetricsEnabled: profile.cameraMetricsEnabled, gazeMetricEnabled: profile.gazeMetricEnabled, postureMetricEnabled: profile.postureMetricEnabled, recordVideo: profile.recordVideo, videoRetentionDays: profile.videoRetentionDays }}
        resume={resume ? { name: resume.fileName ?? "Pasted resume", roles: resume.parsed?.roles.map((r) => `${r.title}${r.organization ? ` · ${r.organization}` : ""}`) ?? [], createdAt: resume.createdAt.toISOString() } : null}
        jd={jd ? { title: jd.parsed?.title ?? "Job description", competencies: jd.parsed?.competencies.map((c) => c.label) ?? [] } : null}
        plan={{ id: ent.plan, name: PLANS[ent.plan].name, periodEnd: sub?.periodEnd?.toISOString() ?? null, sessionsThisWeek: ent.usage.sessionsThisWeek, drillsToday: ent.usage.drillsToday }}
        storedRecordings={media.length}
        consents={consents.map((c) => ({ id: c.id, kind: c.kind, granted: c.granted, version: c.version, at: c.createdAt.toISOString() }))}
        styles={await savedStyles(user.id)}
      />
    </div>
  );
}
