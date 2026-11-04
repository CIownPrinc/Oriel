"use client";
/* eslint-disable react-hooks/immutability -- AvatarStore is an external mutable object read by the avatar's render loop, not React state. */

import { useEffect, useMemo, useRef, useState } from "react";
import { BotAvatar } from "@/components/avatar/BotAvatar";
import { AvatarStore } from "@/lib/avatar/store";
import { PERSONAS } from "@/lib/interview/personas";
import { cn } from "@/components/ui/cn";

/*
 * The hero's proof: Daniel, the Classic face every new account meets, drawn and animated by the
 * same engine as the Room (its blinks, its listening nods, the light that breathes with its voice).
 * Beneath him, only his questions, as subtitles: the opening question, then two follow-ups that
 * build on what you'd have said, with a pause between each while he listens. Illustrative, and
 * labelled as a sample. Rendered complete on the server (with a still of the same face until the
 * canvas takes over); with scripts and motion allowed it loops slowly, and pauses on hover, focus,
 * off-screen, in hidden tabs and with its own button.
 */
const QUESTIONS = [
  "Tell me about a time you made a decision without all the data you wanted.",
  "You said you set a decision date. Who had to agree to it?",
  "And what did the holdout actually show?",
];
const ASK_MS = 4200;
const LISTEN_MS = 4400;

interface Scene { i: number; phase: "ask" | "listen" }

export function InterviewPreview() {
  const [scene, setScene] = useState<Scene>({ i: 0, phase: "ask" });
  const [motionOk, setMotionOk] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [held, setHeld] = useState({ hover: false, focus: false });
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLElement>(null);
  const running = motionOk && !userPaused && !held.hover && !held.focus && inView && visible;

  // Environment: reduced motion, visibility on screen, tab visibility. Read after hydration only.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotionOk(!mq.matches);
    const first = requestAnimationFrame(sync);
    mq.addEventListener("change", sync);
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    if (root.current) io.observe(root.current);
    const vis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(first); mq.removeEventListener("change", sync); io.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // The loop: one timeout at a time, so pausing simply freezes the scene where it is.
  useEffect(() => {
    if (!running) return;
    const next: Scene = scene.phase === "ask" ? { i: scene.i, phase: "listen" } : { i: (scene.i + 1) % QUESTIONS.length, phase: "ask" };
    const id = setTimeout(() => setScene(next), scene.phase === "ask" ? ASK_MS : LISTEN_MS);
    return () => clearTimeout(id);
  }, [running, scene]);

  // The interviewer: the avatar engine reads this store every frame. Speaking drives the voice light
  // with a synthetic level; listening nods now and then while you talk, as it does in the Room.
  const store = useMemo(() => {
    const s = new AvatarStore();
    s.pressure = 2;
    s.stillness = 0.35;
    return s;
  }, []);
  useEffect(() => {
    const t0 = performance.now();
    const wave = (t: number) => Math.max(0, Math.sin(t / 95) * 0.45 + Math.sin(t / 41) * 0.25);
    store.setLevel(() => (store.mode === "speaking" ? wave(performance.now() - t0) : 0));
  }, [store]);
  const seats = useMemo(() => {
    const p = PERSONAS.hiring_manager;
    return [{ seat: 0, personaId: p.id, name: p.name, accent: p.accent, expressiveness: p.expressiveness, warmth: p.warmth, skepticism: p.skepticism }];
  }, []);
  useEffect(() => {
    const listening = scene.phase === "listen";
    store.candidateSpeaking = listening;
    store.setMode(listening ? "listening" : "speaking");
    if (!listening && scene.i > 0) store.fireCue("lean_in");
    if (!listening || !running) return;
    const nod = setTimeout(() => store.fireCue("nod"), 1600);
    return () => clearTimeout(nod);
  }, [scene, store, running]);

  const listening = scene.phase === "listen";

  return (
    <section ref={root} aria-labelledby="sample-title" className="mx-auto flex w-full max-w-[40rem] flex-col items-center text-center"
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setHeld((h) => ({ ...h, hover: true })); }}
      onPointerLeave={() => setHeld((h) => ({ ...h, hover: false }))}
      onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld((h) => ({ ...h, focus: false })); }}>
      <h2 id="sample-title" className="sr-only">Sample interview</h2>
      <p className="sr-only">
        A sample interview with Daniel, an AI hiring manager. He asks: “{QUESTIONS[0]}” After your answer he follows up: “{QUESTIONS[1]}” Then: “{QUESTIONS[2]}”
      </p>

      {/* The face fills ~0.74 of its square, its floor shadow below; a still of the same frame waits under the canvas.
          On a phone the still is the largest thing on the first screen, so it is fetched first. */}
      <div className="relative -mt-4 aspect-square w-[min(100%,15rem)] sm:w-[18rem] lg:w-[19rem]" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size still under the canvas, not content */}
        <img src="/interviewer/daniel-still.webp" alt="" width={672} height={672} fetchPriority="high" className="absolute inset-0 size-full" />
        <BotAvatar store={store} seats={seats} paused={!running} compact className="absolute inset-0" />
      </div>

      {/* While he listens, your voice moves in a small level under his face; while he asks, it rests. */}
      <span className="-mt-3 flex h-3 items-end gap-[3px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((b) => (
          <span key={b} className={cn("h-full w-[3px] origin-bottom rounded-full bg-accent transition-opacity duration-[var(--dur-state)]", listening ? "opacity-100 motion-safe:animate-[meter_900ms_ease-in-out_infinite]" : "opacity-0")}
            style={{ animationDelay: `${b * 130}ms`, transform: "scaleY(0.35)" }} />
        ))}
      </span>

      {/* His question, as a subtitle; it settles back while you answer. All three share one cell, so the line keeps the tallest one's height. */}
      <div className="mt-4 grid w-full text-display-m" aria-hidden>
        {QUESTIONS.map((q) => <p key={q} className="invisible col-start-1 row-start-1 text-balance">“{q}”</p>)}
        <p key={scene.i} className={cn("col-start-1 row-start-1 text-balance transition-colors duration-[var(--dur-panel)]", listening ? "text-fg-muted" : "text-fg", running && !listening && "animate-[fade-in_var(--dur-panel)_var(--ease-enter)]")}>“{QUESTIONS[scene.i]}”</p>
      </div>

      {/* The nameplate; the play control hangs after it without moving it. */}
      <div className="mt-3 grid grid-cols-[2.75rem_auto_2.75rem] items-center">
        <p className="col-start-2 text-ui text-fg-subtle" aria-hidden>Sample interview with Daniel, a hiring&nbsp;manager</p>
        {/* Always laid out, so its arrival after hydration moves nothing; hidden (and unfocusable) without motion. */}
        <button type="button" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? "Play the sample interview" : "Pause the sample interview"}
          className={cn("grid size-11 place-items-center rounded-full text-fg-muted transition-colors duration-[var(--dur-press)] hover:text-fg", !motionOk && "invisible")}>
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            {userPaused ? <path d="M3.5 1.8v8.4l6.5-4.2z" fill="currentColor" /> : <path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" />}
          </svg>
        </button>
      </div>
    </section>
  );
}
