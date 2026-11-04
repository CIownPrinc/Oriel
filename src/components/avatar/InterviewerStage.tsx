"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BotAvatar } from "./BotAvatar";
import { AvatarStore } from "@/lib/avatar/store";
import type { AvatarStyle } from "@/lib/avatar/style";
import { PERSONAS, type PersonaId } from "@/lib/interview/personas";
import { cn } from "@/components/ui/cn";
import { PALETTE } from "@/lib/palette";

/**
 * The interviewer presented on a page, outside the Room: the same engine and the same face the
 * person will meet, standing on the page with its own floor shadow (never boxed). Idle: it
 * breathes, blinks and glances around. It only animates while on screen in a visible tab, and
 * holds still under reduced motion. A panel shows every seat, the lead in front.
 */
export function InterviewerStage({ personaIds, styles, still, className, store: driven }: {
  personaIds: string[];
  styles?: Partial<Record<string, Partial<AvatarStyle> | null>>;
  /** A still of the same frame, drawn by the same engine, shown until the canvas paints (and without scripts). */
  still?: string;
  className?: string;
  /** Drive the face from outside (speaking, listening); otherwise it idles on its own. */
  store?: AvatarStore;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const own = useMemo(() => {
    const s = new AvatarStore();
    s.stillness = 0.4;
    s.pressure = 2;
    return s;
  }, []);
  const store = driven ?? own;
  const key = personaIds.join(",");
  const seats = useMemo(() => key.split(",").map((id, seat) => {
    const p = PERSONAS[id as PersonaId] ?? PERSONAS.hiring_manager;
    return { seat, personaId: p.id, name: p.name, accent: PALETTE.accent, expressiveness: p.expressiveness, warmth: p.warmth, skepticism: p.skepticism, style: styles?.[id] ?? null };
  }), [key, styles]);

  useEffect(() => {
    if (!driven) store.setMode("idle", 0);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let onScreen = false;
    const sync = () => setLive(onScreen && !mq.matches && document.visibilityState === "visible");
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { threshold: 0.1 });
    if (box.current) io.observe(box.current);
    mq.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { io.disconnect(); mq.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, [store, driven]);

  return (
    <div ref={box} className={cn("relative", className)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size still under the canvas, not content */}
      {still && <img src={still} alt="" width={352} height={352} loading="lazy" decoding="async" className="absolute inset-0 size-full" />}
      <BotAvatar store={store} seats={seats} paused={!live} compact className="absolute inset-0" />
    </div>
  );
}
