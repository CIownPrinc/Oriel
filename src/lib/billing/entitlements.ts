import { PLANS, type PlanId } from "./plans";

/**
 * The single place plan rules are evaluated. Everything else asks these functions.
 * Pure: callers load an EntitlementContext (see entitlement-context.ts) and pass it in.
 */
export interface EntitlementContext {
  plan: PlanId;
  planActive: boolean;
  usage: {
    sessionsThisWeek: number;
    managedAvatarMinutesThisPeriod: number;
    drillsToday: number;
  };
}

export type Verdict = { allowed: true } | { allowed: false; reason: string; upgradeTo?: PlanId };

const ok: Verdict = { allowed: true };
const deny = (reason: string, upgradeTo?: PlanId): Verdict => ({ allowed: false, reason, upgradeTo });

/**
 * Plan limits are off until pricing is switched on: everyone gets everything. Set
 * ORIEL_ENFORCE_LIMITS=1 to enforce each plan's limits; nothing else needs to change.
 */
export function limitsEnforced() {
  return process.env.ORIEL_ENFORCE_LIMITS === "1";
}

const OPEN: (typeof PLANS)[PlanId]["limits"] = { ...PLANS.executive.limits, managedAvatarMinutes: Number.POSITIVE_INFINITY };

function limits(ctx: EntitlementContext) {
  return limitsEnforced() ? PLANS[ctx.planActive ? ctx.plan : "free"].limits : OPEN;
}

export function canStartSession(ctx: EntitlementContext): Verdict {
  const l = limits(ctx);
  if (l.sessionsPerWeek !== null && ctx.usage.sessionsThisWeek >= l.sessionsPerWeek) {
    return deny(`Your plan includes ${l.sessionsPerWeek} session${l.sessionsPerWeek === 1 ? "" : "s"} per week.`, "sprint");
  }
  return ok;
}

export function canUsePanelMode(ctx: EntitlementContext, size = 3): Verdict {
  const l = limits(ctx);
  if (!l.panelMode) return deny("Panel interviews are part of Sprint and Executive.", "sprint");
  if (size > l.maxPanelSize) return deny(`Your plan supports panels of up to ${l.maxPanelSize}.`, "executive");
  return ok;
}

export function canUseAvatarMinutes(ctx: EntitlementContext, minutes: number): Verdict {
  const l = limits(ctx);
  if (ctx.usage.managedAvatarMinutesThisPeriod + minutes > l.managedAvatarMinutes) {
    return deny("You've used this period's avatar minutes. The on-device interviewer is still available.", "pro");
  }
  return ok;
}

export function canUsePlayback(ctx: EntitlementContext): { level: "basic" | "full"; maxClips: number } {
  const level = limits(ctx).playback;
  return { level, maxClips: level === "full" ? 5 : 3 };
}

export function canUseAdvancedRead(ctx: EntitlementContext): Verdict {
  return limits(ctx).advancedRead ? ok : deny("Vocal variety, posture timeline and recovery comparison are in the full Read.", "pro");
}

export function canUseDomainPack(ctx: EntitlementContext, domain: string): Verdict {
  const packs = limits(ctx).domainPacks;
  if (packs === "all" || (packs as string[]).includes(domain)) return ok;
  return deny("This domain pack is part of the Executive add-on.", "executive");
}

export function canUseLadder(ctx: EntitlementContext): Verdict {
  return limits(ctx).ladder ? ok : deny("The Ladder is part of Pro and Sprint.", "pro");
}

export function canStartDrill(ctx: EntitlementContext): Verdict {
  const l = limits(ctx);
  if (l.drillsPerDay !== null && ctx.usage.drillsToday >= l.drillsPerDay) {
    return deny(`Your plan includes ${l.drillsPerDay} drill${l.drillsPerDay === 1 ? "" : "s"} per day.`, "pro");
  }
  return ok;
}

export function maxPanelSize(ctx: EntitlementContext): number {
  return limits(ctx).maxPanelSize;
}

export function maxSessionMinutes(ctx: EntitlementContext): number {
  return limits(ctx).maxSessionMinutes;
}
