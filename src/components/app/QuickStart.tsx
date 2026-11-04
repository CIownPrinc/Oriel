"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Field";
import { api, ApiError } from "@/lib/client/api";

export type QuickStartSetup = {
  role: string; domain: string;
  level: "recruiter" | "hiring_manager" | "senior_manager" | "executive";
  type: "behavioral" | "technical" | "case" | "leadership" | "mixed";
  persona: "warm_recruiter" | "hiring_manager" | "skeptic" | "executive";
  pressure: number; targetMinutes: number; cameraMetrics: boolean;
};

/**
 * One tap from Home to the Room, with the choices you already made in onboarding. Setup is still
 * there for anyone who wants to change something; it's no longer in the way of the first interview.
 */
export function QuickStart({ setup, label = "Start interview", blocked }: { setup: QuickStartSetup; label?: string; blocked?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ sessionId: string }>("/api/interviews", {
        method: "POST",
        json: { ...setup, mode: "single", panelSize: 3, ladderLevel: null },
      });
      router.push(`/room/${r.sessionId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't set up the interview. Try again.");
      setBusy(false);
    }
  }
  // When the plan has no session left, the way forward is the plan, not a grey button.
  if (blocked) {
    return (
      <div>
        <ButtonLink href="/profile#plan" size="lg">See plans</ButtonLink>
        <p className="mt-3 max-w-prose text-ui text-fg-muted">{blocked}</p>
      </div>
    );
  }
  return (
    <div>
      <Button size="lg" onClick={start} loading={busy}>{label}</Button>
      <FieldError>{error}</FieldError>
    </div>
  );
}
