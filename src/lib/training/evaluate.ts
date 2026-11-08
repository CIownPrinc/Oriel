import { z } from "zod";
import type { LanguageModelProvider, LlmUsage } from "@/lib/ai/providers/types";
import { detectStar, quantifiedStatements, sentences, words } from "@/lib/analysis/text";
import { criterion, type Competency, type Level } from "./competencies";
import type { CriterionJudgment, CriterionLevel, Evaluation, Weakness } from "./engine";
import { summarize, type CodeResult, type CodeSpec, type CodeSubmission } from "./code";

/*
 * The evaluator: a fallible component, held to the rubric and checked before it is believed.
 *
 *   - Deterministic pre-checks first: an answer too short, or a transcript too broken to trust,
 *     is "not enough evidence", never a low score. A voice transcript that may be wrong asks for
 *     clarification rather than being judged.
 *   - The model judges each criterion and must quote the answer verbatim. Every quote is checked
 *     against the answer; a quote that isn't there is dropped, and a "clearly shown" without a
 *     real quote becomes "can't tell". Unknown criteria are dropped, missing ones are "can't tell".
 *   - Malformed output is retried once, then the pattern evaluator takes over, labelled as such.
 *   - Nothing here infers personality, intelligence, confidence or accent.
 */

export interface EvaluateInput {
  competency: Competency;
  question: string;
  expected: string;
  answer: string;
  inputMode: "voice" | "text";
  /** On retry, transfer and review the criterion being followed; the evaluator still judges them all. */
  target: string | null;
}

export interface EvaluateResult { evaluation: Evaluation; usage: LlmUsage | null; error?: string }

const MIN_WORDS = 15;

// ─── Grounding ──────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[“”"‘’']/g, "").replace(/[^\p{L}\p{N}%$.]+/gu, " ").replace(/\s+/g, " ").trim();

/** True only when the excerpt appears in the answer (ignoring case, punctuation and spacing). */
export function quotedFrom(excerpt: string | null | undefined, answer: string): boolean {
  if (!excerpt) return false;
  const e = norm(excerpt).replace(/\.+$/, "");
  return e.length >= 6 && norm(answer).includes(e);
}

// ─── Pre-checks ─────────────────────────────────────────────────────────────

/** Questions that ask for something that happened, rather than what you would do. */
const ASKS_FOR_EXPERIENCE = /^(?:tell me about (?:a|an|one|something|the)\b|describe (?:a|an|the) (?:time|project|situation|moment)|give me an example|walk me through a time)/i;
const CONDITIONAL = /\b(?:I|we)\s+would\b|\b(?:I|we)'d\s+(?:start|first|look|ask|set|go|choose|pick|do|try|make|probably|want|say|recommend|focus|begin|break)\b/gi;
const PAST = /\b(?:I|we)\s+(?:\w+ed|was|were|had|did|led|ran|made|took|got|built|went|chose|set|told|wrote|saw|knew|thought|found|spent|kept|cut|put|sent|met|gave|began|brought|drove|held|left|lost|won|sold|taught|caught|felt|heard|hired|fired)\b/i;

export function precheck(answer: string, inputMode: "voice" | "text", question = ""): string | null {
  const t = answer.trim();
  const n = words(t).length;
  if (!t || n < MIN_WORDS) return "The answer was too short to assess. Give a full answer, as you would in a real interview.";
  // A question about what happened, answered only with what you would do, can't show the skill as asked.
  if (ASKS_FOR_EXPERIENCE.test(question.trim()) && (t.match(CONDITIONAL) ?? []).length >= 2 && !PAST.test(t)) {
    return "This question asks about something that actually happened, and the answer describes what you would do. Answer from your own experience; if you haven't faced it, say so and describe the closest thing you have done.";
  }
  if (inputMode === "voice") {
    const broken = (t.match(/\((?:inaudible|unclear)\)|\[(?:inaudible|unclear)\]/gi) ?? []).length;
    if (broken >= 2 || /^\(?inaudible\)?$/i.test(t)) return "Parts of the recording couldn't be transcribed reliably, so it wasn't judged. Try again, or type the answer.";
  }
  return null;
}

// ─── The model ──────────────────────────────────────────────────────────────

const LevelWord = z.enum(["shown", "partly", "not_shown", "cannot_tell"]);
const ModelOutput = z.object({
  criteria: z.array(z.object({
    id: z.string(),
    level: LevelWord,
    evidence: z.string().nullable(),
    interpretation: z.string().max(400),
  })).min(1).max(8),
  enoughEvidence: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  primaryWeakness: z.object({
    criterionId: z.string(),
    observation: z.string().max(400),
    whyItMatters: z.string().max(300),
    instruction: z.string().max(300),
  }).nullable(),
  secondary: z.array(z.string().max(240)).max(3),
  limitations: z.string().max(300).nullable(),
});
type ModelOut = z.infer<typeof ModelOutput>;

const toLevel = (w: z.infer<typeof LevelWord>): CriterionLevel => (w === "shown" ? 2 : w === "partly" ? 1 : w === "not_shown" ? 0 : null);

function system(c: Competency): string {
  return [
    "You assess one interview answer against one competency's rubric. You are a careful, fallible assessor, not a cheerleader.",
    "Judge each criterion only from what the answer actually says. For each, give a level (shown, partly, not_shown, cannot_tell) and copy a short verbatim excerpt of the answer as evidence (null if none).",
    "Never invent quotations, accomplishments, numbers, names or details. Never fill a gap with an assumption about what the candidate meant.",
    "Use cannot_tell when the answer doesn't give enough to judge a criterion; it is not the same as not_shown. Set enoughEvidence to false if the answer is off-topic, too thin, or reads like a garbled transcript.",
    "Do not judge personality, intelligence, confidence, accent, tone or speaking habits, and do not reward length. Pauses and conversational phrasing are fine.",
    "primaryWeakness is the single most consequential criterion that is not shown, or null if all are shown. observation: one or two sentences about this answer, citing it. whyItMatters: one sentence. instruction: the principle to apply on the next attempt, in one sentence. Never write a model answer or sample sentences for the candidate.",
    `Competency: ${c.label}. ${c.summary}`,
    `Known limitation: ${c.limitations}`,
  ].join("\n");
}

function prompt(i: EvaluateInput): string {
  const c = i.competency;
  return [
    `Question asked: ${i.question}`,
    `What a strong answer to this question has to show: ${i.expected}`,
    "Rubric (use these exact criterion ids):",
    ...c.criteria.map((x) => `- ${x.id}: ${x.label}. Look for: ${x.look} Strong: ${x.strong} Usual failure: ${x.failure}`),
    `Scoring: not_shown = ${c.anchors[0]} partly = ${c.anchors[1]} shown = ${c.anchors[2]}`,
    `Input: ${i.inputMode === "voice" ? "a speech transcript (may contain recognition errors; do not penalise them)" : "typed text"}.`,
    "Answer:",
    `"""\n${i.answer.slice(0, 6000)}\n"""`,
  ].join("\n");
}

/** Validate and ground the model's output against the rubric and the answer. Throws when it can't be used. */
export function groundModelOutput(c: Competency, answer: string, out: ModelOut): Evaluation {
  const seen = new Set<string>();
  const byId = new Map<string, ModelOut["criteria"][number]>();
  for (const j of out.criteria) {
    if (!c.criteria.some((x) => x.id === j.id)) continue; // unknown criterion: drop it
    if (seen.has(j.id)) throw new Error(`duplicate criterion ${j.id}`);
    seen.add(j.id);
    byId.set(j.id, j);
  }
  if (!seen.size) throw new Error("no rubric criteria in output");
  let dropped = 0;
  const criteria: CriterionJudgment[] = c.criteria.map((x) => {
    const j = byId.get(x.id);
    if (!j) return { id: x.id, label: x.label, level: null, evidence: null, interpretation: "Not judged." };
    const grounded = quotedFrom(j.evidence, answer);
    if (j.evidence && !grounded) dropped++;
    let level = toLevel(j.level);
    // A claim that something is clearly shown needs a real excerpt behind it.
    if (level === 2 && !grounded) level = null;
    return { id: x.id, label: x.label, level, evidence: grounded ? j.evidence!.trim() : null, interpretation: j.interpretation.trim() };
  });
  let primary: Weakness | null = null;
  if (out.primaryWeakness) {
    const pc = criterion(c, out.primaryWeakness.criterionId);
    const lvl = criteria.find((x) => x.id === out.primaryWeakness!.criterionId)?.level;
    if (pc && lvl !== 2) primary = { ...out.primaryWeakness, instruction: out.primaryWeakness.instruction.trim() || pc.principle };
  }
  const allUnknown = criteria.every((x) => x.level === null);
  const enough = out.enoughEvidence && !allUnknown;
  const confidence = dropped > 0 ? "low" : out.confidence;
  return {
    competencyId: c.id, rubricVersion: c.version, evaluator: "model", criteria, enoughEvidence: enough, confidence,
    primary: enough ? primary : null, secondary: enough ? out.secondary : [],
    limitations: [out.limitations, dropped ? `${dropped} quoted excerpt${dropped > 1 ? "s" : ""} didn't match the answer and ${dropped > 1 ? "were" : "was"} discarded.` : null].filter(Boolean).join(" ") || null,
    insufficientReason: enough ? null : "There wasn't enough in this answer to judge the skill being practised. Answer the question fully, with a specific example.",
  };
}

// ─── The pattern evaluator (no language model) ──────────────────────────────

type Detector = (answer: string, question: string) => { level: Level; evidence: string | null };

const S = (re: RegExp): Detector => (answer) => {
  const hit = sentences(answer).find((s) => re.test(s));
  return { level: hit ? 2 : 0, evidence: hit ?? null };
};
const firstPerson = /\bI\s+(?:proposed|decided|chose|wrote|built|led|ran|set|asked|called|created|designed|pushed|convinced|negotiated|cut|changed|took|owned|started|stopped|hired|fired|interviewed|analy[sz]ed|presented|recommended|moved|split|planned|shipped|tested|measured)\b/i;
const overlap = (a: string, b: string) => {
  const stop = new Set(["the", "a", "an", "to", "of", "and", "you", "your", "me", "tell", "about", "time", "how", "would", "what", "that", "with", "for", "had", "when", "did", "do", "in", "on", "is", "it"]);
  const wa = new Set(words(a).map((w) => w.toLowerCase()).filter((w) => w.length > 3 && !stop.has(w)));
  const wb = words(b).map((w) => w.toLowerCase());
  return wb.filter((w) => wa.has(w)).length;
};

const DETECTORS: Record<string, Detector> = {
  "answer_the_question.direct": (answer, question) => {
    const first = sentences(answer).slice(0, 2).join(" ");
    const n = overlap(question, first);
    return { level: n >= 2 ? 2 : n === 1 ? 1 : 0, evidence: n ? sentences(answer)[0] ?? null : null };
  },
  "answer_the_question.relevant": (answer, question) => {
    const ss = sentences(answer);
    const on = ss.filter((s) => overlap(question, s) > 0).length;
    return { level: ss.length && on / ss.length >= 0.4 ? 2 : on ? 1 : 0, evidence: ss.find((s) => overlap(question, s) > 0) ?? null };
  },
  "answer_the_question.lands": S(/^(?:so|in short|overall|that'?s why|in the end|the answer is)\b/i),
  "personal_contribution.own_actions": S(firstPerson),
  "personal_contribution.distinct": S(/\b(?:my (?:part|role|job)|I owned|while (?:the team|they|we)|the team (?:did|handled|built)[^.]*\bI\b)/i),
  "personal_contribution.concrete": (answer) => {
    const hit = sentences(answer).find((s) => firstPerson.test(s) && (/\d/.test(s) || words(s).length > 10));
    return { level: hit ? 2 : 0, evidence: hit ?? null };
  },
  "decision_reasoning.alternatives": S(/\b(?:options?|alternatives?|instead|either|or we could|could have|versus|vs\.?|choose between|choice between|the other (?:path|choice|way))\b/i),
  "decision_reasoning.criteria": S(/\b(?:because|since|mattered|priorit|criteria|the main reason|weigh)/i),
  "decision_reasoning.uncertainty": S(/\b(?:didn'?t know|unknown|uncertain|risk|assum|not sure|incomplete|missing|unclear|gamble)/i),
  "decision_reasoning.justified": S(/\b(?:better than|rather than|over the|instead of|which is why|so I chose|so we chose)\b/i),
  "outcome_evidence.result": (answer) => {
    const star = detectStar(answer);
    const hit = sentences(answer).find((s) => /\b(?:result|in the end|ended up|we (?:launched|shipped|hit|cut|grew|saved)|led to|which meant)\b/i.test(s));
    return { level: hit ? 2 : star.result ? 1 : 0, evidence: hit ?? null };
  },
  "outcome_evidence.evidence": (answer) => {
    const q = quantifiedStatements(answer)[0];
    return { level: q ? 2 : 0, evidence: q ?? null };
  },
  "outcome_evidence.attribution": S(/\b(?:because (?:I|we|of)|thanks to|as a result of|which (?:meant|led)|that'?s why)\b/i),
  "tradeoff_reasoning.options": S(/\b(?:options?|approach(?:es)?|alternatives?|either|or we could|another way|versus|vs\.?|instead)\b/i),
  "tradeoff_reasoning.costs": S(/\b(?:cost|downside|trade-?off|but (?:it|that)|at the expense|slower|more complex|stale|latency|harder to)\b/i),
  "tradeoff_reasoning.constraints": S(/\b(?:given|since|because|depends on|if (?:the|we|traffic|latency|scale)|constraint|requirement)\b/i),
  "structuring.upfront": (answer) => {
    const first = sentences(answer).slice(0, 2).join(" ");
    const hit = /\b(?:(?:two|three|four) (?:things|areas|parts|buckets|factors)|break (?:it|this) (?:down|into)|I'?d look at|first,|framework)\b/i.test(first);
    return { level: hit ? 2 : 0, evidence: hit ? sentences(answer)[0] ?? null : null };
  },
  "structuring.distinct_parts": S(/\b(?:revenue|cost|demand|supply|capacity|internal|external|customers?|competit|market)\b[^.]*\b(?:and|versus|vs)\b[^.]*\b(?:revenue|cost|demand|supply|capacity|internal|external|customers?|competit|market)/i),
  "structuring.prioritised": S(/\b(?:I'?d start (?:with|by)|first I'?d|start with|most likely|biggest driver)\b/i),
  "recommendation.first": (answer) => {
    const first = sentences(answer)[0] ?? "";
    const hit = /\b(?:I'?d recommend|I recommend|my recommendation|I would|we should|I'?d (?:go|choose|say))\b/i.test(first);
    return { level: hit ? 2 : sentences(answer).some((s) => /\brecommend|should\b/i.test(s)) ? 1 : 0, evidence: hit ? first : null };
  },
  "recommendation.supported": S(/\b(?:first|second|two reasons|because|the reason)\b/i),
  "recommendation.risk": S(/\b(?:risk|downside|what could go wrong|could fail|test (?:it )?first|pilot|next step)\b/i),
};

/** Deterministic, low-confidence evaluation from text patterns. Used without a model, or when the model fails. */
export function patternEvaluate(i: EvaluateInput, why: string): Evaluation {
  const c = i.competency;
  const criteria: CriterionJudgment[] = c.criteria.map((x) => {
    const d = DETECTORS[`${c.id}.${x.id}`];
    if (!d) return { id: x.id, label: x.label, level: null, evidence: null, interpretation: "Can't be judged by pattern rules." };
    const r = d(i.answer, i.question);
    const evidence = r.evidence && quotedFrom(r.evidence, i.answer) ? r.evidence : null;
    return { id: x.id, label: x.label, level: r.level, evidence, interpretation: r.level === 2 ? "A phrase that usually signals this was found." : r.level === 1 ? "Partly signalled." : "No phrase that usually signals this was found." };
  });
  const target = i.target && criteria.some((x) => x.id === i.target && x.level !== 2) ? i.target : criteria.find((x) => x.level === 0)?.id ?? criteria.find((x) => x.level === 1)?.id ?? null;
  const tc = target ? criterion(c, target)! : null;
  return {
    competencyId: c.id, rubricVersion: c.version, evaluator: "pattern", criteria, enoughEvidence: true, confidence: "low",
    primary: tc ? { criterionId: tc.id, observation: `${tc.failure} That's what this answer looks like on this point, judged by pattern rules.`, whyItMatters: tc.why, instruction: tc.principle } : null,
    secondary: [],
    limitations: `${why} These pattern rules look for phrases that usually signal each criterion; they can miss a well-made point said differently.`,
    insufficientReason: null,
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

export async function evaluate(llm: LanguageModelProvider, i: EvaluateInput, timeoutMs = 12000): Promise<EvaluateResult> {
  const reason = precheck(i.answer, i.inputMode, i.question);
  if (reason) {
    return {
      usage: null,
      evaluation: {
        competencyId: i.competency.id, rubricVersion: i.competency.version, evaluator: "pattern",
        criteria: i.competency.criteria.map((x) => ({ id: x.id, label: x.label, level: null, evidence: null, interpretation: "Not judged." })),
        enoughEvidence: false, confidence: "low", primary: null, secondary: [], limitations: null, insufficientReason: reason,
      },
    };
  }
  if (llm.isMock) return { evaluation: patternEvaluate(i, "No language model is configured."), usage: null };
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await llm.generateJson({ tier: "analysis", system: system(i.competency), prompt: prompt(i), schema: ModelOutput, maxTokens: 1200, timeoutMs });
      const parsed = ModelOutput.safeParse(r.data); // providers validate too; never trust that they did
      if (!parsed.success) throw new Error("malformed evaluation");
      return { evaluation: groundModelOutput(i.competency, i.answer, parsed.data), usage: r.usage };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      // Rate limits and timeouts won't improve on an immediate retry; malformed output might.
      if (/429|rate|quota|timeout|abort/i.test(lastErr)) break;
    }
  }
  return { evaluation: patternEvaluate(i, "The AI assessment wasn't available for this answer."), usage: null, error: lastErr };
}

// ─── Code ───────────────────────────────────────────────────────────────────

export interface EvaluateCodeInput { competency: Competency; question: string; spec: CodeSpec; submission: CodeSubmission; target: string | null }

/**
 * A coding attempt. "correct" and "edge_cases" come only from the test results; the model (or
 * the pattern rules) reads the explanation, and only for "explains". The model never sees the
 * question of whether the code works.
 */
export async function evaluateCode(llm: LanguageModelProvider, i: EvaluateCodeInput): Promise<EvaluateResult> {
  const c = i.competency;
  const s = summarize(i.submission.results);
  const failing = s.failing;
  const lvl = (pass: number, of: number): Level => (of === 0 ? 2 : pass === of ? 2 : pass * 2 >= of ? 1 : 0);
  const describe = (r: CodeResult) => {
    const t = i.spec.tests.find((x) => x.name === r.name)!;
    return `${i.spec.fn}(${t.args.map((a) => JSON.stringify(a)).join(", ")}) returned ${r.got}; expected ${JSON.stringify(t.expected)}`;
  };
  const coreFail = failing.filter((r) => !r.edge), edgeFail = failing.filter((r) => r.edge);
  const label = (id: string) => criterion(c, id)!.label;
  const correct: CriterionJudgment = { id: "correct", label: label("correct"), level: lvl(s.core.pass, s.core.of), evidence: null,
    interpretation: `${s.core.pass} of ${s.core.of} main tests pass when run.${coreFail.length ? ` ${describe(coreFail[0])}.` : ""}` };
  const edges: CriterionJudgment = { id: "edge_cases", label: label("edge_cases"), level: lvl(s.edge.pass, s.edge.of), evidence: null,
    interpretation: `${s.edge.pass} of ${s.edge.of} edge-case tests pass when run.${edgeFail.length ? ` ${describe(edgeFail[0])}.` : ""}` };

  // The explanation, judged on its own rubric of one criterion.
  const only: Competency = { ...c, criteria: c.criteria.filter((x) => x.id === "explains") };
  const ex = i.submission.explanation.trim();
  let explains: CriterionJudgment = { id: "explains", label: label("explains"), level: null, evidence: null, interpretation: "No explanation to judge." };
  let usage: LlmUsage | null = null, error: string | undefined, by: "model" | "pattern" = "pattern", conf: Evaluation["confidence"] = "high";
  if (ex) {
    const r = words(ex).length < MIN_WORDS
      ? { evaluation: patternExplains(only, ex), usage: null }
      : await evaluate(llm, { competency: only, question: i.question, expected: `How it works and what it costs (expected about ${i.spec.complexity})`, answer: ex, inputMode: "text", target: null });
    explains = r.evaluation.criteria[0] ?? explains;
    usage = r.usage; error = (r as EvaluateResult).error; by = r.evaluation.evaluator;
    conf = r.evaluation.confidence;
  }

  const criteria = [correct, edges, explains];
  const pick = coreFail.length ? "correct" : edgeFail.length ? "edge_cases" : explains.level === 2 ? null : "explains";
  const target = i.target && criteria.some((x) => x.id === i.target && x.level !== 2) ? i.target : pick;
  const tc = target ? criterion(c, target)! : null;
  const primary: Weakness | null = tc ? {
    criterionId: tc.id,
    observation: tc.id === "correct" ? `When it ran, ${describe(coreFail[0])}.` : tc.id === "edge_cases" ? `The main cases pass, but on an edge case ${describe(edgeFail[0])}.`
      // Say why the explanation fell short in the assessor's own words, not a stock line that may not fit.
      : !ex ? "There was no explanation of the approach." : explains.interpretation && explains.interpretation !== "No explanation to judge." ? explains.interpretation : "The explanation doesn't clearly say how it works and what it costs.",
    whyItMatters: tc.why, instruction: tc.principle,
  } : null;
  return {
    usage, error,
    evaluation: {
      competencyId: c.id, rubricVersion: c.version, evaluator: by, criteria, enoughEvidence: true,
      // Test results are certain; only the explanation's judgment carries the evaluator's confidence.
      confidence: conf, primary, secondary: [],
      limitations: `Tests ran in your browser; correctness comes only from them, and a fixed set of tests can't prove code correct.${by === "pattern" && ex ? " The explanation was judged by pattern rules." : ""}`,
      insufficientReason: null,
    },
  };
}

/** Pattern rules for a short explanation: does it say how it works and what it costs? */
function patternExplains(c: Competency, ex: string): Evaluation {
  const cost = /\bO\([^)]+\)|\b(?:linear|constant|quadratic|logarithmic|n log n)\b|\b(?:time|space|memory)\b/i.test(ex);
  const how = words(ex).length >= 6;
  const x = c.criteria[0];
  return {
    competencyId: c.id, rubricVersion: c.version, evaluator: "pattern", enoughEvidence: true, confidence: "low", primary: null, secondary: [], limitations: null, insufficientReason: null,
    criteria: [{ id: x.id, label: x.label, level: cost && how ? 2 : cost || how ? 1 : 0, evidence: null, interpretation: cost ? "Mentions the cost." : "Doesn't mention what it costs." }],
  };
}
