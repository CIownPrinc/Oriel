import type { PersonaId } from "@/lib/interview/personas";
import type { PressureLevel } from "@/lib/interview/pressure";

export interface LadderRung {
  level: number;
  name: string;
  description: string;
  personaIds: PersonaId[];
  mode: "single" | "panel";
  pressure: PressureLevel;
  curveballs: boolean;
}

/** Professional progression. Unlock the next rung after two sessions above your own baseline. */
export const LADDER: LadderRung[] = [
  { level: 1, name: "Friendly Recruiter", description: "A first screen. Tell your story clearly and land your motivation.", personaIds: ["warm_recruiter"], mode: "single", pressure: 1, curveballs: false },
  { level: 2, name: "Hiring Manager", description: "What did you actually do, and did it work? Expect follow-ups on thin answers.", personaIds: ["hiring_manager"], mode: "single", pressure: 2, curveballs: false },
  { level: 3, name: "Direct Hiring Manager", description: "Time-conscious and direct. Rambling gets redirected.", personaIds: ["direct_manager"], mode: "single", pressure: 3, curveballs: false },
  { level: 4, name: "Skeptical Manager", description: "Your numbers and ownership get tested. Silence is used on purpose.", personaIds: ["skeptic"], mode: "single", pressure: 4, curveballs: false },
  { level: 5, name: "Panel", description: "Three interviewers with different agendas. They hand off and cross-question.", personaIds: ["hiring_manager", "skeptic", "peer"], mode: "panel", pressure: 3, curveballs: false },
  { level: 6, name: "Curveball Panel", description: "A four-person panel under pressure, with questions you did not prepare for.", personaIds: ["hiring_manager", "skeptic", "peer", "executive"], mode: "panel", pressure: 4, curveballs: true },
];

export const LADDER_QUALIFYING_SESSIONS = 2;

export interface DrillDef {
  id: string;
  title: string;
  objective: string;
  instructions: string;
  prompt: string;
  targetMetric: "opener_seconds" | "filler_per_min" | "quantified_claims" | "recovery_ms" | "camera_engagement" | "structure_score"
    | "pace_wpm" | "vocal_variety" | "hedges_per_min" | "answer_seconds" | "posture_upright";
  durationSec: number;
  requiresCamera: boolean;
  /** Measured from the voice itself (pace, pitch), so it can't be typed. */
  requiresVoice?: boolean;
  /** Metric improves when it goes down (fillers, recovery), up (engagement) or into a range (pace). */
  direction: "lower" | "higher" | "range";
  passRule: string;
}

export const DRILLS: DrillDef[] = [
  {
    id: "opener_30s", title: "30-second opener",
    objective: "Answer 'tell me about yourself' in under 30 seconds with a clear point.",
    instructions: "Lead with who you are professionally, one proof point, and why this role. Stop by 30 seconds; the timer will show you.",
    prompt: "Tell me about yourself.",
    targetMetric: "opener_seconds", durationSec: 45, requiresCamera: false, direction: "lower",
    passRule: "Under 35 seconds with a role, a proof point, and a reason.",
  },
  {
    id: "replace_filler", title: "Replace filler with a pause",
    objective: "Cut filler words by swapping them for a silent beat.",
    instructions: "Answer the question for about a minute. When you feel an 'um' coming, close your mouth and pause instead. Silence reads as confidence.",
    prompt: "Describe a project you worked on recently and what made it difficult.",
    targetMetric: "filler_per_min", durationSec: 75, requiresCamera: false, direction: "lower",
    passRule: "Filler rate at least 30% below your baseline, or under 2 per minute.",
  },
  {
    id: "quantify_results", title: "Quantify results",
    objective: "Attach a number, scope, or timeframe to every result you claim.",
    instructions: "Answer with at least three concrete numbers: how big, how much changed, how long. Estimates are fine if you say they are estimates.",
    prompt: "Tell me about a time you improved something at work. What changed?",
    targetMetric: "quantified_claims", durationSec: 90, requiresCamera: false, direction: "higher",
    passRule: "Three or more quantified statements.",
  },
  {
    id: "hard_recovery", title: "Hard recovery",
    objective: "Start answering a hostile question within two seconds, calmly.",
    instructions: "You'll hear a pointed question. Take one breath, then begin with a short framing sentence. Don't apologize, don't over-explain.",
    prompt: "Honestly, your background doesn't look like a fit for this role. Why should I keep talking to you?",
    targetMetric: "recovery_ms", durationSec: 60, requiresCamera: false, direction: "lower",
    passRule: "First word within 2.5 seconds and a structured answer.",
  },
  {
    id: "hold_the_lens", title: "Hold the lens",
    objective: "Keep your eyes near the camera through a difficult answer.",
    instructions: "Put a small sticker by your camera. Answer while returning to the lens whenever you finish a thought. Looking away to think is fine; just come back.",
    prompt: "Tell me about a mistake you made that affected other people.",
    targetMetric: "camera_engagement", durationSec: 75, requiresCamera: true, direction: "higher",
    passRule: "Estimated eye contact at least 10 points above your baseline.",
  },
  {
    id: "star_structure", title: "Land the result",
    objective: "Finish every story with the outcome and what it meant.",
    instructions: "Use situation, action, result, and spend the most time on the action you personally took. End with the result and one sentence on what it meant.",
    prompt: "Tell me about a time you had to influence someone without authority.",
    targetMetric: "structure_score", durationSec: 90, requiresCamera: false, direction: "higher",
    passRule: "Situation, action and result all present, with a stated outcome.",
  },
  {
    id: "steady_pace", title: "Steady pace",
    objective: "Answer at a conversational pace, slowing down for the key facts.",
    instructions: "Answer for about a minute. Breathe at each full stop and slow down for numbers and results. Speak this one aloud: pace is measured from your voice.",
    prompt: "Walk me through how you approach the first two weeks of a new project.",
    targetMetric: "pace_wpm", durationSec: 75, requiresCamera: false, requiresVoice: true, direction: "range",
    passRule: "Between 125 and 165 words a minute of speaking time.",
  },
  {
    id: "emphasis", title: "Lift the key words",
    objective: "Use pitch and stress so your result stands out.",
    instructions: "Before you start, pick three words to stress: your action, the number, the result. Say those a little higher and louder, with a short pause before the number.",
    prompt: "Tell me about the achievement you're proudest of.",
    targetMetric: "vocal_variety", durationSec: 75, requiresCamera: false, requiresVoice: true, direction: "higher",
    passRule: "At least 2.5 semitones of pitch movement, or 20% more than your baseline.",
  },
  {
    id: "own_it", title: "Own it",
    objective: "Describe your work with no softeners.",
    instructions: "Answer without “I think”, “just”, “kind of” or “maybe”. Use strong verbs: I led, I decided, I built. If you're unsure of a figure, say so once.",
    prompt: "What is your greatest strength, and where has it made a difference at work?",
    targetMetric: "hedges_per_min", durationSec: 75, requiresCamera: false, direction: "lower",
    passRule: "Under 1 hedge a minute, or half your baseline.",
  },
  {
    id: "point_first", title: "Point first",
    objective: "One headline sentence, one example, then stop, all inside 75 seconds.",
    instructions: "Start with your answer in a single sentence. Give one example and its result. Then stop: no second story, no recap.",
    prompt: "Tell me about a time you had to make an important decision quickly.",
    targetMetric: "answer_seconds", durationSec: 75, requiresCamera: false, direction: "lower",
    passRule: "Under 75 seconds, at least 40 words, ending with a result.",
  },
  {
    id: "steady_posture", title: "Sit tall",
    objective: "Stay upright and settled through a demanding answer.",
    instructions: "Sit back in your chair, feet flat, shoulders down. Then calibrate sitting the way you want to sit. Gesture freely while you answer; just don't slump or rock.",
    prompt: "Tell me about a time you received difficult feedback. What did you do with it?",
    targetMetric: "posture_upright", durationSec: 75, requiresCamera: true, direction: "higher",
    passRule: "Upright at least 85% of the time, with no slouch held for 2 seconds.",
  },
];

export function getDrill(id: string) {
  return DRILLS.find((d) => d.id === id);
}
