import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStartDrill, canStartSession, canUseLadder, canUsePanelMode, canUsePlayback, maxPanelSize, maxSessionMinutes, type EntitlementContext } from "@/lib/billing/entitlements";

const free: EntitlementContext = { plan: "free", planActive: true, usage: { sessionsThisWeek: 99, managedAvatarMinutesThisPeriod: 9999, drillsToday: 99 } };

describe("plan limits", () => {
  beforeEach(() => { delete process.env.ORIEL_ENFORCE_LIMITS; });
  afterEach(() => { process.env.ORIEL_ENFORCE_LIMITS = "1"; });
  it("are off by default: a free account gets everything", () => {
    expect(canStartSession(free).allowed).toBe(true);
    expect(canStartDrill(free).allowed).toBe(true);
    expect(canUseLadder(free).allowed).toBe(true);
    expect(canUsePanelMode(free, 4).allowed).toBe(true);
    expect(canUsePlayback(free).level).toBe("full");
    expect(maxPanelSize(free)).toBe(4);
    expect(maxSessionMinutes(free)).toBe(60);
  });
  it("apply when switched on", () => {
    process.env.ORIEL_ENFORCE_LIMITS = "1";
    expect(canStartSession(free).allowed).toBe(false);
    expect(canUseLadder(free).allowed).toBe(false);
  });
});
