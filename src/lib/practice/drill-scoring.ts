import { analyzeAnswer, countFillers, quantifiedStatements, words } from "@/lib/analysis/text";
import { perAnswer, type AudioSample, type VisionSample } from "@/lib/analysis/read";
import { postureEvents, postureKind } from "@/lib/analysis/posture";
import type { DrillDef } from "./catalog";

export interface DrillMeasurement { value: number | null; unit: string; label: string; passed: boolean | null; details: Record<string, unknown> }

export interface DrillInput {
  transcript: string;
  durationMs: number;
  firstWordLatencyMs: number | null;
  cameraEngagement: number | null;
  /** 10 Hz microphone frames and ~4 Hz camera samples from the answer, on one clock. */
  audio?: AudioSample[];
  vision?: VisionSample[];
  answerStartMs?: number;
}

/**
 * Measure a drill attempt against its single target metric. Pure and deterministic.
 * Voice and posture drills reuse the Read's own per-answer analysis, so a drill number
 * means the same thing as the matching number in an interview's Read.
 */
export function measureDrill(drill: DrillDef, input: DrillInput, baseline: number | null): DrillMeasurement {
  const sec = Math.max(1, input.durationMs / 1000);
  const h = analyzeAnswer(input.transcript, sec);
  const spoken = !!input.audio?.length;
  const answer = () => {
    const start = input.answerStartMs ?? 0;
    return perAnswer([{
      id: "drill", questionId: "drill", questionText: drill.prompt, questionKind: "primary", questionDifficulty: 2, questionEndMs: null,
      text: input.transcript, startMs: start, endMs: start + input.durationMs, firstWordLatencyMs: input.firstWordLatencyMs, interrupted: false,
      inputMode: spoken ? "voice" : "text",
    }], input.audio ?? [], [], { cameraMetrics: false, gaze: false, posture: false })[0];
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  switch (drill.targetMetric) {
    case "opener_seconds": {
      const hasRole = /\b(i'?m|i am|i work|i've been|i have been)\b/i.test(input.transcript);
      const passed = sec <= 35 && hasRole && words(input.transcript).length >= 30;
      return { value: Math.round(sec), unit: "sec", label: "Length", passed, details: { words: words(input.transcript).length, star: h.star } };
    }
    case "filler_per_min": {
      const perMin = (countFillers(input.transcript).total / sec) * 60;
      const passed = perMin < 2 || (baseline !== null && perMin <= baseline * 0.7);
      return { value: Math.round(perMin * 10) / 10, unit: "/min", label: "Filler rate", passed, details: { byType: countFillers(input.transcript).byType } };
    }
    case "quantified_claims": {
      const q = quantifiedStatements(input.transcript);
      return { value: q.length, unit: "statements", label: "Quantified statements", passed: q.length >= 3, details: { statements: q } };
    }
    case "recovery_ms": {
      const lat = input.firstWordLatencyMs;
      return { value: lat, unit: "ms", label: "Time to first word", passed: lat !== null && lat <= 2500 && h.starScore >= 0.35, details: { starScore: h.starScore } };
    }
    case "camera_engagement": {
      const v = input.cameraEngagement === null ? null : Math.round(input.cameraEngagement * 100);
      return { value: v, unit: "% (estimated)", label: "Eye contact", passed: v === null ? null : baseline !== null ? v >= baseline + 10 : v >= 60, details: {} };
    }
    case "structure_score": {
      const v = Math.round(h.starScore * 100);
      return { value: v, unit: "%", label: "Structure", passed: h.star.situation && h.star.action && h.star.result, details: { star: h.star } };
    }
    case "pace_wpm": {
      const wpm = spoken ? answer().wpm : null;
      if (wpm === null) return { value: null, unit: "wpm", label: "Pace", passed: null, details: { reason: spoken ? "Too few words to measure pace. Answer for longer." : "Pace is measured from your voice, so speak this one." } };
      const v = Math.round(wpm);
      return { value: v, unit: "wpm", label: "Pace", passed: v >= 125 && v <= 165, details: { direction: v > 165 ? "fast" : v < 125 ? "slow" : "steady" } };
    }
    case "vocal_variety": {
      const st = spoken ? answer().pitchVarietySt : null;
      if (st === null) return { value: null, unit: "semitones", label: "Pitch movement", passed: null, details: { reason: spoken ? "Not enough voiced audio to measure pitch. Answer for longer, a little louder." : "Pitch is measured from your voice, so speak this one." } };
      const v = r1(st);
      return { value: v, unit: "semitones", label: "Pitch movement", passed: v >= 2.5 || (baseline !== null && v >= baseline * 1.2), details: {} };
    }
    case "hedges_per_min": {
      const v = r1(answer().hedgePerMin);
      return { value: v, unit: "/min", label: "Hedges", passed: v < 1 || (baseline !== null && baseline > 0 && v <= baseline * 0.5), details: { byType: h.hedgeTypes } };
    }
    case "answer_seconds": {
      const a = answer();
      const v = Math.round(a.durationSec);
      return { value: v, unit: "sec", label: "Answer length", passed: v <= 75 && h.wordCount >= 40 && h.star.result, details: { words: h.wordCount, result: h.star.result } };
    }
    case "posture_upright": {
      const face = (input.vision ?? []).filter((v) => v.face);
      const measured = face.filter((v) => v.slouch !== null);
      if (face.length < 12 || measured.length < face.length * 0.6) {
        return { value: null, unit: "%", label: "Upright", passed: null, details: { reason: "Posture wasn't measured. Calibrate with your shoulders in view, then answer." } };
      }
      const off = measured.filter((v) => { const k = postureKind(v); return k === "slouch" || k === "fidget"; }).length;
      const upright = Math.round((1 - off / measured.length) * 100);
      const events = postureEvents(input.vision ?? []).filter((e) => e.kind === "slouch" || e.kind === "fidget");
      return { value: upright, unit: "%", label: "Upright", passed: upright >= 85 && !events.some((e) => e.kind === "slouch"), details: { events } };
    }
  }
}
