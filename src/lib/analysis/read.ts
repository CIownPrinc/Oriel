import type { Confidence } from "@/db/schema";
import { analyzeAnswer, countFillers, countHedges, words, type AnswerHeuristics } from "./text";
import { postureEvents } from "./posture";

export { postureEvents, type PostureEvent } from "./posture";

/**
 * The Read: behaviour measurements computed from the aligned session timeline.
 * Pure functions — the pipeline feeds them DB rows, tests feed them fixtures.
 *
 * Rules (from the business plan):
 *  - measure behaviours a person can change; never emotion, attractiveness, age, accent
 *  - report ranges and confidence, not single face scores
 *  - camera-derived metrics can be switched off entirely
 */

export interface AudioSample { t: number; rms: number; voiced: boolean; pitch: number | null }
export interface VisionSample {
  t: number;
  face: boolean;
  engaged: number | null; // 0..1 estimated gaze toward lens
  yaw: number | null; pitch: number | null;
  lean: number | null; // distance ratio vs calibration (>1 = closer to camera)
  slouch: number | null; // 0..1 drop in eye-to-shoulder height ÷ shoulder width vs calibration (see posture.ts)
  sway: number | null; // shoulder-midpoint x (normalised)
  motion: number | null; // frame-to-frame landmark displacement
  brightness: number | null; // 0..255
}
export interface SetupSample { brightness: number | null; faceX: number | null; faceY: number | null; faceSize: number | null; micLevelDb: number | null; noiseFloorDb: number | null }

export interface AnswerInputRow {
  id: string;
  questionId: string;
  questionText: string;
  questionKind: string;
  questionDifficulty: number;
  questionEndMs: number | null;
  text: string;
  startMs: number;
  endMs: number;
  firstWordLatencyMs: number | null;
  interrupted: boolean;
  /** Typed answers carry no delivery signal (pace, pauses, recovery, voice). */
  inputMode?: "voice" | "text";
}

export interface MetricResult {
  key: string;
  label: string;
  value: number | null;
  low: number | null;
  high: number | null;
  unit: string;
  confidence: Confidence;
  targetLow: number | null;
  targetHigh: number | null;
  note: string;
  detail?: Record<string, unknown>;
}

export interface ReadOptions {
  cameraMetrics: boolean;
  gaze: boolean;
  posture: boolean;
  /** Which rubric applies. Story structure (situation, action, result) is judged only on story answers. */
  interviewType?: "behavioral" | "technical" | "case" | "leadership" | "mixed";
}

const INTERVIEW_TYPES = ["behavioral", "technical", "case", "leadership", "mixed"] as const;
/** The stored interview type as a rubric choice; anything unrecognised is treated as mixed. */
export function interviewTypeOf(stored: string): NonNullable<ReadOptions["interviewType"]> {
  return (INTERVIEW_TYPES as readonly string[]).includes(stored) ? (stored as NonNullable<ReadOptions["interviewType"]>) : "mixed";
}

const STORY_PROMPT = /\b(?:tell me about a time|describe a (?:time|situation)|give (?:me )?an example|walk me through a (?:time|situation)|when (?:have you|did you)|a time (?:when|you))\b/i;

/** A question that asks for a story from experience, where situation → action → result is the right shape. */
export function isStoryQuestion(q: { questionText: string; questionKind: string }, interviewType: ReadOptions["interviewType"]): boolean {
  if (q.questionKind === "intro" || q.questionKind === "closing") return false;
  if (STORY_PROMPT.test(q.questionText)) return true;
  const type = interviewType ?? "behavioral"; // the product's default interview type
  return (type === "behavioral" || type === "leadership") && (q.questionKind === "primary" || q.questionKind === "follow_up");
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const std = (xs: number[]) => {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const round = (n: number | null, d = 1) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

export interface PerAnswer {
  answer: AnswerInputRow;
  h: AnswerHeuristics;
  durationSec: number;
  speakingSec: number;
  wpm: number | null;
  fillerPerMin: number;
  hedgePerMin: number;
  pauses: { startMs: number; durationMs: number }[];
  pitchVarietySt: number | null;
  volumeVarietyDb: number | null;
  engagement: number | null;
  hard: boolean;
}

// The voice detector's hysteresis (3 quiet frames to switch off, 2 loud frames to switch
// on, ~85 ms analysis window) flags a silence ~300 ms after it starts and its end ~120 ms
// late. Validation against inserted pauses of known length measured the net effect at
// -171 ms (docs/validation/speech-report.md); these offsets correct for the mechanism.
const PAUSE_START_LAG_MS = 300;
const PAUSE_END_LAG_MS = 120;

/** Silence runs ≥ minMs inside [start, end]. Audio samples are ~10 Hz. */
export function findPauses(audio: AudioSample[], start: number, end: number, minMs = 700) {
  const inWin = audio.filter((a) => a.t >= start && a.t <= end);
  const out: { startMs: number; durationMs: number }[] = [];
  let runStart: number | null = null;
  let seenVoice = false;
  for (const a of inWin) {
    if (a.voiced) {
      if (runStart !== null && seenVoice) {
        const s0 = runStart - PAUSE_START_LAG_MS;
        const dur = a.t - PAUSE_END_LAG_MS - s0;
        if (dur >= minMs) out.push({ startMs: s0, durationMs: dur });
      }
      runStart = null;
      seenVoice = true;
    } else if (runStart === null) runStart = a.t;
  }
  return out;
}

export function perAnswer(answers: AnswerInputRow[], audio: AudioSample[], vision: VisionSample[], opts: ReadOptions): PerAnswer[] {
  return answers.map((a) => {
    const typed = a.inputMode === "text";
    const wcAll = words(a.text).length;
    // Typed answers: estimate speaking time at 150 wpm so per-minute language rates stay comparable.
    const durationSec = typed ? Math.max(1, (wcAll / 150) * 60) : Math.max(1, (a.endMs - a.startMs) / 1000);
    const h = analyzeAnswer(a.text, durationSec);
    const inWin = typed ? [] : audio.filter((s) => s.t >= a.startMs && s.t <= a.endMs);
    const pauses = typed ? [] : findPauses(audio, a.startMs, a.endMs);
    // Speaking time = answer span minus pauses of 0.7 s or more. (Validated against
    // labelled clips: an earlier "voiced frames × 1.25" estimate under-read pace by ~20%.)
    const pauseSec = pauses.reduce((acc, p) => acc + p.durationMs, 0) / 1000;
    const speakingSec = typed ? durationSec : Math.max(1, durationSec - pauseSec);
    const wc = words(a.text).length;
    const pitches = inWin.filter((s) => s.voiced && s.pitch && s.pitch > 60 && s.pitch < 500).map((s) => 12 * Math.log2(s.pitch! / 100));
    const vols = inWin.filter((s) => s.voiced && s.rms > 0).map((s) => 20 * Math.log10(s.rms));
    const vis = vision.filter((v) => v.t >= a.startMs && v.t <= a.endMs && v.face && v.engaged !== null);
    return {
      answer: a, h, durationSec, speakingSec,
      wpm: !typed && wc >= 15 ? (wc / speakingSec) * 60 : null,
      fillerPerMin: (h.fillers / speakingSec) * 60,
      hedgePerMin: (h.hedges / speakingSec) * 60,
      pauses,
      pitchVarietySt: pitches.length >= 20 ? std(pitches) : null,
      volumeVarietyDb: vols.length >= 20 ? std(vols) : null,
      engagement: opts.cameraMetrics && opts.gaze && vis.length >= 5 ? vis.filter((v) => (v.engaged ?? 0) >= 0.5).length / vis.length : null,
      hard: ["follow_up", "pressure", "memory_callback", "curveball", "cross"].includes(a.questionKind) || a.questionDifficulty >= 3,
    };
  });
}

export const FAR_FACE_AREA = 0.03;

/** What a setup sample gets wrong — shared by the Read and the live setup check, so both judge the same way. */
export function setupIssues(setup: SetupSample): { key: "dim" | "bright" | "offcentre" | "low" | "far" | "mic" | "noise"; text: string }[] {
  const out: { key: "dim" | "bright" | "offcentre" | "low" | "far" | "mic" | "noise"; text: string }[] = [];
  if (setup.brightness !== null && setup.brightness < 70) out.push({ key: "dim", text: "Your face was dim. Add light in front of you." });
  if (setup.brightness !== null && setup.brightness > 215) out.push({ key: "bright", text: "Your image was overexposed. Reduce direct light or backlight." });
  if (setup.faceX !== null && Math.abs(setup.faceX - 0.5) > 0.15) out.push({ key: "offcentre", text: "You were off-center in the frame." });
  if (setup.faceY !== null && setup.faceY > 0.6) out.push({ key: "low", text: "The camera sits too high or you sat low. Raise the laptop to eye level." });
  // Face area is the face mesh's bounding box. Normal head-and-shoulders framing measured 0.05–0.18
  // in validation (smaller with head coverings, which the mesh doesn't include), so only a really
  // small face counts as "far" (docs/validation/camera-report.md).
  if (setup.faceSize !== null && setup.faceSize < FAR_FACE_AREA) out.push({ key: "far", text: "You were far from the camera. Move a little closer." });
  if (setup.micLevelDb !== null && setup.micLevelDb < -45) out.push({ key: "mic", text: "Your microphone level was low." });
  if (setup.noiseFloorDb !== null && setup.noiseFloorDb > -40) out.push({ key: "noise", text: "There was noticeable background noise." });
  return out;
}

export function computeRead(answers: AnswerInputRow[], audio: AudioSample[], vision: VisionSample[], setup: SetupSample | null, opts: ReadOptions): { metrics: MetricResult[]; per: PerAnswer[] } {
  const per = perAnswer(answers.filter((a) => words(a.text).length > 0), audio, vision, opts);
  const metrics: MetricResult[] = [];
  const totalSpeakingMin = per.reduce((a, p) => a + p.speakingSec, 0) / 60;
  const allText = per.map((p) => p.answer.text).join(" ");

  // Pace — HIGH confidence (transcript + timing). Spoken answers only.
  const wpms = per.map((p) => p.wpm).filter((x): x is number => x !== null);
  const spokenPer = per.filter((p) => p.answer.inputMode !== "text");
  const spokenMin = spokenPer.reduce((a, p) => a + p.speakingSec, 0) / 60;
  const totalWords = spokenPer.reduce((a, p) => a + words(p.answer.text).length, 0);
  metrics.push({
    key: "pace_wpm", label: "Pace", value: spokenMin > 0 && totalWords >= 15 ? round(totalWords / spokenMin, 0) : null,
    low: round(quantile(wpms, 0.25), 0), high: round(quantile(wpms, 0.75), 0), unit: "wpm", confidence: "high",
    targetLow: 120, targetHigh: 160, note: "Words per minute of speaking time. The range shows your middle half of answers.",
    detail: { perAnswer: per.map((p) => ({ answerId: p.answer.id, wpm: round(p.wpm, 0) })) },
  });

  // Pauses — HIGH (audio energy).
  const allPauses = per.flatMap((p) => p.pauses);
  const longPauses = allPauses.filter((p) => p.durationMs >= 2000);
  metrics.push({
    key: "pauses", label: "Pauses", value: round(mean(allPauses.map((p) => p.durationMs / 1000)), 1),
    low: null, high: round(Math.max(0, ...allPauses.map((p) => p.durationMs / 1000)), 1), unit: "s avg",
    confidence: audio.length && spokenPer.length ? "high" : "low", targetLow: 0.5, targetHigh: 1.5,
    note: audio.length && spokenPer.length ? `${allPauses.length} pauses over 0.7s, ${longPauses.length} over 2s. The high end is your longest.` : "Not measured: answers were typed, so there was no audio to analyze.",
    detail: { count: allPauses.length, long: longPauses.length },
  });

  // Fillers & hedges — HIGH (transcript patterns).
  const f = countFillers(allText);
  const hd = countHedges(allText);
  const fillerRates = per.map((p) => p.fillerPerMin);
  metrics.push({
    key: "filler_per_min", label: "Filler words", value: totalSpeakingMin > 0 ? round(f.total / totalSpeakingMin, 1) : null,
    low: round(quantile(fillerRates, 0.25), 1), high: round(quantile(fillerRates, 0.75), 1), unit: "/min", confidence: "high",
    targetLow: 0, targetHigh: 3, note: `${f.total} total: ${Object.entries(f.byType).map(([k, v]) => `"${k}" ×${v}`).join(", ") || "none"}. Short sounds like "uh" can be missed by transcription for some accents, so treat this as a minimum; your progress is compared with your own earlier sessions.`,
    detail: { byType: f.byType, worst: [...per].sort((a, b) => b.fillerPerMin - a.fillerPerMin).slice(0, 3).map((p) => ({ answerId: p.answer.id, perMin: round(p.fillerPerMin, 1) })) },
  });
  metrics.push({
    key: "hedges_per_min", label: "Hedging", value: totalSpeakingMin > 0 ? round(hd.total / totalSpeakingMin, 1) : null,
    // Medium: a softener is a pattern; whether it weakened the answer is a judgment.
    low: null, high: null, unit: "/min", confidence: "medium", targetLow: 0, targetHigh: 2,
    note: `${hd.total} hedges: ${Object.entries(hd.byType).map(([k, v]) => `"${k}" ×${v}`).join(", ") || "none"}.`, detail: { byType: hd.byType },
  });

  // Structure & specificity — MEDIUM (pattern + model assisted).
  const substantive = per.filter((p) => p.h.wordCount >= 30 && p.answer.questionKind !== "closing");
  // Story structure is the right yardstick only for story questions; a technical explanation or a
  // case walk-through isn't marked down for having no "result" sentence.
  const stories = substantive.filter((p) => isStoryQuestion(p.answer, opts.interviewType));
  const missing = { situation: 0, action: 0, result: 0, outcome: 0 };
  for (const p of stories) for (const k of Object.keys(missing) as (keyof typeof missing)[]) if (!p.h.star[k]) missing[k]++;
  metrics.push({
    key: "structure_score", label: "Story structure", value: stories.length ? round(mean(stories.map((p) => p.h.starScore))! * 100, 0) : null,
    low: null, high: null, unit: "%", confidence: "medium", targetLow: 70, targetHigh: 100,
    note: stories.length
      ? `Across ${stories.length} story answers: situation missing ${missing.situation}×, personal action missing ${missing.action}×, result missing ${missing.result}×, outcome missing ${missing.outcome}×. Checked by phrasing, so a clear story in unusual words can be missed.`
      : substantive.length ? "Not measured: no question asked for a story from your experience, so story structure doesn't apply." : "Not enough substantive answers to judge structure.",
    detail: { missing, stories: stories.length },
  });
  const quantifiedAnswers = substantive.filter((p) => p.h.quantified.length > 0).length;
  metrics.push({
    key: "specificity", label: "Specificity", value: substantive.length ? round((1 - mean(substantive.map((p) => p.h.vagueness))!) * 100, 0) : null,
    low: null, high: null, unit: "%", confidence: "medium", targetLow: 60, targetHigh: 100,
    note: substantive.length ? `${quantifiedAnswers} of ${substantive.length} answers stated a number, scope or timeframe.` : "Not enough substantive answers.",
    detail: { quantifiedAnswers, answers: substantive.length },
  });

  // Recovery — MEDIUM (depends on endpointing accuracy).
  const spoken = per.filter((p) => p.answer.inputMode !== "text");
  const latAll = spoken.map((p) => p.answer.firstWordLatencyMs).filter((x): x is number => x !== null && x >= 0);
  const latHard = spoken.filter((p) => p.hard).map((p) => p.answer.firstWordLatencyMs).filter((x): x is number => x !== null && x >= 0);
  metrics.push({
    key: "recovery_ms", label: "Recovery", value: round(median(latHard.length ? latHard : latAll), 0),
    low: round(quantile(latHard.length ? latHard : latAll, 0.25), 0), high: round(quantile(latHard.length ? latHard : latAll, 0.75), 0),
    unit: "ms", confidence: latAll.length ? "medium" : "low", targetLow: 500, targetHigh: 2500,
    note: !latAll.length ? "Not measured: recovery needs spoken answers." : latHard.length ? `Median time to your first word after ${latHard.length} harder questions (follow-ups, challenges, curveballs).` : "Median time to your first word after each question.",
    detail: { hardCount: latHard.length, overallMedian: median(latAll) },
  });

  // Vocal variety — MEDIUM (pitch tracking from a laptop mic is noisy).
  const pv = per.map((p) => p.pitchVarietySt).filter((x): x is number => x !== null);
  const flat = per.filter((p) => p.pitchVarietySt !== null && p.pitchVarietySt < 1.5 && p.durationSec > 15);
  metrics.push({
    key: "vocal_variety", label: "Vocal variety", value: round(median(pv), 1), low: round(quantile(pv, 0.25), 1), high: round(quantile(pv, 0.75), 1),
    unit: "semitones", confidence: pv.length ? "medium" : "low", targetLow: 2, targetHigh: 6,
    note: pv.length ? `Pitch movement while speaking. ${flat.length ? `${flat.length} answer${flat.length > 1 ? "s were" : " was"} notably flat.` : "No notably flat answers."}` : "Not enough voiced audio to estimate pitch.",
    detail: { flatAnswers: flat.map((p) => p.answer.id), volumeVarietyDb: round(median(per.map((p) => p.volumeVarietyDb).filter((x): x is number => x !== null)), 1) },
  });

  // Camera engagement — MEDIUM, estimated, opt-out.
  if (opts.cameraMetrics && opts.gaze) {
    const inAnswers = vision.filter((v) => v.face && v.engaged !== null && per.some((p) => v.t >= p.answer.startMs && v.t <= p.answer.endMs));
    const est = inAnswers.length >= 10 ? inAnswers.filter((v) => (v.engaged ?? 0) >= 0.5).length / inAnswers.length : null;
    metrics.push({
      key: "camera_engagement", label: "Eye contact", value: est === null ? null : round(est * 100, 0),
      low: est === null ? null : round(Math.max(0, est * 100 - 12), 0), high: est === null ? null : round(Math.min(100, est * 100 + 12), 0),
      unit: "% (estimated)", confidence: est === null ? "low" : "medium", targetLow: 55, targetHigh: 90,
      note: "Estimated from head pose and eye position while you spoke. Webcams misread gaze, especially with glasses or off-center cameras, so treat this as approximate. Looking away to think is normal.",
      detail: { samples: inAnswers.length },
    });
  }

  // Posture & movement — MEDIUM, timeline not grade.
  if (opts.cameraMetrics && opts.posture) {
    const faceFrames = vision.filter((v) => v.face);
    const pv2 = faceFrames.filter((v) => v.sway !== null);
    const swayStd = std(pv2.map((v) => v.sway!));
    const motion = pv2.map((v) => v.motion ?? 0);
    const events = postureEvents(vision);
    const n = (k: string) => events.filter((e) => e.kind === k).length;
    // Never report "0 slouches" for something that wasn't measured: slouch needs shoulders in
    // view at calibration, lean needs calibration at all.
    const slouchMeasured = faceFrames.filter((v) => v.slouch !== null).length >= 20;
    const leanMeasured = faceFrames.filter((v) => v.lean !== null).length >= 20;
    const shoulderShare = faceFrames.length ? pv2.length / faceFrames.length : 0;
    const counts = [
      slouchMeasured && `${n("slouch")} slouch shift${n("slouch") === 1 ? "" : "s"}`,
      leanMeasured && `${n("lean_in")} lean-in${n("lean_in") === 1 ? "" : "s"}, ${n("lean_back")} sit-back${n("lean_back") === 1 ? "" : "s"}`,
      `${n("fidget")} restless stretch${n("fidget") === 1 ? "" : "es"}`,
    ].filter(Boolean).join(", ");
    const gaps = [
      !leanMeasured ? "Slouch and lean weren't measured: they need the 2-second calibration at the start."
        : !slouchMeasured ? "Slouch wasn't measured: your shoulders weren't in view during calibration." : "",
      shoulderShare < 0.8 ? `Your shoulders were in view ${Math.round(shoulderShare * 100)}% of the time, and posture is only measured then.` : "",
    ].filter(Boolean).join(" ");
    metrics.push({
      key: "movement", label: "Posture & movement", value: swayStd === null ? null : round(swayStd * 100, 1), low: null, high: null,
      unit: "sway", confidence: pv2.length >= 20 ? "medium" : "low", targetLow: 0, targetHigh: 4,
      note: pv2.length >= 20
        ? `${counts[0].toUpperCase()}${counts.slice(1)}.${gaps ? ` ${gaps}` : ""} See the timeline; shifts are not good or bad on their own.`
        : "Not enough frames with your shoulders in view to estimate posture.",
      detail: { events, meanMotion: round(mean(motion), 3), slouchMeasured, leanMeasured, shoulderShare: round(shoulderShare, 2) },
    });
  }

  // Setup — HIGH for what we can measure directly.
  if (setup) {
    const issues = setupIssues(setup).map((i) => i.text);
    metrics.push({
      key: "setup", label: "Setup", value: issues.length, low: null, high: null, unit: "issues", confidence: "high",
      targetLow: 0, targetHigh: 0, note: issues.length ? issues.join(" ") : "Lighting, framing and audio looked good.", detail: { ...setup, issues },
    });
  }

  // A measure with no value is never presented with confidence.
  for (const m of metrics) if (m.value === null) m.confidence = "low";
  const cam = metrics.find((m) => m.key === "camera_engagement");
  if (cam && cam.value === null) {
    const faceFrames = vision.filter((v) => v.face).length;
    cam.note = !vision.length ? "Not measured: no camera frames were available for this session."
      : faceFrames >= 10 && vision.every((v) => v.engaged === null) ? "Not measured: eye contact needs the 2-second lens calibration at the start, so it is judged against your own setup rather than a generic baseline."
      : "Not enough frames with your face visible to estimate eye contact.";
  }
  const mov = metrics.find((m) => m.key === "movement");
  if (mov && mov.value === null && !vision.length) mov.note = "Not measured: no camera frames were available for this session.";
  return { metrics, per };
}

// ─── Playback moment selection ────────────────────────────────────────────

export interface Moment {
  answerId: string;
  questionId: string;
  signal: "recovery" | "fillers" | "hedges" | "vague" | "structure" | "length" | "pace" | "camera" | "interrupted";
  severity: number;
  startMs: number;
  endMs: number;
  evidence: string;
  confidence: Confidence;
}

export function candidateMoments(per: PerAnswer[], opts: ReadOptions): Moment[] {
  const out: Moment[] = [];
  for (const p of per) {
    const a = p.answer;
    const qEnd = a.questionEndMs ?? a.startMs - 1000;
    const clipStart = Math.max(0, Math.min(qEnd - 2500, a.startMs - 3000));
    const clipEnd = Math.min(a.endMs, Math.max(a.startMs + 45000, clipStart + 20000));
    const base = { answerId: a.id, questionId: a.questionId, startMs: clipStart, endMs: clipEnd };
    const lat = a.inputMode === "text" ? null : a.firstWordLatencyMs;
    if (lat !== null && lat > 3000) {
      const hedgesOpen = countHedges(a.text.split(/[.!?]/)[0] ?? "").total;
      out.push({ ...base, signal: "recovery", severity: Math.min(1, lat / 8000) + (p.hard ? 0.25 : 0), confidence: "medium",
        evidence: `You paused ${(lat / 1000).toFixed(1)} seconds before your first word${hedgesOpen ? `, then opened with ${hedgesOpen} qualifier${hedgesOpen > 1 ? "s" : ""}` : ""}.` });
    }
    if (p.fillerPerMin > 5 && p.h.fillers >= 3) {
      out.push({ ...base, signal: "fillers", severity: Math.min(1, p.fillerPerMin / 14), confidence: "high",
        evidence: `${p.h.fillers} filler words in ${Math.round(p.durationSec)} seconds (${p.fillerPerMin.toFixed(1)} per minute): ${Object.entries(p.h.fillerTypes).map(([k, v]) => `"${k}" ×${v}`).join(", ")}.` });
    }
    if (p.h.hedges >= 3) {
      out.push({ ...base, signal: "hedges", severity: Math.min(1, p.h.hedges / 7), confidence: "high",
        evidence: `${p.h.hedges} hedges in this answer: ${Object.entries(p.h.hedgeTypes).map(([k, v]) => `"${k}" ×${v}`).join(", ")}.` });
    }
    if (p.h.wordCount >= 30 && p.h.vagueness >= 0.6) {
      out.push({ ...base, signal: "vague", severity: p.h.vagueness * 0.9, confidence: "medium",
        evidence: `No concrete number, name or timeframe${p.h.quantified.length ? "" : " anywhere in the answer"}; ${p.h.star.action ? "" : "no first-person action stated; "}language stayed general.` });
    }
    if (p.h.wordCount >= 50 && !p.h.star.result && isStoryQuestion(a, opts.interviewType)) {
      out.push({ ...base, signal: "structure", severity: 0.55, confidence: "medium", evidence: `${Math.round(p.durationSec)}-second answer with no stated result or outcome.` });
    }
    if (a.inputMode !== "text" && p.durationSec > 150) {
      out.push({ ...base, signal: "length", severity: Math.min(1, p.durationSec / 300), confidence: "high", evidence: `This answer ran ${Math.floor(p.durationSec / 60)}:${String(Math.round(p.durationSec % 60)).padStart(2, "0")}. Most strong answers land in 60–120 seconds.` });
    }
    if (a.interrupted) {
      out.push({ ...base, signal: "interrupted", severity: 0.7, confidence: "high", evidence: `The interviewer cut in after ${Math.round(p.durationSec)} seconds, before you reached a result.` });
    }
    if (p.wpm !== null && (p.wpm > 185 || p.wpm < 95)) {
      out.push({ ...base, signal: "pace", severity: Math.min(1, Math.abs(p.wpm - 140) / 80), confidence: "high", evidence: `Pace was about ${Math.round(p.wpm)} words per minute (comfortable range 120–160).` });
    }
    if (opts.cameraMetrics && opts.gaze && p.engagement !== null && p.engagement < 0.4 && p.durationSec > 15) {
      out.push({ ...base, signal: "camera", severity: (0.4 - p.engagement) * 1.5, confidence: "medium", evidence: `Estimated eye contact was about ${Math.round(p.engagement * 100)}% during this answer (webcam estimate).` });
    }
  }
  return out;
}

/** Pick 3–5 of the most valuable moments, preferring different answers and different signals. */
export function selectMoments(moments: Moment[], max = 5): Moment[] {
  const sorted = [...moments].sort((a, b) => b.severity - a.severity);
  const chosen: Moment[] = [];
  const usedAnswers = new Set<string>();
  const signalCount: Record<string, number> = {};
  for (const m of sorted) {
    if (chosen.length >= max) break;
    if (usedAnswers.has(m.answerId)) continue;
    if ((signalCount[m.signal] ?? 0) >= 2) continue;
    chosen.push(m);
    usedAnswers.add(m.answerId);
    signalCount[m.signal] = (signalCount[m.signal] ?? 0) + 1;
  }
  // Fill up to 3 from answers not yet used (relaxing the per-signal cap).
  for (const m of sorted) {
    if (chosen.length >= Math.min(3, max)) break;
    if (!usedAnswers.has(m.answerId)) { chosen.push(m); usedAnswers.add(m.answerId); }
  }
  // One clip per answer: fold the strongest secondary signal into the evidence.
  return chosen.map((c) => {
    const extra = sorted.find((m) => m.answerId === c.answerId && m !== c);
    return extra ? { ...c, evidence: `${c.evidence} Also: ${extra.evidence.charAt(0).toLowerCase()}${extra.evidence.slice(1)}` } : c;
  }).sort((a, b) => a.startMs - b.startMs);
}
