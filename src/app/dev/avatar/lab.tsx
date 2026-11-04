"use client";
/* eslint-disable react-hooks/immutability, react-hooks/purity -- Development tuning page driving the mutable AvatarStore directly. */
import { useMemo, useState } from "react";
// (static expression sheet below renders without requestAnimationFrame, so it works in hidden tabs)
import { useEffect, useRef } from "react";
import { BotAvatar } from "@/components/avatar/BotAvatar";
import { drawBot } from "@/components/avatar/bot/draw";
import { lookFor } from "@/components/avatar/bot/looks";
import { BASE_POSE, EXPRESSIONS } from "@/components/avatar/bot/presets";
import { AvatarStore } from "@/lib/avatar/store";
import { PERSONAS, type PersonaId } from "@/lib/interview/personas";
import { BOT_ACCESSORIES, BOT_SHAPES, type BotColorId } from "@/lib/avatar/style";
import type { AvatarState } from "@/lib/avatar/types";
import { PALETTE } from "@/lib/palette";

/** Development page for tuning the interviewer's states and personas. */
export function AvatarLab() {
  const [persona, setPersona] = useState<PersonaId>("hiring_manager");
  const [panel, setPanel] = useState(false);
  const [family, setFamily] = useState(false);
  const store = useMemo(() => new AvatarStore(), []);
  const seats = useMemo(() => {
    const all: PersonaId[] = ["warm_recruiter", "hiring_manager", "direct_manager", "skeptic", "executive", "peer"];
    const ids: PersonaId[] = family ? all : panel ? ["hiring_manager", "skeptic", "peer"] : [persona];
    return ids.map((id, seat) => ({ seat, personaId: id, name: PERSONAS[id].name, accent: PALETTE.accent, expressiveness: PERSONAS[id].expressiveness, warmth: PERSONAS[id].warmth, skepticism: PERSONAS[id].skepticism }));
  }, [panel, persona, family]);
  const set = (m: AvatarState) => {
    store.setMode(m);
    if (m === "speaking") { const t0 = performance.now(); store.level = () => Math.max(0, Math.sin((performance.now() - t0) / 90) * 0.5 + Math.sin((performance.now() - t0) / 37) * 0.3); }
    else store.level = () => 0;
    store.candidateSpeaking = m === "listening";
  };
  return (
    <main className="min-h-dvh bg-page glow-gold">
      <BotAvatar key={seats.map((s) => s.personaId).join()} store={store} seats={seats} className="h-[72dvh] w-full"
        labels={(s, active) => <span className={`font-mono text-meta uppercase tracking-widest ${active ? "text-accent" : "text-fg-subtle"}`}>{s.name.split(" ")[0]}</span>} />
      <div className="flex flex-wrap gap-2 p-4 text-ui">
        {(["idle", "listening", "thinking", "speaking", "interrupting"] as AvatarState[]).map((m) => <button key={m} onClick={() => set(m)} className="rounded-full border border-fg/15 px-3 py-1">{m}</button>)}
        {(["nod", "brow_raise", "lean_in", "gaze_shift"] as const).map((c) => <button key={c} onClick={() => store.fireCue(c)} className="rounded-full border border-accent/40 px-3 py-1 text-accent">{c}</button>)}
        <select value={persona} onChange={(e) => setPersona(e.target.value as PersonaId)} className="bg-raised rounded-control px-2">{Object.keys(PERSONAS).map((p) => <option key={p}>{p}</option>)}</select>
        <button onClick={() => setPanel(!panel)} className="rounded-full border border-fg/15 px-3 py-1">panel: {String(panel)}</button>
        {panel && [0, 1, 2].map((i) => <button key={i} onClick={() => { store.activeSeat = i; }} className="rounded-full border border-fg/15 px-3 py-1">speaker {i}</button>)}
        <button onClick={() => { setFamily(!family); }} className="rounded-full border border-fg/15 px-3 py-1">family: {String(family)}</button>
        <input type="range" min={0} max={1} step={0.05} defaultValue={0.3} onChange={(e) => { store.stillness = Number(e.target.value); }} /> stillness
      </div>
      <ExpressionSheet />
      <ShapeSheet />
    </main>
  );
}

const SHEET_PERSONAS = ["warm_recruiter", "hiring_manager", "direct_manager", "skeptic", "executive", "peer"];

/** Every persona × every expression, drawn once (no animation loop). */
function ExpressionSheet() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const cell = 150, pad = 28;
    const W = pad + EXPRESSIONS.length * cell, H = pad + SHEET_PERSONAS.length * cell;
    const dpr = 2;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#9a9aa3";
    ctx.font = "10px ui-monospace, monospace";
    EXPRESSIONS.forEach((e, i) => ctx.fillText(e.name.toUpperCase(), pad + i * cell + 8, 16));
    SHEET_PERSONAS.forEach((pid, r) => {
      EXPRESSIONS.forEach((e, i) => {
        ctx.save();
        ctx.translate(pad + i * cell, pad + r * cell);
        drawBot(ctx, cell, cell, lookFor(pid), { ...BASE_POSE, ...e.pose }, "#A3AB8B");
        ctx.restore();
      });
    });
  }, []);
  return <div className="overflow-x-auto p-4"><canvas ref={ref} /></div>;
}

const SHEET_COLORS: BotColorId[] = ["ivory", "pearl", "cream", "sky", "lilac", "rose", "graphite", "midnight"];
const SHAPE_COLUMNS = [
  ...BOT_ACCESSORIES.map((a) => ({ name: a.label, accessory: a.id, pose: {} })),
  { name: "Happy", accessory: "none" as const, pose: { happy: 0.6, blush: 0.35 } },
  { name: "Skeptical", accessory: "none" as const, pose: { tiltL: 0.8, tiltR: -0.3, lidTopL: 0.3, lidTopR: 0.1 } },
  { name: "Speaking", accessory: "headset" as const, pose: { voice: 0.75, eyeScale: 1.04 } },
  { name: "Thinking", accessory: "glasses" as const, pose: { gazeX: 0.8, gazeY: -0.75, yaw: 0.18, roll: 0.05, lidTopL: 0.18, lidTopR: 0.18 } },
];

/** Every shape × every accessory and a few expressions, in a different colour per row. */
function ShapeSheet() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const cell = 150, pad = 28, label = 70;
    const W = label + SHAPE_COLUMNS.length * cell, H = pad + BOT_SHAPES.length * cell;
    const dpr = 2;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#9a9aa3";
    ctx.font = "10px ui-monospace, monospace";
    SHAPE_COLUMNS.forEach((col, i) => ctx.fillText(col.name.toUpperCase(), label + i * cell + 8, 16));
    BOT_SHAPES.forEach((shape, r) => {
      ctx.fillStyle = "#9a9aa3";
      ctx.fillText(shape.label.toUpperCase(), 8, pad + r * cell + cell / 2);
      SHAPE_COLUMNS.forEach((col, i) => {
        ctx.save();
        ctx.translate(label + i * cell, pad + r * cell);
        drawBot(ctx, cell, cell, lookFor("hiring_manager", { shape: shape.id, color: SHEET_COLORS[r % SHEET_COLORS.length], accessory: col.accessory }), { ...BASE_POSE, ...col.pose }, "#A3AB8B");
        ctx.restore();
      });
    });
  }, []);
  return <div className="overflow-x-auto p-4"><canvas ref={ref} data-testid="shape-sheet" /></div>;
}
