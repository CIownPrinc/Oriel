import type { DomainId } from "@/lib/interview/domain-packs";

export type PlanId = "free" | "sprint" | "pro" | "executive" | "campus";

export interface PlanDef {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  /** Hard limits — consumed only by entitlements.ts. */
  limits: {
    sessionsPerWeek: number | null;
    maxSessionMinutes: number;
    /** Managed (external, billed) avatar minutes per period. The local avatar is free to run. */
    managedAvatarMinutes: number;
    panelMode: boolean;
    maxPanelSize: number;
    playback: "basic" | "full";
    advancedRead: boolean;
    drillsPerDay: number | null;
    ladder: boolean;
    domainPacks: DomainId[] | "all";
    periodDays: number | null; // null = monthly rolling
  };
}

const CORE_PACKS: DomainId[] = ["software", "product", "consulting", "finance", "research", "government"];

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free", name: "Free", price: "$0", cadence: "",
    blurb: "Try a real practice interview.",
    features: ["One 10-minute session per week", "Voice analysis and transcript", "Basic feedback with three key moments"],
    limits: { sessionsPerWeek: 1, maxSessionMinutes: 10, managedAvatarMinutes: 5, panelMode: false, maxPanelSize: 0, playback: "basic", advancedRead: false, drillsPerDay: 1, ladder: false, domainPacks: CORE_PACKS, periodDays: null },
  },
  sprint: {
    id: "sprint", name: "Sprint", price: "$79", cadence: "once · 14 days",
    blurb: "For an interview on the calendar.",
    features: ["14 days of practice", "Unlimited interviews, up to 45 minutes each", "Panel interviews", "Full feedback and replay", "Two drills per day"],
    limits: { sessionsPerWeek: null, maxSessionMinutes: 45, managedAvatarMinutes: 120, panelMode: true, maxPanelSize: 3, playback: "full", advancedRead: true, drillsPerDay: 2, ladder: true, domainPacks: CORE_PACKS, periodDays: 14 },
  },
  pro: {
    id: "pro", name: "Pro", price: "$29", cadence: "per month",
    blurb: "Build the skill over time.",
    features: ["Unlimited interviews, up to 45 minutes each", "Full feedback", "Progress tracking", "The Ladder"],
    limits: { sessionsPerWeek: null, maxSessionMinutes: 45, managedAvatarMinutes: 60, panelMode: false, maxPanelSize: 0, playback: "full", advancedRead: true, drillsPerDay: null, ladder: true, domainPacks: CORE_PACKS, periodDays: null },
  },
  executive: {
    id: "executive", name: "Executive", price: "Quote", cadence: "add-on",
    blurb: "Senior panels and domain depth.",
    features: ["All domain packs", "Panels of four", "Human coach review of one session"],
    limits: { sessionsPerWeek: null, maxSessionMinutes: 60, managedAvatarMinutes: 180, panelMode: true, maxPanelSize: 4, playback: "full", advancedRead: true, drillsPerDay: null, ladder: true, domainPacks: "all", periodDays: null },
  },
  campus: {
    id: "campus", name: "Campus", price: "Quote", cadence: "per student / year",
    blurb: "For career centers.",
    features: ["Admin dashboard", "Aggregate reporting", "No individual data shared without consent"],
    limits: { sessionsPerWeek: 3, maxSessionMinutes: 30, managedAvatarMinutes: 60, panelMode: true, maxPanelSize: 3, playback: "full", advancedRead: true, drillsPerDay: 2, ladder: true, domainPacks: CORE_PACKS, periodDays: null },
  },
};
