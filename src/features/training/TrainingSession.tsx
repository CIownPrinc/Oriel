"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Field";
import { Thinking } from "@/components/ui/Logo";
import { cn } from "@/components/ui/cn";
import { InterviewerStage } from "@/components/avatar/InterviewerStage";
import { TrainingVoice } from "./voice";
import { CodeAnswer } from "./CodeAnswer";
import { asResponse, type CodeSubmission } from "@/lib/training/code";
import { api, ApiError } from "@/lib/client/api";
import type { LoopView, AttemptView } from "@/server/training/service";
import type { CriterionLevel, Evaluation, Outcome } from "@/lib/training/engine";
import { CATEGORIES } from "@/lib/training/competencies";

/*
 * One practice loop, one question at a time. While you answer, nothing is shown but the
 * interviewer and the question: no rubric, no hints, no skill name. After each answer, one
 * note; the retry asks you to apply a principle, never to copy an answer; the transfer arrives
 * as the next question, unannounced. The skill is named only at the end.
 */

const LEVEL_WORD = (l: CriterionLevel) => (l === 2 ? "clearly shown" : l === 1 ? "partly shown" : l === 0 ? "not shown" : "couldn't tell");
const OUTCOME_WORD: Record<"same" | "new" | "later", Record<Outcome, string>> = {
  same: { yes: "Improved when you tried again", no: "Didn't improve on the retry", not_assessed: "Not assessed" },
  new: { yes: "Carried over to a question you hadn't seen", no: "Didn't carry over yet", not_assessed: "Not assessed" },
  later: { yes: "Held after the delay", no: "Didn't hold after the delay", not_assessed: "Not assessed" },
};
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function TrainingSession({ initial }: { initial: LoopView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"text" | "voice">("text");
  // Voice: the interviewer reading the question, and answering out loud.
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState<"off" | "on" | "transcribing">("off");
  const [canRecord, setCanRecord] = useState(false);
  const started = useRef<number | null>(null);
  const submission = useRef(key());
  const box = useRef<HTMLTextAreaElement>(null);
  /** What was typed before recording started; the transcript is added after it. */
  const typedBefore = useRef("");
  const [voice] = useState(() => new TrainingVoice(initial.id));

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setCanRecord(TrainingVoice.canRecord());
      try { setVoiceOn(localStorage.getItem("oriel.train.voice") !== "off"); } catch { /* private mode */ }
    });
    return () => { cancelAnimationFrame(id); voice.dispose(); };
  }, [voice]);

  async function hear(text = view.question.text) {
    setSpeaking(true);
    await voice.speakQuestion(text);
    setSpeaking(false);
  }

  function setVoicePref(on: boolean) {
    setVoiceOn(on);
    try { localStorage.setItem("oriel.train.voice", on ? "on" : "off"); } catch { /* private mode */ }
    if (!on) { voice.stopSpeaking(); setSpeaking(false); }
  }

  async function toggleRecording() {
    if (recording === "on") {
      setRecording("transcribing");
      const r = await voice.finishAnswer();
      setRecording("off");
      if (r.text) {
        setAnswer(typedBefore.current ? `${typedBefore.current} ${r.text}` : r.text);
        setMode("voice");
      } else {
        setAnswer(typedBefore.current);
        setError("We didn't catch that. Try again, or type your answer.");
      }
      requestAnimationFrame(() => box.current?.focus());
      return;
    }
    setError(null);
    setSpeaking(false);
    const base = answer.trim();
    typedBefore.current = base;
    try {
      await voice.startAnswer((t) => setAnswer(base ? `${base} ${t}` : t));
      started.current ??= performance.now();
      setRecording("on");
    } catch {
      setError("The microphone isn't available. Allow it in your browser's address bar, or type your answer.");
    }
  }

  async function submit() {
    if (!answer.trim() || busy || recording !== "off") return;
    voice.stopSpeaking();
    setBusy(true);
    setError(null);
    try {
      const next = await api<LoopView>(`/api/training/${view.id}/attempts`, {
        method: "POST",
        json: { response: answer.trim(), inputMode: mode, durationMs: started.current ? performance.now() - started.current : 0, clientKey: submission.current },
      });
      setView(next);
      setAnswer("");
      setMode("text");
      started.current = null;
      submission.current = key();
      requestAnimationFrame(() => box.current?.focus());
      // The submit was a click, so sound is allowed: a new question is read out.
      if (voiceOn && next.stage !== "done" && next.question.text !== view.question.text) void hear(next.question.text);
    } catch (e) {
      // The same key is reused on a retry of this submission, so it can't be counted twice.
      setError(e instanceof ApiError ? e.message : "Something went wrong. Your answer is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(code: CodeSubmission) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<LoopView>(`/api/training/${view.id}/attempts`, {
        method: "POST",
        json: { response: asResponse(code.source, code.explanation), inputMode: "text", durationMs: started.current ? performance.now() - started.current : 0, clientKey: submission.current, code },
      });
      setView(next);
      started.current = null;
      submission.current = key();
      if (voiceOn && next.stage !== "done" && next.question.text !== view.question.text) void hear(next.question.text);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Your code is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  const last = view.attempts.at(-1) ?? null;
  const category = CATEGORIES.find((c) => c.id === view.category)?.label ?? view.category;
  const done = view.stage === "done";

  return (
    <div className="mx-auto max-w-column">
      <Link href="/train" className="-ml-1 inline-flex h-9 items-center rounded-control px-1 text-ui text-fg-muted transition-colors duration-press hover:text-fg">← Training</Link>
      <p className="mt-4 text-ui text-fg-subtle">{view.kind === "review" ? "Review" : "Practice"} · {category}</p>

      {done ? <Summary view={view} /> : (
        <>
          {/* The note on your last answer, before the next attempt. Never on the first question. */}
          {last?.evaluation && <Note view={view} attempt={last} />}

          <section aria-labelledby="question" className="mt-10">
            <p className="text-meta text-fg-subtle" aria-live="polite">{transitionLine(view, last)}</p>
            <div className="mt-3 flex items-start gap-4 sm:gap-6">
              <InterviewerStage personaIds={["hiring_manager"]} store={voice.store} still="/interviewer/hiring_manager.webp" className="aspect-square w-20 shrink-0 sm:w-28" />
              <div className="pt-2">
                <h1 id="question" key={view.question.text} className="text-display-m text-fg motion-safe:animate-enter">{view.question.text}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button type="button" onClick={() => { if (speaking) { voice.stopSpeaking(); setSpeaking(false); } else void hear(); }} className="text-ui text-fg-muted underline decoration-1 underline-offset-text transition-colors duration-press hover:text-fg">
                    {speaking ? "Stop" : "Hear the question"}
                  </button>
                  <label className="flex items-center gap-2 text-meta text-fg-subtle">
                    <input type="checkbox" checked={voiceOn} onChange={(e) => setVoicePref(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                    Read new questions aloud
                  </label>
                </div>
              </div>
            </div>
            {view.scaffold && (
              <p className="mt-5 border-t border-line pt-4 text-ui text-fg-muted"><span className="font-medium text-fg">To help: </span>{view.scaffold}</p>
            )}
          </section>

          {view.question.code ? (
            <>
              <CodeAnswer key={view.question.text} spec={view.question.code} busy={busy} onSubmit={(c) => { started.current ??= performance.now(); void submitCode(c); }} />
              {busy && <Thinking label="Running the tests and reading your approach" className="mt-5" />}
              {error && <FieldError>{error}</FieldError>}
            </>
          ) : (
          <form className="mt-8" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <label htmlFor="answer" className="sr-only">Your answer</label>
            <textarea id="answer" ref={box} value={answer} disabled={busy} autoFocus
              onChange={(e) => { started.current ??= performance.now(); setAnswer(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
              readOnly={recording !== "off"}
              placeholder={recording === "on" ? "Listening… your words appear here." : "Answer out loud, or type, as you would in the room."}
              className="min-h-44 w-full resize-y rounded-control border border-control bg-surface px-4 py-3.5 text-body leading-relaxed text-fg placeholder:text-fg-subtle transition-colors duration-press hover:border-fg-subtle disabled:opacity-60" />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {canRecord && (
                <Button type="button" variant={recording === "on" ? "primary" : "secondary"} size="lg" onClick={toggleRecording} disabled={busy || recording === "transcribing"} loading={recording === "transcribing"} aria-pressed={recording === "on"}>
                  {recording === "on" ? <><span className="size-1.5 rounded-full bg-danger" aria-hidden />I&rsquo;m done speaking</> : recording === "transcribing" ? "Transcribing" : "Answer out loud"}
                </Button>
              )}
              <Button type="submit" size="lg" variant={canRecord && !answer.trim() ? "secondary" : "primary"} loading={busy} disabled={!answer.trim() || recording !== "off"}>Submit answer</Button>
              <span className="hidden text-meta text-fg-subtle pointer-fine:inline">⌘ Enter submits</span>
            </div>
            {mode === "voice" && recording === "off" && answer && !busy && <p className="mt-3 text-meta text-fg-subtle">Your spoken answer, transcribed. Check it reads as you meant, then submit.</p>}
            {busy && <Thinking label="Reading your answer" className="mt-5" />}
            {error && <FieldError>{error}</FieldError>}
          </form>
          )}
        </>
      )}

      {view.attempts.length > 0 && (
        <details className="mt-16 border-t border-line pt-4">
          <summary className="cursor-pointer text-ui text-fg-muted hover:text-fg">Your answers so far ({view.attempts.length})</summary>
          <ol className="mt-4 space-y-6">
            {view.attempts.map((a) => (
              <li key={a.id}>
                <p className="text-meta text-fg-subtle">{STAGE_WORD[a.stage]}{a.questionSource === "generated" ? " · a generated question" : ""}</p>
                <p className="mt-1 font-display text-body-l text-fg-muted">{a.question}</p>
                <p className="mt-2 whitespace-pre-line text-body text-fg">{a.response}</p>
              </li>
            ))}
          </ol>
          <DeleteLoop id={view.id} onDone={() => router.push("/train")} />
        </details>
      )}
    </div>
  );
}

const STAGE_WORD = { initial: "First answer", retry: "Retry", transfer: "New question", review: "Review" } as const;

function transitionLine(view: LoopView, last: AttemptView | null): string {
  if (!last) return view.kind === "review" ? "A question to answer cold, as before." : "Answer as you would in the room. Feedback comes after.";
  if (view.step?.kind === "reassess" || (last.evaluation && !last.evaluation.enoughEvidence)) return "Same question. Give it a full answer.";
  if (view.stage === "retry") return "Same question. Answer it again, your way.";
  if (view.stage === "transfer") return "Next question.";
  return "";
}

/** One note on the last answer: what was seen, the words it was seen in, why it matters, what to do next. */
function Note({ view, attempt }: { view: LoopView; attempt: AttemptView }) {
  const e = attempt.evaluation!;
  if (!e.enoughEvidence) {
    return (
      <section aria-label="About your last answer" className="mt-8 border-t border-line pt-6">
        <p className="text-body-l text-fg">{e.insufficientReason ?? "There wasn't enough in that answer to judge."}</p>
        <p className="mt-2 text-ui text-fg-muted">That isn&rsquo;t counted against you.</p>
      </section>
    );
  }
  // After a retry, the comparison on the targeted point comes first, fairly in both directions.
  const prev = view.attempts.filter((a) => a.stage === "initial" && a.evaluation?.enoughEvidence).at(-1)?.evaluation;
  const targetId = view.target?.id ?? e.primary?.criterionId ?? null;
  const level = (ev: Evaluation | null | undefined) => (ev && targetId ? ev.criteria.find((c) => c.id === targetId)?.level ?? null : null);
  const showComparison = attempt.stage === "retry" && prev && targetId;
  const p = e.primary;
  const quote = p ? e.criteria.find((c) => c.id === p.criterionId)?.evidence : null;
  return (
    <section aria-label="About your last answer" className="mt-8 border-t border-line pt-6">
      {showComparison && (
        <p className="mb-5 text-ui text-fg-muted">
          <span className="text-fg">{view.target?.label ?? "The point you worked on"}:</span> {LEVEL_WORD(level(prev))} before, {LEVEL_WORD(level(e))} now.
          {view.stage === "transfer" && level(e) !== 2 && " Moving on to a new question rather than repeating this one."}
        </p>
      )}
      {p && view.stage === "retry" ? (
        <>
          <p className="text-body-l text-fg">{p.observation}</p>
          {quote && (
            <figure className="mt-4">
              <blockquote className="hang-sans text-body text-fg-muted">“{quote}”</blockquote>
              <figcaption className="mt-1 text-meta text-fg-subtle">From your answer</figcaption>
            </figure>
          )}
          <p className="mt-4 text-ui text-fg-muted">{p.whyItMatters}</p>
          <p className="mt-4 text-body text-fg"><span className="font-medium">Next attempt: </span>{p.instruction}</p>
        </>
      ) : !showComparison && (
        <p className="text-body-l text-fg">{view.stage === "transfer" ? "That answer covered the ground. Here\u2019s a different one." : ""}</p>
      )}
      {e.secondary.length > 0 && view.stage === "retry" && (
        <details className="mt-4">
          <summary className="cursor-pointer text-meta text-fg-muted hover:text-fg">More notes</summary>
          <ul className="mt-2 space-y-1.5 text-ui text-fg-muted">{e.secondary.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      )}
      <Assessor e={e} />
    </section>
  );
}

function Assessor({ e }: { e: Evaluation }) {
  return (
    <p className="mt-4 text-meta text-fg-subtle">
      {e.competencyId === "implementation"
        ? `Pass or fail comes only from running the tests. The explanation was ${e.evaluator === "model" ? `assessed by the AI, ${e.confidence} confidence` : "checked by pattern rules"}.`
        : e.evaluator === "model" ? `Assessed by the AI against a fixed rubric, ${e.confidence} confidence.` : "Assessed by pattern rules, not the AI; treat it as approximate."}
      {e.limitations ? ` ${e.limitations}` : ""}
    </p>
  );
}

/** The end of a loop: the three outcomes kept apart, what carried over, and when it comes back. */
function Summary({ view }: { view: LoopView }) {
  const o = view.outcome;
  const transfer = view.attempts.filter((a) => a.stage === "transfer" || a.stage === "review").at(-1)?.evaluation;
  const rows: [string, string][] = view.kind === "review"
    ? [["After a delay", OUTCOME_WORD.later[o?.retained ?? "not_assessed"]]]
    : [["On the same question", OUTCOME_WORD.same[o?.improvedOnRetry ?? "not_assessed"]], ["On a new question", OUTCOME_WORD.new[o?.transferred ?? "not_assessed"]]];
  return (
    <section aria-labelledby="summary-title" className="mt-6">
      <h1 id="summary-title" className="text-display-l text-fg">{view.competency.label}</h1>
      <p className="mt-4 text-body-l text-fg-muted">{view.competency.summary}{view.target ? ` This time: ${view.target.label.toLowerCase()}.` : ""}</p>
      <dl className="mt-10 border-t border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 border-b border-line py-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <dt className="text-ui text-fg-muted">{k}</dt>
            <dd className="text-body text-fg">{v}</dd>
          </div>
        ))}
        <div className="grid gap-1 border-b border-line py-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <dt className="text-ui text-fg-muted">{view.kind === "review" ? "Next look" : "After a delay"}</dt>
          <dd className="text-body text-fg">{view.nextReview ? `A review on ${fmtDate(view.nextReview)}, with a different question` : "Nothing scheduled: there wasn't enough to assess"}</dd>
        </div>
      </dl>
      {transfer?.enoughEvidence && (
        <div className="mt-10">
          <h2 className="text-ui font-medium text-fg">{view.kind === "review" ? "On the review question" : "On the new question"}</h2>
          <ul className="mt-3 space-y-3">
            {transfer.criteria.map((c) => (
              <li key={c.id} className="grid gap-1 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <span className={cn("text-ui", c.level === 2 ? "text-fg" : "text-fg-muted")}>{c.label}</span>
                <span className="text-ui text-fg-muted">{LEVEL_WORD(c.level)}{c.evidence ? `: “${c.evidence}”` : ""}</span>
              </li>
            ))}
          </ul>
          <Assessor e={transfer} />
        </div>
      )}
      <p className="mt-10 text-meta text-fg-subtle">These are observations about answers, not a grade of you or a prediction of any interview.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/train" size="lg">Back to training</ButtonLink>
      </div>
    </section>
  );
}

function DeleteLoop({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="danger" size="sm" className="mt-6" loading={busy} onClick={async () => {
      if (!window.confirm("Delete this practice, its answers and its scheduled review? This can't be undone.")) return;
      setBusy(true);
      await api(`/api/training/${id}`, { method: "DELETE" }).catch(() => null);
      onDone();
    }}>Delete this practice</Button>
  );
}
