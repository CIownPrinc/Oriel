import type { LessonKey, Track } from "./types";

/**
 * The lesson library: one lesson per skill, written once by people (not generated), so
 * the technique is sound. What makes a lesson personal is added per person: their own
 * measurements, their own words, and their own answer rewritten (lib/lessons/planner,
 * lib/ai/lesson-writer). Practice is a measured drill (lib/practice/catalog).
 */
export const TRACKS: Record<Track, { label: string; blurb: string }> = {
  delivery: { label: "Delivery", blurb: "How you sound" },
  responses: { label: "Responses", blurb: "What you say" },
  presence: { label: "Presence", blurb: "How you come across on camera" },
};

export interface LessonDef {
  key: LessonKey;
  track: Track;
  title: string;
  promise: string;
  why: string;
  steps: { title: string; body: string }[];
  /** The drill that practises this skill; null when practice is a setup check. */
  drillId: string | null;
  /** In plain words: what "learned" looks like in a real interview. */
  goal: string;
  /** Whether rewriting one of the person's answers teaches this skill. */
  rewrites: boolean;
}

export const LESSONS: Record<LessonKey, LessonDef> = {
  fillers: {
    key: "fillers", track: "delivery", title: "Swap filler for a pause", promise: "Replace “um”, “uh” and “like” with a silent beat.",
    why: "Fillers make a strong answer sound unsure, and they crowd out the pauses that let a point land. Listeners hear a pause as thinking; they hear “um” as searching.",
    steps: [
      { title: "Find your trigger", body: "Fillers cluster at the start of an answer and between ideas. Look at where yours land in the quotes above." },
      { title: "Close your mouth", body: "When you feel one coming, close your lips and breathe through your nose. You can't say “um” with your mouth shut." },
      { title: "Let the pause sit", body: "A one-second silence feels long to you and normal to them. Count “one” in your head, then go." },
      { title: "Bridge with words, not sounds", body: "If you need more time, say so: “Let me think about the best example.”" },
    ],
    drillId: "replace_filler", goal: "Under 3 fillers a minute in an interview.", rewrites: true,
  },
  pace: {
    key: "pace", track: "delivery", title: "Find a steady pace", promise: "Speak at a pace people can follow, and slow down for what matters.",
    why: "Rushing reads as nerves and makes your best results fly past; dragging loses attention. A conversational pace, slowing for key facts, sounds in control.",
    steps: [
      { title: "Aim for 130–150 words a minute", body: "Quick enough to sound energetic, slow enough to follow. The drill shows you where you are." },
      { title: "Half-speed for the payoff", body: "Numbers, names and results deserve a slower delivery and a beat after them." },
      { title: "Finish your sentences", body: "Drop your pitch and stop at the full stop instead of running into “and so…”." },
      { title: "Cut the run-up", body: "A slow pace often comes from long set-ups. Start with the point and the pace follows." },
    ],
    drillId: "steady_pace", goal: "Between 120 and 160 words a minute in an interview.", rewrites: false,
  },
  vocal_variety: {
    key: "vocal_variety", track: "delivery", title: "Bring your voice to life", promise: "Use pitch and stress to show which words matter.",
    why: "A flat voice makes even good news sound routine. Rising and falling pitch, and stress on key words, tell the listener what to remember.",
    steps: [
      { title: "Pick three words to stress", body: "In each answer: your action, the number, the result. Give those words more pitch and a touch more volume." },
      { title: "Pause before the payoff", body: "A short pause right before the key number makes it land." },
      { title: "Smile on the good news", body: "It lifts your pitch naturally, and they can hear it." },
      { title: "Vary the length of sentences", body: "A short sentence after a long one sounds decisive." },
    ],
    drillId: "emphasis", goal: "At least 2 semitones of pitch movement in an interview.", rewrites: false,
  },
  structure: {
    key: "structure", track: "responses", title: "Land the result", promise: "Tell stories that finish: situation, what you did, what changed.",
    why: "Interviewers score what you did and what happened. Stories that stop at the situation leave them guessing, and guessing rarely goes your way.",
    steps: [
      { title: "One sentence of context", body: "Situation and task in a breath: where you were and what was at stake." },
      { title: "Most of your time on your actions", body: "Say “I”, name the decision, and why you made it." },
      { title: "Always end with the result", body: "What changed, with a number if you have one." },
      { title: "Close the loop", body: "One line on what it meant, or what you'd do again." },
    ],
    drillId: "star_structure", goal: "Structure score of 70% or more in an interview.", rewrites: true,
  },
  specificity: {
    key: "specificity", track: "responses", title: "Put numbers on it", promise: "Give every result a size, a change and a timeframe.",
    why: "“Improved the process” is forgettable; “cut onboarding from nine days to four” is a fact they can repeat in the debrief.",
    steps: [
      { title: "Size, change, time", body: "For every result: how big, how much it changed, how long it took." },
      { title: "Estimates are fine if you say so", body: "“Roughly 30%” beats “a lot”. Never invent; approximate honestly." },
      { title: "Real nouns, not “stuff”", body: "Name the team, the tool, the customer group." },
      { title: "Prepare five numbers", body: "Before any interview, write down five results with numbers you can defend." },
    ],
    drillId: "quantify_results", goal: "Specificity of 60% or more in an interview.", rewrites: true,
  },
  hedging: {
    key: "hedging", track: "responses", title: "Say it like you mean it", promise: "Drop the softeners and own your work.",
    why: "“I think I maybe helped with” tells them you're not sure of your own work. Every hedge gives away credit you earned.",
    steps: [
      { title: "Delete the softeners", body: "“I think”, “just”, “kind of”, “maybe”: most can go without changing what you mean." },
      { title: "Own the verb", body: "“I led”, “I decided”, “I built”. Not “I was involved in”." },
      { title: "Be uncertain once, clearly", body: "If you don't know, say it once: “I don't have the exact figure; it was around 20%.”" },
    ],
    drillId: "own_it", goal: "Under 2 hedges a minute in an interview.", rewrites: true,
  },
  recovery: {
    key: "recovery", track: "responses", title: "Start strong under pressure", promise: "Begin a calm answer to a hard question within two seconds.",
    why: "A hard question tests composure. A long silence and a scramble read as rattled; a calm first sentence buys you time to think.",
    steps: [
      { title: "Breathe once", body: "One breath through the nose. It stops the rush." },
      { title: "Use a framing sentence", body: "“That's a fair challenge. Here's how I see it.” Your answer has started while you think." },
      { title: "Answer the concern", body: "Address what they're worried about directly, then give evidence." },
      { title: "One acknowledgement, no apologies", body: "Acknowledge once, then move forward." },
    ],
    drillId: "hard_recovery", goal: "Your first word within 2.5 seconds of hard questions.", rewrites: false,
  },
  concision: {
    key: "concision", track: "responses", title: "Get to the point", promise: "Headline first, one example, stop at the result.",
    why: "Long answers lose the thread, and the interviewer's attention. Most strong answers fit in 60 to 90 seconds; they'll ask for more if they want it.",
    steps: [
      { title: "Headline first", body: "Answer in one sentence, then support it." },
      { title: "One story, not three", body: "Pick your best example and go deep instead of wide." },
      { title: "Stop at the result", body: "When you've said what changed, stop talking. Silence after a complete answer is fine." },
    ],
    drillId: "point_first", goal: "Typical answers under two minutes in an interview.", rewrites: true,
  },
  opener: {
    key: "opener", track: "responses", title: "Nail your first 30 seconds", promise: "A crisp answer to “tell me about yourself”.",
    why: "Your opener sets the tone for everything after it. A crisp one makes them lean in; a long biography makes them wait for the point.",
    steps: [
      { title: "Present", body: "Who you are professionally, in one sentence." },
      { title: "Proof", body: "One result you're known for, with a number." },
      { title: "Future", body: "Why this role, and why now." },
      { title: "Stop at 30 seconds", body: "Then let them ask. A short opener invites the conversation." },
    ],
    drillId: "opener_30s", goal: "An opener under 45 seconds in an interview.", rewrites: true,
  },
  eye_contact: {
    key: "eye_contact", track: "presence", title: "Hold the lens", promise: "Look where their eyes are: the camera.",
    why: "On video, the lens is their eyes. Looking at your own face, or theirs, on screen reads as looking away.",
    steps: [
      { title: "Move their window", body: "Put the interviewer's video right under your camera so the two are close." },
      { title: "Lens for the key points", body: "Look at the lens for results and conclusions. That's when it counts." },
      { title: "Look away to think, then come back", body: "Nobody stares. Just return when you start speaking again." },
      { title: "Use a sticker", body: "A small sticker beside the camera is a reminder that works." },
    ],
    drillId: "hold_the_lens", goal: "Estimated eye contact of 55% or more in an interview.", rewrites: false,
  },
  posture: {
    key: "posture", track: "presence", title: "Sit tall, stay steady", promise: "An upright, settled posture that reads as composed.",
    why: "Slumping lowers your energy and your voice; rocking or constant shifting distracts. A stable, upright posture reads as calm and engaged.",
    steps: [
      { title: "Set your base", body: "Feet flat, hips to the back of the chair, shoulders down and back." },
      { title: "Lean in to listen", body: "A slight forward lean while they speak shows engagement." },
      { title: "Anchor your hands", body: "Rest them on the desk between gestures. Gesturing while you talk is good." },
      { title: "Reset between answers", body: "Use the moment after each answer to sit back up." },
    ],
    drillId: "steady_posture", goal: "No more than one slouch and two restless stretches in an interview.", rewrites: false,
  },
  setup: {
    key: "setup", track: "presence", title: "Fix your setup", promise: "Light, framing and sound that show you at your best.",
    why: "Before you say a word, your setup speaks: dim light, an off-center frame or a noisy room make you seem less engaged than you are.",
    steps: [
      { title: "Light in front of you", body: "Face a window or a lamp. Light behind you turns you into a silhouette." },
      { title: "Camera at eye level", body: "Stack books under your laptop so you're not looking down into it." },
      { title: "Head and shoulders, centred", body: "Leave a little space above your head; keep your shoulders in view." },
      { title: "Quiet room, close mic", body: "Close the door, silence notifications, and keep the microphone within an arm's length." },
    ],
    drillId: null, goal: "No setup issues flagged in an interview.", rewrites: false,
  },
};

/** A lesson measure in words, the same way everywhere: "3.4 a minute", "2.1 s", "1 min 40 s". */
export function formatMeasure(metricKey: string, v: number): string {
  const r1 = Math.round(v * 10) / 10;
  switch (metricKey) {
    case "filler_per_min": case "hedges_per_min": return `${r1} a minute`;
    case "pace_wpm": return `${Math.round(v)} words a minute`;
    case "vocal_variety": return `${r1} semitones`;
    case "structure_score": case "specificity": return `${Math.round(v)}%`;
    case "camera_engagement": return `${Math.round(v)}% at the lens`;
    case "recovery_ms": return `${Math.round(v / 100) / 10} s`;
    case "answer_seconds": case "opener_seconds": return v >= 90 ? `${Math.floor(v / 60)} min ${Math.round(v % 60)} s` : `${Math.round(v)} s`;
    case "movement": return `${Math.round(v)} slouch${Math.round(v) === 1 ? "" : "es"}`;
    case "setup": return `${Math.round(v)} issue${Math.round(v) === 1 ? "" : "s"}`;
    default: return String(r1);
  }
}

/** Passing drill attempts that count a lesson as practised. */
export const PRACTICE_PASSES_NEEDED = 2;

export const LESSON_ORDER: LessonKey[] = ["structure", "specificity", "concision", "opener", "hedging", "recovery", "fillers", "pace", "vocal_variety", "eye_contact", "posture", "setup"];
