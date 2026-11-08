"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";

const STEPS: [string, string][] = [
  ["store_session", "Saving your session"], ["transcript_alignment", "Aligning the transcript"], ["audio_analysis", "Listening back to your audio"],
  ["pose_gaze_analysis", "Checking posture and eye contact"], ["answer_segmentation", "Separating your answers"], ["competency_analysis", "Measuring structure and specificity"],
  ["weak_moment_detection", "Finding key moments"], ["playback_selection", "Choosing clips to replay"], ["coaching_generation", "Writing your coaching"], ["progress_update", "Comparing with your baseline"], ["lesson_planning", "Writing your lessons"],
];

export function Processing({ sessionId, initialStatus }: { sessionId: string; initialStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (status === "complete") { router.refresh(); return; }
    if (status === "failed") return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/sessions/${sessionId}/analysis`).then((x) => x.json()).catch(() => null);
      if (!r) return;
      setStatus(r.status);
      setStep(r.step);
      setError(r.error);
      setStuck(!!r.stuck);
    }, 1200);
    return () => clearInterval(id);
  }, [status, sessionId, router]);
  async function retry() {
    setStatus("queued");
    setError(null);
    setStuck(false);
    await fetch(`/api/sessions/${sessionId}/analysis`, { method: "POST" });
  }
  const idx = Math.max(0, STEPS.findIndex(([k]) => k === step));
  return (
    <div className="mx-auto max-w-xl py-24 text-center">
      {status === "failed" ? (
        <>
          <h1 className="text-display-l text-fg">Your feedback didn&apos;t finish<span className="text-accent">.</span></h1>
          <p className="mt-4 text-fg-muted">Your interview is saved. Nothing was lost. {error ? <span className="block mt-2 text-meta text-fg-subtle">{error}</span> : null}</p>
          <Button className="mt-8" onClick={retry}>Retry analysis</Button>
        </>
      ) : (
        <>
          <h1 className="text-display-l text-fg">Putting your feedback together<span className="text-accent">.</span></h1>
          <ProgressBar className="mt-10" value={status === "complete" ? STEPS.length : idx + (status === "running" ? 0.5 : 0)} max={STEPS.length} label="Analysis progress" />
          <p className="mt-4 text-ui text-fg-muted" aria-live="polite">{status === "queued" ? "Queued…" : STEPS[idx]?.[1] ?? "Working…"}</p>
          {stuck && (
            <div className="mt-8">
              <p className="text-ui text-fg-muted">This is taking longer than it should. Your interview is saved.</p>
              <Button className="mt-4" variant="secondary" onClick={retry}>Start the analysis again</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
