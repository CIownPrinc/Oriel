import "server-only";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { audit } from "@/lib/security/audit";
import { newId } from "@/lib/id";
import { CONSENT_VERSION } from "@/lib/privacy/consent";
import { consentTextHash } from "@/lib/privacy/consent-hash";
import { applyRetentionToExistingData } from "./retention";

export const PrivacySettings = z.object({
  cameraMetricsEnabled: z.boolean().optional(),
  gazeMetricEnabled: z.boolean().optional(),
  postureMetricEnabled: z.boolean().optional(),
  recordVideo: z.boolean().optional(),
  videoRetentionDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]).optional(),
});
export type PrivacySettings = z.infer<typeof PrivacySettings>;

// Every change to a consent-bearing setting is logged as a consent record (withdrawal included).
const CONSENT_FIELDS = {
  cameraMetricsEnabled: "camera_metrics", gazeMetricEnabled: "gaze_metric", postureMetricEnabled: "posture_metric", recordVideo: "recording",
} as const satisfies Partial<Record<keyof PrivacySettings, string>>;

/** Camera signals are anything derived from the camera: engagement/posture timelines and the setup check. */
const CAMERA_SIGNAL_KINDS: ("vision" | "setup")[] = ["vision", "setup"];

export async function updatePrivacySettings(userId: string, settings: PrivacySettings, userAgent: string | null): Promise<void> {
  const db = getDb();
  await db.update(schema.profiles).set({ ...settings, updatedAt: new Date() }).where(eq(schema.profiles.userId, userId)).run();
  if (settings.videoRetentionDays) await applyRetentionToExistingData(userId, settings.videoRetentionDays);
  await recordConsentChanges(userId, settings, userAgent);
  if (settings.cameraMetricsEnabled === false) await withdrawCameraConsent(userId);
  await audit("privacy.settings", { userId, data: settings });
}

async function recordConsentChanges(userId: string, settings: PrivacySettings, userAgent: string | null) {
  const db = getDb();
  for (const [field, kind] of Object.entries(CONSENT_FIELDS)) {
    const granted = settings[field as keyof typeof CONSENT_FIELDS];
    if (typeof granted !== "boolean") continue;
    await db.insert(schema.consentRecords).values({
      id: newId("cns"), userId, kind, version: CONSENT_VERSION, granted, textHash: consentTextHash(kind), source: "settings", userAgent: userAgent?.slice(0, 200) ?? null,
    }).run();
  }
}

/** Withdrawal applies to existing sessions too: no new camera data is accepted, and what was stored is deleted. */
export async function withdrawCameraConsent(userId: string): Promise<void> {
  const db = getDb();
  const owned = db.select({ id: schema.interviewSessions.id }).from(schema.interviewSessions).where(eq(schema.interviewSessions.userId, userId));
  await db.update(schema.interviewSessions).set({ cameraMetricsEnabled: false }).where(eq(schema.interviewSessions.userId, userId)).run();
  await db.delete(schema.signalTimelines).where(and(inArray(schema.signalTimelines.sessionId, owned), inArray(schema.signalTimelines.kind, CAMERA_SIGNAL_KINDS))).run();
}
