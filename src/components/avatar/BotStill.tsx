"use client";

import { useEffect, useRef } from "react";
import type { AvatarStyle } from "@/lib/avatar/style";
import { cn } from "@/components/ui/cn";
import { drawBot, type BotPose } from "./bot/draw";
import { lookFor } from "./bot/looks";
import { BASE_POSE } from "./bot/presets";
import { PALETTE } from "@/lib/palette";

/** One still frame of a bot (pickers, cards): no animation loop, redrawn only when its look changes. */
export function BotStill({ personaId, style, pose, accent = PALETTE.accent, className }: {
  personaId: string;
  style?: Partial<AvatarStyle> | null;
  pose?: Partial<BotPose>;
  accent?: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify([personaId, style ?? null, pose ?? null, accent]);
  useEffect(() => {
    const wrap = box.current, el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!wrap || !el || !ctx) return;
    const [pid, st, ps, ac] = JSON.parse(key) as [string, Partial<AvatarStyle> | null, Partial<BotPose> | null, string];
    const paint = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.max(1, Math.round(r.width * dpr));
      el.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (r.width > 0 && r.height > 0) drawBot(ctx, r.width, r.height, lookFor(pid, st), { ...BASE_POSE, ...(ps ?? {}) }, ac);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [key]);
  return (
    <div ref={box} className={cn("relative", className)} aria-hidden>
      <canvas ref={canvas} className="absolute inset-0 block h-full w-full" />
    </div>
  );
}
