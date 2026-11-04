"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { api } from "@/lib/client/api";
import { setupIssues } from "@/lib/analysis/read";
import { VisionTracker } from "@/features/room/engine/vision";

const CHECKS = [
  { key: "light", label: "Light on your face", fails: ["dim", "bright"] },
  { key: "centre", label: "Centered in the frame", fails: ["offcentre"] },
  { key: "height", label: "Camera at eye level", fails: ["low"] },
  { key: "distance", label: "Close enough", fails: ["far"] },
  { key: "shoulders", label: "Shoulders in view", fails: [] },
] as const;

/**
 * The setup lesson's practice: a live check on your own camera, judged on the device with
 * the same thresholds as the Read. Nothing is recorded or sent — only "passed" is saved.
 */
export function SetupCheck({ passes, needed, inPlan }: { passes: number; needed: number; inPlan: boolean }) {
  const [stage, setStage] = useState<"idle" | "starting" | "checking" | "passed">("idle");
  const [state, setState] = useState<Record<string, boolean | null>>({});
  const [count, setCount] = useState(passes);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const live = useRef<{ stream?: MediaStream; tracker?: VisionTracker; timer?: ReturnType<typeof setInterval> }>({});

  useEffect(() => () => stop(), []);

  function stop() {
    const x = live.current;
    if (x.timer) clearInterval(x.timer);
    x.stream?.getTracks().forEach((t) => t.stop());
    x.tracker?.close();
    live.current = {};
  }

  async function start() {
    setError(null);
    setStage("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      const tracker = new VisionTracker();
      live.current = { stream, tracker };
      if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}); }
      if (!(await tracker.init())) throw new Error("model");
      setStage("checking");
      let good = 0;
      live.current.timer = setInterval(() => {
        const el = video.current;
        const f = el ? tracker.analyze(el) : null;
        if (!f) return;
        const issues = f.face ? setupIssues(tracker.setupSample(null, null)).map((i) => i.key as string) : null;
        const next: Record<string, boolean | null> = {};
        for (const c of CHECKS) next[c.key] = issues === null ? null : c.key === "shoulders" ? f.shoulderWidth !== null : !c.fails.some((k) => issues.includes(k));
        setState(next);
        good = Object.values(next).every((v) => v === true) ? good + 1 : 0;
        if (good >= 10) { // three seconds in a row
          stop();
          setStage("passed");
          if (inPlan) void api<{ lesson: { passes: number } | null }>("/api/lessons/setup-check", { method: "POST", json: { passed: true } }).then((r) => r.lesson && setCount(r.lesson.passes)).catch(() => {});
        }
      }, 300);
    } catch {
      stop();
      setStage("idle");
      setError("We couldn't start your camera. Allow it in your browser's address bar and try again.");
    }
  }

  return (
    <div>
      <p className="mt-3 text-display-m text-fg">Setup check</p>
      <p className="mt-1 text-ui text-fg-subtle">Turn on your camera and adjust until every line turns green for three seconds. Nothing is recorded.</p>
      <div className={cn("mt-4 overflow-hidden rounded-control border border-line bg-surface", stage === "idle" && "hidden")}>
        <video ref={video} muted playsInline className="aspect-video w-full -scale-x-100 object-cover" />
      </div>
      {stage !== "idle" && (
        <ul className="mt-4 space-y-1.5 text-ui" aria-live="polite">
          {CHECKS.map((c) => (
            <li key={c.key} className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", state[c.key] === true ? "bg-success" : state[c.key] === false ? "bg-warning" : "bg-fg/20")} />
              <span className={state[c.key] === false ? "text-fg" : "text-fg-muted"}>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
      {stage === "passed" ? (
        <p className="mt-4 text-ui text-success">Your setup looks good.{inPlan ? ` ${Math.min(count, needed)} of ${needed} checks passed.` : ""}</p>
      ) : (
        <Button variant="lume" className="mt-5 w-full" onClick={start} loading={stage === "starting"} disabled={stage === "checking"}>{stage === "checking" ? "Checking…" : "Start the check"}</Button>
      )}
      {stage === "passed" && <Button variant="secondary" size="sm" className="mt-3" onClick={start}>Check again</Button>}
      <FieldError>{error}</FieldError>
      <p className="mt-3 text-meta text-fg-subtle">Sound is checked in the Room&apos;s setup screen before each interview.</p>
    </div>
  );
}
