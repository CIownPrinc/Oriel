import { countFillers, countHedges, sentences, vaguenessScore } from "@/lib/analysis/text";
import type { MetricResult, PerAnswer } from "@/lib/analysis/read";
import type { PostureEvent } from "@/lib/analysis/posture";
import { LESSONS, LESSON_ORDER } from "./library";
import type { LessonEvidence, LessonKey, LessonQuote, Track } from "./types";

/**
 * Which lessons a person needs, from their own interview. Pure and deterministic: every
 * number is a measurement from the Read and every quote is copied from their answers —
 * nothing here is generated. A lesson is needed when its measure is outside the target
 * the Read already uses; unmeasured skills (typed answers, camera off) are never planned.
 */
export interface PlannerInput {
  sessionId: string;
  metrics: MetricResult[];
  per: PerAnswer[];
}

export interface Assessment {
  key: LessonKey;
  metricKey: string;
  value: number | null;
  /** 0 = on target; larger = further from it (roughly "fractions of the target"). */
  need: number;
  evidence: LessonEvidence;
  /** The answer a rewrite should start from, for lessons that teach by rewriting. */
  focus: { answerId: string; question: string; text: string } | null;
}

export interface PlannedLesson extends Assessment { track: Track; priority: number; status: "active" | "queued" }

export const MAX_ACTIVE = 5;
const MAX_PER_TRACK = 2;
const TRACK_WEIGHT: Record<Track, number> = { responses: 1.15, delivery: 1, presence: 0.85 };

const r1 = (v: number) => Math.round(v * 10) / 10;
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const lengthOf = (sec: number) => (sec >= 90 ? `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s` : `${Math.round(sec)} s`);
const clip = (s: string, n = 260) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

function quoteOf(sessionId: string, p: PerAnswer, text: string, note: string | null): LessonQuote {
  return { sessionId, answerId: p.answer.id, question: p.answer.questionText ? clip(p.answer.questionText, 140) : null, text: clip(text), startMs: p.answer.startMs, note, typed: p.answer.inputMode === "text" };
}

/** Sentences of an answer ranked by how many matches of `count` they hold. */
function worstSentences(per: PerAnswer[], count: (s: string) => number, min: number) {
  return per.flatMap((p) => sentences(p.answer.text).map((s) => ({ p, s, n: count(s) }))).filter((x) => x.n >= min).sort((a, b) => b.n - a.n);
}

export function assess(input: PlannerInput): Assessment[] {
  const { sessionId, per } = input;
  const metric = (k: string) => input.metrics.find((m) => m.key === k && m.value !== null && m.confidence !== "low") ?? null;
  const spoken = per.filter((p) => p.answer.inputMode !== "text");
  const substantive = per.filter((p) => p.h.wordCount >= 30 && p.answer.questionKind !== "closing");
  // Story lessons teach from stories: the opener has its own lesson.
  const stories = substantive.filter((p) => p.answer.questionKind !== "intro").length ? substantive.filter((p) => p.answer.questionKind !== "intro") : substantive;
  const out: Assessment[] = [];
  const add = (a: Omit<Assessment, "evidence"> & { evidence: Omit<LessonEvidence, "moments"> & { moments?: LessonEvidence["moments"] } }) =>
    out.push({ ...a, evidence: { moments: [], ...a.evidence } });

  const fillers = metric("filler_per_min");
  if (fillers) {
    const v = fillers.value!;
    const worst = worstSentences(per, (s) => countFillers(s).total, 2).slice(0, 2);
    const byType = Object.entries((fillers.detail?.byType ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 3);
    add({
      key: "fillers", metricKey: "filler_per_min", value: v, need: Math.max(0, (v - 3) / 3),
      evidence: {
        value: v, unit: "/min", display: `${v} a minute`, target: "under 3 a minute", confidence: fillers.confidence,
        facts: [`${v} fillers a minute across the interview`, ...(byType.length ? [`most often: ${byType.map(([k, n]) => `“${k}” ×${n}`).join(", ")}`] : [])],
        quotes: worst.map((w) => quoteOf(sessionId, w.p, w.s, `${w.n} fillers in one sentence`)),
      },
      focus: worst[0] ? { answerId: worst[0].p.answer.id, question: worst[0].p.answer.questionText, text: worst.map((w) => w.s).join(" ") } : null,
    });
  }

  const pace = metric("pace_wpm");
  if (pace) {
    const v = pace.value!;
    const fast = v > 160;
    const extreme = [...spoken].filter((p) => p.wpm !== null).sort((a, b) => (fast ? b.wpm! - a.wpm! : a.wpm! - b.wpm!))[0];
    add({
      key: "pace", metricKey: "pace_wpm", value: v, need: v > 160 ? (v - 160) / 40 : v < 120 ? (120 - v) / 40 : 0,
      evidence: {
        value: v, unit: "wpm", display: `${v} words a minute`, target: "120–160 words a minute", confidence: pace.confidence,
        facts: [`${v} words a minute overall, ${fast ? "faster than" : v < 120 ? "slower than" : "within"} the 120–160 range`, ...(extreme ? [`${fast ? "fastest" : "slowest"} answer: ${Math.round(extreme.wpm!)} words a minute`] : [])],
        quotes: extreme ? [quoteOf(sessionId, extreme, sentences(extreme.answer.text).slice(0, 2).join(" "), `${Math.round(extreme.wpm!)} words a minute`)] : [],
      },
      focus: null,
    });
  }

  const variety = metric("vocal_variety");
  if (variety) {
    const v = variety.value!;
    const flatIds = (variety.detail?.flatAnswers ?? []) as string[];
    const flat = per.filter((p) => flatIds.includes(p.answer.id)).slice(0, 2);
    add({
      key: "vocal_variety", metricKey: "vocal_variety", value: v, need: v < 2 ? (2 - v) / 2 : 0,
      evidence: {
        value: v, unit: "semitones", display: `${v} semitones of pitch movement`, target: "2 semitones or more", confidence: variety.confidence,
        facts: [`median pitch movement ${v} semitones`, ...(flat.length ? [`${flat.length} answer${flat.length > 1 ? "s" : ""} sounded notably flat`] : [])],
        quotes: flat.map((p) => quoteOf(sessionId, p, sentences(p.answer.text).slice(0, 1).join(" "), p.pitchVarietySt !== null ? `${r1(p.pitchVarietySt)} semitones` : null)),
      },
      focus: null,
    });
  }

  const structure = metric("structure_score");
  if (structure && substantive.length) {
    const v = structure.value!;
    const weakest = [...stories].sort((a, b) => a.h.starScore - b.h.starScore)[0];
    const missing = (structure.detail?.missing ?? {}) as Record<string, number>;
    const gaps = (["situation", "action", "result", "outcome"] as const).filter((k) => !weakest.h.star[k]);
    add({
      key: "structure", metricKey: "structure_score", value: v, need: v < 70 ? (70 - v) / 70 : 0,
      evidence: {
        value: v, unit: "%", display: `${v}% structure`, target: "70% or more", confidence: structure.confidence,
        facts: [`structure score ${v}%`, ...Object.entries(missing).filter(([, n]) => n > 0).map(([k, n]) => `${k === "action" ? "your own action" : k} missing in ${n} of ${substantive.length} answers`)],
        quotes: [quoteOf(sessionId, weakest, sentences(weakest.answer.text).slice(0, 3).join(" "), gaps.length ? `missing: ${gaps.join(", ")}` : null)],
      },
      focus: { answerId: weakest.answer.id, question: weakest.answer.questionText, text: weakest.answer.text },
    });
  }

  const specificity = metric("specificity");
  if (specificity && substantive.length) {
    const v = specificity.value!;
    const vague = [...stories].filter((p) => p.h.quantified.length === 0).sort((a, b) => b.h.vagueness - a.h.vagueness)[0] ?? [...stories].sort((a, b) => b.h.vagueness - a.h.vagueness)[0];
    const sentence = [...sentences(vague.answer.text)].sort((a, b) => vaguenessScore(b) - vaguenessScore(a))[0] ?? vague.answer.text;
    const quantifiedAnswers = substantive.filter((p) => p.h.quantified.length > 0).length;
    add({
      key: "specificity", metricKey: "specificity", value: v, need: v < 60 ? (60 - v) / 60 : 0,
      evidence: {
        value: v, unit: "%", display: `${v}% specific`, target: "60% or more", confidence: specificity.confidence,
        facts: [`specificity ${v}%`, `${quantifiedAnswers} of ${substantive.length} answers stated a number, scope or timeframe`],
        quotes: [quoteOf(sessionId, vague, sentence, vague.h.quantified.length ? null : "no number, scope or timeframe")],
      },
      focus: { answerId: vague.answer.id, question: vague.answer.questionText, text: vague.answer.text },
    });
  }

  const hedges = metric("hedges_per_min");
  if (hedges) {
    const v = hedges.value!;
    const worst = worstSentences(per, (s) => countHedges(s).total, 2).slice(0, 2);
    add({
      key: "hedging", metricKey: "hedges_per_min", value: v, need: v > 2 ? (v - 2) / 2 : 0,
      evidence: {
        value: v, unit: "/min", display: `${v} a minute`, target: "under 2 a minute", confidence: hedges.confidence,
        facts: [`${v} hedges a minute`],
        quotes: worst.map((w) => quoteOf(sessionId, w.p, w.s, `${w.n} softeners in one sentence`)),
      },
      focus: worst[0] ? { answerId: worst[0].p.answer.id, question: worst[0].p.answer.questionText, text: worst.map((w) => w.s).join(" ") } : null,
    });
  }

  const recovery = metric("recovery_ms");
  if (recovery) {
    const v = recovery.value!;
    const slowest = [...spoken].filter((p) => p.answer.firstWordLatencyMs !== null).sort((a, b) => b.answer.firstWordLatencyMs! - a.answer.firstWordLatencyMs!)[0];
    add({
      key: "recovery", metricKey: "recovery_ms", value: v, need: v > 2500 ? (v - 2500) / 2500 : 0,
      evidence: {
        value: v, unit: "ms", display: `${r1(v / 1000)} s to your first word`, target: "under 2.5 s", confidence: recovery.confidence,
        facts: [`median ${r1(v / 1000)} seconds before your first word after harder questions`],
        quotes: slowest ? [{ ...quoteOf(sessionId, slowest, sentences(slowest.answer.text).slice(0, 1).join(" "), `${r1(slowest.answer.firstWordLatencyMs! / 1000)} s before your first word`) }] : [],
      },
      focus: null,
    });
  }

  if (substantive.length) {
    const lens = substantive.map((p) => p.durationSec).sort((a, b) => a - b);
    const median = lens[Math.floor(lens.length / 2)];
    const longest = [...substantive].sort((a, b) => b.durationSec - a.durationSec)[0];
    add({
      key: "concision", metricKey: "answer_seconds", value: Math.round(median), need: median > 120 ? (median - 120) / 60 : longest.durationSec > 180 ? 0.3 : 0,
      evidence: {
        value: Math.round(median), unit: "s", display: `${lengthOf(median)} typical answer`, target: "under 2 minutes", confidence: "high",
        facts: [`typical answer ${lengthOf(median)}`, `longest answer ${lengthOf(longest.durationSec)} (${longest.h.wordCount} words)`],
        quotes: [quoteOf(sessionId, longest, sentences(longest.answer.text).slice(0, 2).join(" "), `${lengthOf(longest.durationSec)}, ${longest.h.wordCount} words`)],
      },
      focus: { answerId: longest.answer.id, question: longest.answer.questionText, text: longest.answer.text },
    });
  }

  const intro = per.find((p) => p.answer.questionKind === "intro" && p.h.wordCount >= 10);
  if (intro) {
    const sec = intro.durationSec;
    const role = /\b(i'?m|i am|i work|i've been|i have been)\b/i.test(intro.answer.text);
    add({
      key: "opener", metricKey: "opener_seconds", value: Math.round(sec), need: sec > 45 ? (sec - 45) / 45 : role ? 0 : 0.3,
      evidence: {
        value: Math.round(sec), unit: "s", display: `${lengthOf(sec)} opener`, target: "under 45 seconds", confidence: "high",
        facts: [`your opener ran ${lengthOf(sec)} (${intro.h.wordCount} words)`, ...(role ? [] : ["it didn't say who you are professionally"])],
        quotes: [quoteOf(sessionId, intro, sentences(intro.answer.text).slice(0, 2).join(" "), lengthOf(sec))],
      },
      focus: { answerId: intro.answer.id, question: intro.answer.questionText, text: intro.answer.text },
    });
  }

  const eyes = metric("camera_engagement");
  if (eyes) {
    const v = eyes.value!;
    const lowest = [...per].filter((p) => p.engagement !== null).sort((a, b) => a.engagement! - b.engagement!)[0];
    add({
      key: "eye_contact", metricKey: "camera_engagement", value: v, need: v < 55 ? (55 - v) / 55 : 0,
      evidence: {
        value: v, unit: "%", display: `${v}% at the lens (estimated)`, target: "55% or more", confidence: eyes.confidence,
        facts: [`estimated eye contact ${v}% while you spoke`],
        quotes: lowest ? [quoteOf(sessionId, lowest, sentences(lowest.answer.text).slice(0, 1).join(" "), `about ${Math.round(lowest.engagement! * 100)}% at the lens during this answer`)] : [],
      },
      focus: null,
    });
  }

  const movement = input.metrics.find((m) => m.key === "movement" && m.confidence !== "low");
  if (movement && movement.detail?.slouchMeasured) {
    const events = ((movement.detail?.events ?? []) as PostureEvent[]).filter((e) => e.kind === "slouch" || e.kind === "fidget");
    const slouches = events.filter((e) => e.kind === "slouch").length, restless = events.filter((e) => e.kind === "fidget").length;
    add({
      key: "posture", metricKey: "movement", value: slouches, need: Math.max(0, slouches - 1) * 0.3 + Math.max(0, restless - 2) * 0.15,
      evidence: {
        value: slouches, unit: "slouches", display: `${slouches} slouch${slouches === 1 ? "" : "es"}, ${restless} restless stretch${restless === 1 ? "" : "es"}`, target: "at most 1 slouch, 2 restless stretches", confidence: movement.confidence,
        facts: [`${slouches} times you slouched for 2 seconds or more`, `${restless} restless stretches`],
        quotes: [],
        moments: events.slice(0, 4).map((e) => ({ sessionId, startMs: e.t, label: `${e.kind === "slouch" ? "Slouched" : "Restless"} at ${mmss(e.t)} for ${Math.round(e.durationMs / 1000)} s` })),
      },
      focus: null,
    });
  }

  const setup = input.metrics.find((m) => m.key === "setup");
  if (setup) {
    const issues = (setup.detail?.issues ?? []) as string[];
    add({
      key: "setup", metricKey: "setup", value: issues.length, need: issues.length * 0.3,
      evidence: { value: issues.length, unit: "issues", display: `${issues.length} setup issue${issues.length === 1 ? "" : "s"}`, target: "none", confidence: "high", facts: issues, quotes: [] },
      focus: null,
    });
  }
  return out;
}

/** Rank needed lessons: biggest gaps first, weighted by track, a few at a time, spread across tracks. */
export function planLessons(input: PlannerInput): PlannedLesson[] {
  const needed = assess(input).filter((a) => a.need > 0.05);
  const ranked = needed
    .map((a) => ({ ...a, track: LESSONS[a.key].track, priority: Math.round(a.need * TRACK_WEIGHT[LESSONS[a.key].track] * (a.evidence.confidence === "medium" ? 0.9 : 1) * 1000) / 1000 }))
    .sort((a, b) => b.priority - a.priority || LESSON_ORDER.indexOf(a.key) - LESSON_ORDER.indexOf(b.key));
  const perTrack: Record<Track, number> = { delivery: 0, responses: 0, presence: 0 };
  let active = 0;
  return ranked.map((l) => {
    const take = active < MAX_ACTIVE && perTrack[l.track] < MAX_PER_TRACK;
    if (take) { active++; perTrack[l.track]++; }
    return { ...l, status: take ? "active" : "queued" };
  });
}
