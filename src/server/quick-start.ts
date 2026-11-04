import "server-only";
import type { QuickStartSetup } from "@/components/app/QuickStart";
import { SOLO_INTERVIEWERS, type SoloInterviewer } from "@/lib/interview/personas";
import { canStartSession, maxSessionMinutes, type EntitlementContext } from "@/lib/billing/entitlements";

type ProfileLike = { targetRole: string; domain: string; experienceLevel: string; preferredInterviewType: string; preferredPersona: string; cameraMetricsEnabled: boolean };

/** The interview stage that fits your experience: senior people meet senior interviewers. */
export function stageFor(experience: string): QuickStartSetup["level"] {
  return experience === "executive" ? "executive" : experience === "senior" ? "senior_manager" : "hiring_manager";
}

/** The interviewer you chose in onboarding, if it's one you can face one-on-one. */
export function chosenInterviewer(persona: string): SoloInterviewer {
  return (SOLO_INTERVIEWERS as readonly string[]).includes(persona) ? (persona as SoloInterviewer) : "hiring_manager";
}

/**
 * The interview Home starts in one tap, built from what onboarding asked. A first session runs at
 * a gentler pressure; after that, Realistic.
 */
export function quickStartSetup(profile: ProfileLike, ent: EntitlementContext, firstRun: boolean): { setup: QuickStartSetup; blocked: string | null } {
  const verdict = canStartSession(ent);
  return {
    setup: {
      role: profile.targetRole || "Candidate",
      domain: profile.domain,
      level: stageFor(profile.experienceLevel),
      type: profile.preferredInterviewType as QuickStartSetup["type"],
      persona: chosenInterviewer(profile.preferredPersona),
      pressure: firstRun ? 2 : 3,
      targetMinutes: Math.min(15, maxSessionMinutes(ent)),
      cameraMetrics: profile.cameraMetricsEnabled,
    },
    blocked: verdict.allowed ? null : verdict.reason,
  };
}
