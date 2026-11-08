/**
 * Deterministic language analysis of spoken answers. Runs in the browser (for live
 * interrupt decisions) and on the server (controller + feedback). No model calls.
 *
 * Words that are fillers or hedges only in some uses ("actually", "literally", "just") are
 * counted only in those uses: "what actually happened" and "just two weeks" carry meaning.
 */

export const FILLER_PATTERNS: { key: string; re: RegExp }[] = [
  { key: "um", re: /\b(?:um+|umm+|erm+|hmm+)\b/gi },
  { key: "uh", re: /\b(?:uh+|er)\b/gi },
  { key: "like", re: /(?<!\b(?:would|i|you|we|they|feel|looks?|seems?|just)\s)\blike\b(?!\s+(?:to|that|this|it|a|the)\b)/gi },
  { key: "you know", re: /\byou know\b(?!\s+(?:how|what|that|the|a|it|when|where|why))/gi },
  { key: "kind of", re: /\b(?:kind of|kinda|sort of|sorta)\b/gi },
  { key: "basically", re: /\bbasically\b/gi },
  // Filler only as a discourse marker: set off by a comma, next to another filler, or opening the answer.
  { key: "actually", re: /(?:^|(?<=[,.!?]\s*)|(?<=\b(?:so|and|but|um|uh|like|i mean),?\s))(?:actually|literally)\b(?=\s*,|\s+(?:like|um|uh|you know|i mean|basically)\b)|\b(?:actually|literally),/gim },
];

export const HEDGE_PATTERNS: { key: string; re: RegExp }[] = [
  { key: "i think", re: /\bi think\b/gi },
  { key: "maybe", re: /\b(?:maybe|perhaps|possibly)\b/gi },
  { key: "i guess", re: /\bi guess\b/gi },
  { key: "probably", re: /\bprobably\b/gi },
  { key: "i feel like", re: /\bi feel like\b/gi },
  // Softening "just" ("I just helped", "just kind of"); not "just two weeks", "just in time", "just as".
  { key: "just", re: /\b(?:(?<=\b(?:i|we|i've|we've|i'm|we're)\s)just\b(?!\s+(?:in time|as|before|after|now|then)\b)|just(?=\s+(?:kind of|sort of|a little|a bit|wanted|thought|felt|tried|trying|helped|did|kept)\b))/gi },
  { key: "a little", re: /\b(?:a little|a bit|somewhat)\b/gi },
  { key: "i'm not sure", re: /\bi'?m not (?:sure|certain)\b/gi },
];

const VAGUE_WORDS = /\b(?:things?|stuff|a lot|lots of|various|several|some stuff|helped (?:out|with)|worked on|involved in|a bunch|and so on|etc|pretty good|really good|many things|kind of|sort of|a couple)\b/gi;

const NUMBER_RE = /(?:\$\s?\d[\d,.]*\s?(?:k|m|mm|b|million|billion|thousand)?|\b\d[\d,.]*\s?(?:%|percent|x\b|k\b|m\b)?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million|billion|half|double|doubled|tripled)\b)/gi;

const NUMBER_TEST = new RegExp(NUMBER_RE.source, "i");

const UNIT_CONTEXT = /\b(?:percent|%|users?|customers?|people|engineers?|reports?|team|members?|months?|weeks?|days?|years?|hours?|dollars?|revenue|million|billion|thousand|k\b|x\b|times|clients?|patients?|projects?|countries|markets?|stores?|requests?|ms|seconds?|minutes?|points?|basis points|headcount|budget)\b/i;

export function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}'%$\s.-]/gu, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

export function countPatterns(text: string, patterns: { key: string; re: RegExp }[]) {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const { key, re } of patterns) {
    const n = (text.match(re) ?? []).length;
    if (n) byType[key] = n;
    total += n;
  }
  return { total, byType };
}

export const countFillers = (t: string) => countPatterns(t, FILLER_PATTERNS);
export const countHedges = (t: string) => countPatterns(t, HEDGE_PATTERNS);

/** Character offsets of each filler — used to find the "three worst moments". */
export function fillerPositions(text: string): { key: string; index: number }[] {
  const out: { key: string; index: number }[] = [];
  for (const { key, re } of FILLER_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) out.push({ key, index: m.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Sentences containing a number with a unit/context: "cut latency 40%", "a team of 12". */
export function quantifiedStatements(text: string): string[] {
  return sentences(text).filter((s) => {
    const nums = s.match(NUMBER_RE);
    return !!nums && nums.length > 0 && UNIT_CONTEXT.test(s);
  });
}

export function hasNumbers(text: string) {
  return quantifiedStatements(text).length > 0;
}

// First-person action: "I led…", "I basically had to, um, design…", "I've been driving…".
const ACTION_VERBS = "lead|led|build|built|decid|design|writ|wrote|creat|propos|negotiat|organi[sz]|ran|run|drov|driv|own|launch|analy[sz]|set up|push|convinc|hir|rewr|introduc|start|chang|implement|took|take|reach(?:ed)? out|met with|escalat|made the call|prioriti[sz]|manag|migrat|ship|deliver|coordinat|mentor|present|chose|choos|fix|debug|automat|reduc|increas|cut|grew|grow|sav|persuad|restructur|champion|refactor|architect|tested|test|wrote|plan|align";
const ACTION_RE = new RegExp(`\\bi(?:'ve|'m| have| am| was)?,? (?:[\\w']+,? ){0,5}?(?:${ACTION_VERBS})(?:e|ed|d|ing|s|t|e?s)?\\b`);

export interface StarPresence { situation: boolean; action: boolean; result: boolean; outcome: boolean }

export function detectStar(text: string): StarPresence {
  const t = text.toLowerCase();
  return {
    situation: /\b(?:when i was|at my (?:last|previous|current)|the (?:situation|context|problem|challenge) was|we (?:had|were facing)|back in|last year|in \d{4}|our team was|the company was|i joined|there was a)\b/.test(t),
    action: ACTION_RE.test(t),
    result: /\b(?:as a result|which (?:led|resulted)|resulted in|we (?:reduced|increased|cut|grew|saved|shipped|launched|delivered|hit|doubled)|(?:reduced|increased|improved|cut|grew|saved) (?:\w+ ){0,3}(?:by|to|from)|the result was|ended up|by the end)\b/.test(t) || (hasNumbers(t) && /\b(?:from|to|by)\b/.test(t)),
    outcome: /\b(?:i learned|learned that|the outcome|since then|today|going forward|what (?:it|that) meant|the impact|which meant|so that|now we|that's why|taught me|lesson)\b/.test(t),
  };
}

export function starScore(s: StarPresence) {
  return (Number(s.situation) * 0.2 + Number(s.action) * 0.35 + Number(s.result) * 0.3 + Number(s.outcome) * 0.15);
}

/** 0 (specific) .. 1 (vague). */
export function vaguenessScore(text: string): number {
  const w = words(text);
  if (w.length < 8) return 0.5;
  const vague = (text.match(VAGUE_WORDS) ?? []).length;
  const quant = quantifiedStatements(text).length;
  const iCount = w.filter((x) => x === "i").length;
  const weCount = w.filter((x) => x === "we").length;
  const properNouns = (text.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}/g) ?? []).filter((x) => !["I", "The", "And", "But", "So"].includes(x)).length;
  const per100 = (n: number) => (n / w.length) * 100;
  let score = 0.45;
  score += Math.min(0.35, per100(vague) * 0.09);
  score -= Math.min(0.35, quant * 0.14);
  score -= Math.min(0.12, per100(properNouns) * 0.03);
  if (weCount > iCount * 2 && weCount >= 3) score += 0.1; // ownership blurred
  if (iCount > 0) score -= 0.05;
  return Math.min(1, Math.max(0, score));
}

export type ClaimKind = "number" | "team" | "project" | "responsibility" | "outcome";

export interface ExtractedClaim { kind: ClaimKind; text: string; normalized: string }

/**
 * Pull checkable claims out of an answer, verbatim. The interviewer may only ever
 * reference claims from this list (or the LLM analyzer's validated equivalent) —
 * never invent them.
 */
export function extractClaims(text: string): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  const seen = new Set<string>();
  const push = (kind: ClaimKind, raw: string) => {
    const t = raw.trim().replace(/\s+/g, " ").replace(/[,.;]+$/, "");
    const norm = t.toLowerCase();
    if (t.length < 4 || seen.has(norm)) return;
    // Skip near-duplicates (one claim containing another); keep the more specific, longer one.
    const dup = out.findIndex((c) => c.normalized.includes(norm) || norm.includes(c.normalized));
    if (dup >= 0) {
      if (norm.length > out[dup].normalized.length) { seen.add(norm); out[dup] = { kind: out[dup].kind === "team" ? "team" : kind, text: t, normalized: norm }; }
      return;
    }
    seen.add(norm);
    out.push({ kind, text: t, normalized: norm });
  };
  // Team size: "a team of 12", "managed 12 engineers", "12 direct reports"
  for (const m of text.matchAll(/\b(?:(?:managed|led|ran|built|grew|hired)\s+)?(?:a\s+)?team of\s+(?:about\s+|around\s+)?(\d+|[a-z]+)(?:\s+\w+)?/gi)) push("team", m[0]);
  for (const m of text.matchAll(/\b(?:managed|led|ran|hired|oversaw)\s+(?:about\s+|around\s+|over\s+)?(\d+|[a-z]+)\s+(?:engineers|people|reports|direct reports|analysts|nurses|designers|developers|staff|consultants|managers)\b/gi)) push("team", m[0]);
  // Quantified results
  for (const s of quantifiedStatements(text)) {
    const clause = s.split(/(?:,|;| and | but )/).find((c) => NUMBER_TEST.test(c) && UNIT_CONTEXT.test(c)) ?? s;
    push(/(?:increase|reduce|cut|grew|grow|save|improve|doubl|tripl|drop|rais)/i.test(clause) ? "outcome" : "number", clause.length > 140 ? clause.slice(0, 140) : clause);
  }
  // Ownership statements: "I led the migration to Kubernetes"
  for (const m of text.matchAll(/\bI (?:led|owned|built|launched|designed|ran|created|drove|started|founded|architected|rewrote)\s+(?:the\s+|a\s+|an\s+|our\s+)?([^.,;!?]{3,70})/g)) push("project", m[0]);
  // Responsibility: "I was responsible for X"
  for (const m of text.matchAll(/\bI was (?:responsible for|in charge of|accountable for)\s+([^.,;!?]{3,70})/gi)) push("responsibility", m[0]);
  return out.slice(0, 8);
}

export interface AnswerHeuristics {
  wordCount: number;
  fillers: number;
  fillerTypes: Record<string, number>;
  hedges: number;
  hedgeTypes: Record<string, number>;
  quantified: string[];
  star: StarPresence;
  starScore: number;
  vagueness: number;
  claims: ExtractedClaim[];
  /** 0..1 overall answer quality used for adaptive pressure and weak-moment ranking. */
  quality: number;
}

export function analyzeAnswer(text: string, durationSec?: number): AnswerHeuristics {
  const w = words(text);
  const f = countFillers(text);
  const h = countHedges(text);
  const star = detectStar(text);
  const vague = vaguenessScore(text);
  const quantified = quantifiedStatements(text);
  const ss = starScore(star);
  const perMin = durationSec && durationSec > 5 ? (f.total / durationSec) * 60 : (f.total / Math.max(1, w.length)) * 140;
  const tooShort = w.length < 25 ? 0.25 : 0;
  const tooLong = durationSec && durationSec > 180 ? 0.15 : 0;
  const quality = Math.min(1, Math.max(0,
    0.2 + ss * 0.4 + (1 - vague) * 0.35 + Math.min(0.15, quantified.length * 0.06)
    - Math.min(0.2, perMin * 0.025) - Math.min(0.1, h.total * 0.015) - tooShort - tooLong,
  ));
  return {
    wordCount: w.length, fillers: f.total, fillerTypes: f.byType, hedges: h.total, hedgeTypes: h.byType,
    quantified, star, starScore: ss, vagueness: vague, claims: extractClaims(text), quality,
  };
}
