"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { BotAvatar } from "@/components/avatar/BotAvatar";
import { BotStill } from "@/components/avatar/BotStill";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label, Segmented, Textarea } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/components/ui/cn";
import { api, ApiError } from "@/lib/client/api";
import { AvatarStore } from "@/lib/avatar/store";
import type { ParsedJobDescription, ParsedResume } from "@/db/schema";
import { DOMAIN_OPTIONS, DOMAIN_PACKS, type DomainId } from "@/lib/interview/domain-packs";
import { PERSONAS } from "@/lib/interview/personas";
import { PALETTE } from "@/lib/palette";
import { InterviewerPicker } from "@/components/app/InterviewerPicker";

type PersonaChoice = "warm_recruiter" | "hiring_manager" | "skeptic" | "executive";
type Profile = {
  name: string; targetRole: string; domain: string; experienceLevel: "early" | "mid" | "senior" | "executive";
  preferredInterviewType: "behavioral" | "technical" | "case" | "leadership" | "mixed";
  preferredPersona: PersonaChoice;
};

const EASE = [0.16, 1, 0.3, 1] as const;
/** Step 0 is the welcome and the last is the hand-off; the numbered steps sit between. */
const STEPS = ["You", "Field", "Resume", "The role", "Interviewer"];
const DONE = STEPS.length + 1;

const INTERVIEWERS: { id: PersonaChoice; line: string }[] = [
  { id: "warm_recruiter", line: "I’ll keep it friendly, and still ask for specifics." },
  { id: "hiring_manager", line: "I’ll want to know what you actually did." },
  { id: "skeptic", line: "I’ll test every claim, and every number." },
  { id: "executive", line: "Few words. Long pauses. The big picture." },
];

export function OnboardingWizard({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [p, setP] = useState<Profile>({ name: defaultName, targetRole: "", domain: "software", experienceLevel: "mid", preferredInterviewType: "behavioral", preferredPersona: "hiring_manager" });
  const [resumeText, setResumeText] = useState("");
  const [resume, setResume] = useState<ParsedResume | null>(null);
  const [jdText, setJdText] = useState("");
  const [jd, setJd] = useState<ParsedJobDescription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const go = (to: number) => { setError(null); setDir(to > step ? 1 : -1); setStep(to); };

  async function uploadResume(file?: File) {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      if (file) form.set("file", file);
      else form.set("text", resumeText);
      const r = await api<{ parsed: ParsedResume }>("/api/resume", { method: "POST", body: form });
      setResume(r.parsed);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitJd() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ parsed: ParsedJobDescription }>("/api/job-description", { method: "POST", json: { text: jdText } });
      setJd(r.parsed);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't read that job description");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      await api("/api/onboarding", { method: "POST", json: p });
      router.prefetch("/practice?first=1");
      go(DONE);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your profile");
      setBusy(false);
    }
  }

  const persona = PERSONAS[p.preferredPersona];
  const first = persona.name.split(" ")[0];
  const greet = useSettled(p.name.trim().split(/\s+/)[0] ?? "", 650);
  const line = [
    `Hi, I’m ${first}. I’ll be your interviewer.`,
    greet ? `Nice to meet you, ${greet}.` : "First, what should I call you?",
    "Where are you headed? I’ll ask what that field asks.",
    resume ? "Got it. I’ll only ask about what’s really there." : "I’ll ask about what you’ve actually done. Nothing invented.",
    jd ? "Now I know what they’ll probe. So will I." : "Paste the job, and I’ll probe what they’ll probe.",
    INTERVIEWERS.find((x) => x.id === p.preferredPersona)!.line,
    `See you in the room${greet ? `, ${greet}` : ""}.`,
  ][step];

  return (
    <div className="relative min-h-dvh lg:grid lg:grid-cols-2">
      <header className="absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Oriel home"><Logo /></Link>
        {step > 0 && step < DONE && <p className="text-meta font-medium text-fg-subtle lg:hidden">{step} of {STEPS.length}</p>}
      </header>

      <Stage personaId={p.preferredPersona} line={line} speaker={`${first} · ${persona.label}`} celebrate={step === DONE} />

      <main className="relative flex flex-col px-5 pb-14 pt-6 sm:px-10 lg:min-h-dvh lg:px-[clamp(2.5rem,6vw,6rem)] lg:pt-20">
        <div className={cn("mx-auto w-full max-w-[540px] transition-opacity duration-500", step === 0 || step === DONE ? "pointer-events-none h-0 opacity-0 lg:h-auto" : "opacity-100")}>
          <Progress step={step} />
        </div>
        <div className="mx-auto flex w-full max-w-[540px] flex-1 flex-col lg:justify-center lg:py-8">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div key={step} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={{ duration: 0.32, ease: EASE }}>
              <Leaving>
              {step === 0 && (
                <StepShell title={<>Let’s get you ready <br className="hidden sm:block" />for the room.</>} lead="Five short steps, about two minutes, and your first interview is set. Your resume and the job description are optional, but they make the questions yours." autoFocus={false}>
                  <ol className="mt-9 border-t border-line">
                    {[["About you", "Your name, the role you want"], ["Your field", "Sets what gets probed"], ["Your resume", "Optional"], ["The role", "Optional"], ["Your interviewer", "Who sits across from you"]].map(([t, d], i) => (
                      <li key={t} className="flex items-baseline gap-4 border-b border-line py-3">
                        <span className="w-5 shrink-0 font-display text-body-l leading-none text-accent">{i + 1}</span>
                        <span className="flex-1 text-ui font-medium text-fg">{t}</span>
                        <span className="text-meta text-fg-subtle">{d}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
                    <Button size="lg" onClick={() => go(1)}>Let’s begin</Button>
                    <p className="text-meta text-fg-subtle">Your interviewer is an AI. What you share stays private.</p>
                  </div>
                </StepShell>
              )}

              {step === 1 && <StepYou p={p} set={set} onBack={() => go(0)} onNext={() => go(2)} />}

              {step === 2 && (
                <StepShell title="Where are you headed?" lead="Your field sets what the interviewer probes. Your level sets how deep it goes.">
                  <div className="mt-8">
                    <Label>Field</Label>
                    <Segmented name="Field" value={p.domain} onChange={(v) => set("domain", v)} className="grid-cols-2 [&>button]:py-3"
                      options={DOMAIN_OPTIONS.map((d) => ({ value: d.id, label: d.label, hint: DOMAIN_PACKS[d.id as DomainId].competencies.slice(-3).map((c) => c.label).join(" · ") }))} />
                  </div>
                  <div className="mt-8">
                    <Label>Experience</Label>
                    <Segmented name="Experience" value={p.experienceLevel} onChange={(v) => set("experienceLevel", v)} options={[
                      { value: "early", label: "Early career" }, { value: "mid", label: "Mid-level" }, { value: "senior", label: "Senior" }, { value: "executive", label: "Executive" },
                    ]} />
                  </div>
                  <Nav onBack={() => go(1)} onNext={() => go(3)} />
                </StepShell>
              )}

              {step === 3 && (
                <StepShell title="Your resume." lead="The interviewer uses it to ask about your real experience. We only extract what’s written; nothing is invented.">
                  {!resume ? (
                    <>
                      <DropZone busy={busy} onFile={(f) => void uploadResume(f)} />
                      <div className="my-5 flex items-center gap-4 text-meta text-fg-subtle"><span className="h-px flex-1 bg-line" />or paste it<span className="h-px flex-1 bg-line" /></div>
                      <Textarea aria-label="Resume text" value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={6} placeholder="Paste your resume text" />
                      <FieldError>{error}</FieldError>
                      <Nav onBack={() => go(2)} onNext={() => uploadResume()} nextLabel="Read resume" nextDisabled={resumeText.trim().length < 40} busy={busy} onSkip={() => go(4)} />
                    </>
                  ) : (
                    <>
                      <ResumeSummary r={resume} />
                      <Nav onBack={() => setResume(null)} backLabel="Replace" onNext={() => go(4)} />
                    </>
                  )}
                </StepShell>
              )}

              {step === 4 && (
                <StepShell title="The job you’re going for." lead="Paste the job description. We pull out the competencies the interviewer should probe.">
                  {!jd ? (
                    <>
                      <Textarea aria-label="Job description" className="mt-8" value={jdText} onChange={(e) => setJdText(e.target.value)} rows={10} placeholder="Paste the job description" />
                      <FieldError>{error}</FieldError>
                      <Nav onBack={() => go(3)} onNext={submitJd} nextLabel="Read job description" nextDisabled={jdText.trim().length < 40} busy={busy} onSkip={() => go(5)} />
                    </>
                  ) : (
                    <>
                      <Parsed title={jd.title ?? "Job description"} ai={jd.source === "llm"}>
                        <p className="text-ui font-medium text-fg">What they&apos;ll probe</p>
                        <ul className="mt-3 space-y-2.5">
                          {jd.competencies.map((c, i) => (
                            <motion.li key={c.key} className="text-ui" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.07, duration: 0.5, ease: EASE }}>
                              <span className="font-medium text-fg">{c.label}</span> <span className="text-fg-subtle">“{c.evidence}”</span>
                            </motion.li>
                          ))}
                        </ul>
                        {!jd.competencies.length && <p className="mt-2 text-ui text-fg-subtle">No clear competencies found. The interviewer will use the standard set for your field.</p>}
                      </Parsed>
                      <Nav onBack={() => setJd(null)} backLabel="Replace" onNext={() => go(5)} />
                    </>
                  )}
                </StepShell>
              )}

              {step === 5 && (
                <StepShell title="Who sits across from you?" lead="Pick an interviewer and the kind of interview. You can change both before any session.">
                  <div className="mt-8">
                    <Label>Interviewer</Label>
                    <InterviewerPicker value={p.preferredPersona} onChange={(id) => set("preferredPersona", id)} />
                  </div>
                  <div className="mt-8">
                    <Label>Interview type</Label>
                    <Segmented name="Interview type" value={p.preferredInterviewType} onChange={(v) => set("preferredInterviewType", v)} options={[
                      { value: "behavioral", label: "Behavioral" }, { value: "technical", label: "Technical" }, { value: "case", label: "Case" }, { value: "leadership", label: "Leadership" }, { value: "mixed", label: "Mixed" },
                    ]} />
                  </div>
                  <FieldError>{error}</FieldError>
                  <Nav onBack={() => go(4)} onNext={finish} nextLabel="Set up my first interview" busy={busy} />
                </StepShell>
              )}

              {step === DONE && <Done name={greet} who={first} onDone={() => { router.push("/practice?first=1"); router.refresh(); }} />}
              </Leaving>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// Steps slide a short way in the direction of travel and fade: transform and opacity only.
const slide = {
  enter: (d: number) => ({ opacity: 0, x: d * 24 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d * -24 }),
};

/** A step on its way out can't be clicked or tabbed into while it fades. */
function Leaving({ children }: { children: React.ReactNode }) {
  const present = useIsPresent();
  return <div inert={!present}>{children}</div>;
}

/** The value once it has stopped changing for a moment — so the interviewer doesn't greet every keystroke. */
function useSettled(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** The interviewer, saying one line per step, set like a line of transcript. */
function Stage({ personaId, line, speaker, celebrate }: { personaId: PersonaChoice; line: string; speaker: string; celebrate: boolean }) {
  const reduce = useReducedMotion();
  const store = useMemo(() => {
    const s = new AvatarStore();
    s.setMode("listening");
    s.configure({ pressure: 2, stillness: 0.3 });
    return s;
  }, []);
  const persona = PERSONAS[personaId];
  const seats = useMemo(() => [{ seat: 0, personaId, name: persona.name, accent: PALETTE.accent, expressiveness: persona.expressiveness, warmth: persona.warmth, skepticism: persona.skepticism }], [personaId, persona]);
  useEffect(() => {
    const t0 = performance.now();
    store.setLevel(() => (store.mode === "speaking" ? Math.max(0, Math.sin((performance.now() - t0) / 95) * 0.45 + Math.sin((performance.now() - t0) / 41) * 0.25) : 0));
  }, [store]);
  useEffect(() => {
    store.setMode("speaking");
    const id = setTimeout(() => store.setMode("listening"), Math.min(2600, 450 + line.length * 36));
    return () => clearTimeout(id);
  }, [line, store]);
  useEffect(() => {
    if (celebrate) store.fireCue("nod");
  }, [celebrate, store]);

  return (
    <aside aria-hidden className="relative border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r">
      <div className="flex items-end gap-4 px-5 pb-5 pt-[4.5rem] sm:px-8 lg:h-full lg:flex-col lg:items-stretch lg:justify-center lg:gap-0 lg:px-[clamp(2.5rem,5vw,5rem)] lg:py-0">
        <motion.div className="relative size-[104px] shrink-0 sm:size-[132px] lg:mx-auto lg:size-[min(100%,46vh)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: EASE }}>
          <BotAvatar store={store} seats={seats} compact className="absolute inset-0" />
        </motion.div>
        <div className="min-w-0 flex-1 pb-1 lg:mt-10 lg:flex-none lg:border-t lg:border-line lg:pt-6">
          <p className="text-meta font-medium text-fg-muted">{speaker} <span className="ml-1 font-normal text-fg-subtle">AI</span></p>
          <div className="mt-2 min-h-[2.7em]">
            <AnimatePresence mode="wait">
              <motion.p key={line} className="text-display-m text-fg"
                initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                {/* Spoken word by word, unless motion is reduced: then the line simply appears. */}
                {reduce ? line : line.split(" ").map((w, i) => (
                  <motion.span key={i} className="inline-block pr-[0.24em]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 + i * 0.06, duration: 0.25 }}>{w}</motion.span>
                ))}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Progress({ step }: { step: number }) {
  const current = Math.min(Math.max(step, 1), STEPS.length);
  return (
    <div className="mb-8 lg:mb-0">
      <div className="flex gap-1.5" role="progressbar" aria-label="Onboarding progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={current} aria-valuetext={`Step ${current} of ${STEPS.length}: ${STEPS[current - 1]}`}>
        {STEPS.map((s, i) => (
          <div key={s} className="h-0.5 flex-1 overflow-hidden bg-line-strong">
            <motion.div className="h-full origin-left bg-accent" initial={false} animate={{ scaleX: i < current ? 1 : 0 }} transition={{ duration: 0.5, ease: EASE }} />
          </div>
        ))}
      </div>
      <p className="mt-3 hidden justify-between text-meta lg:flex">
        <span className="font-medium text-fg">{STEPS[current - 1]}</span>
        <span className="text-fg-subtle">Step {current} of {STEPS.length}</span>
      </p>
    </div>
  );
}

function StepShell({ title, lead, children, autoFocus = true }: { title: React.ReactNode; lead?: string; children: React.ReactNode; autoFocus?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <section>
      <h1 ref={ref} tabIndex={-1} className="text-display-l text-fg outline-none">{title}</h1>
      {lead && <p className="mt-4 text-body-l text-fg-muted">{lead}</p>}
      {children}
    </section>
  );
}

function StepYou({ p, set, onBack, onNext }: { p: Profile; set: <K extends keyof Profile>(k: K, v: Profile[K]) => void; onBack: () => void; onNext: () => void }) {
  const [tried, setTried] = useState(false);
  const nameErr = !p.name.trim() ? "Tell us what to call you." : null;
  const roleErr = p.targetRole.trim().length < 2 ? "Add the role you’re interviewing for." : null;
  const nameRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  return (
    <StepShell title="Who’s walking into the room?" lead="Only what the first interview needs. You can change all of it later.">
      <form noValidate className="mt-8 space-y-5" onSubmit={(e) => {
        e.preventDefault();
        if (nameErr || roleErr) { setTried(true); (nameErr ? nameRef : roleRef).current?.focus(); return; }
        onNext();
      }}>
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input ref={nameRef} id="name" value={p.name} onChange={(e) => set("name", e.target.value)} placeholder="How the interviewer should greet you" autoComplete="given-name" aria-invalid={tried && !!nameErr} aria-describedby={tried && nameErr ? "name-err" : undefined} />
          {tried && <FieldError id="name-err">{nameErr}</FieldError>}
        </div>
        <div>
          <Label htmlFor="role">Target role</Label>
          <Input ref={roleRef} id="role" value={p.targetRole} onChange={(e) => set("targetRole", e.target.value)} placeholder="e.g. Senior Product Manager" autoComplete="organization-title" aria-invalid={tried && !!roleErr} aria-describedby={tried && roleErr ? "role-err" : undefined} />
          {tried && <FieldError id="role-err">{roleErr}</FieldError>}
        </div>
        <Nav onBack={onBack} submit />
      </form>
    </StepShell>
  );
}

function DropZone({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className={cn("mt-8 flex w-full flex-col items-center justify-center rounded-panel border border-dashed px-6 py-9 text-center transition-[border-color,background-color] duration-press",
          over ? "border-accent bg-accent-tint" : "border-control hover:border-fg-subtle hover:bg-surface")}>
        {busy ? (
          <span className="flex w-full max-w-[260px] flex-col items-center gap-2.5">
            <span className="text-ui font-medium text-fg">Reading your resume…</span>
            <span className="skeleton h-2 w-full" /><span className="skeleton h-2 w-4/5" /><span className="skeleton h-2 w-3/5" />
          </span>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="size-7 text-fg-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" /><path d="M14 3.5V8h4.5M12 17.5v-6M9.5 14 12 11.5l2.5 2.5" />
            </svg>
            <span className="mt-3 text-ui font-medium text-fg">{over ? "Drop to upload" : "Upload PDF or DOCX"}</span>
            <span className="mt-1 text-meta text-fg-subtle">Drag it here, or choose a file · up to 8 MB</span>
          </>
        )}
      </button>
      <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </>
  );
}

function Parsed({ title, ai, children }: { title: string; ai: boolean; children: React.ReactNode }) {
  return (
    <motion.div className="mt-8 border-t border-line pt-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE }}>
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <p className="text-display-m text-fg">{title}</p>
        <p className="text-meta text-fg-subtle">{ai ? "Read by the AI" : "Read by pattern matching"}</p>
      </div>
      {children}
    </motion.div>
  );
}

function ResumeSummary({ r }: { r: ParsedResume }) {
  return (
    <Parsed title={r.headline ?? "Your resume"} ai={r.source === "llm"}>
      <p className="text-ui font-medium text-fg">Roles found</p>
      <ul className="mt-3 space-y-3.5">
        {r.roles.slice(0, 5).map((ro, i) => (
          <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.07, duration: 0.5, ease: EASE }}>
            <p className="text-ui text-fg">{ro.title}{ro.organization ? <span className="text-fg-subtle"> · {ro.organization}</span> : null}<span className="ml-2 text-meta text-fg-subtle">{[ro.start, ro.end].filter(Boolean).join("–")}</span></p>
            {ro.highlights[0] && <p className="mt-0.5 text-meta text-fg-subtle">{ro.highlights[0]}</p>}
          </motion.li>
        ))}
        {!r.roles.length && <li className="text-ui text-fg-subtle">We couldn&apos;t confidently identify roles. The interviewer won&apos;t reference specific jobs.</li>}
      </ul>
      {r.metrics.length > 0 && (
        <>
          <p className="mt-6 text-ui font-medium text-fg">Numbers you&apos;ve claimed</p>
          <ul className="mt-2 space-y-1">{r.metrics.slice(0, 4).map((m, i) => <li key={i} className="text-meta text-fg-muted">“{m}”</li>)}</ul>
        </>
      )}
    </Parsed>
  );
}

function Nav({ onBack, onNext, onSkip, nextLabel = "Continue", backLabel = "Back", nextDisabled, busy, submit }: { onBack?: () => void; onNext?: () => void; onSkip?: () => void; nextLabel?: string; backLabel?: string; nextDisabled?: boolean; busy?: boolean; submit?: boolean }) {
  return (
    <div className="mt-9 flex flex-wrap items-center gap-x-2 gap-y-3">
      {onBack && <Button variant="ghost" onClick={onBack} className="-ml-4 px-4 max-sm:px-3">{backLabel}</Button>}
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {onSkip && <Button variant="ghost" onClick={onSkip} className="max-sm:px-3">Skip for now</Button>}
        <Button type={submit ? "submit" : "button"} variant="primary" onClick={submit ? undefined : onNext} disabled={nextDisabled} loading={busy}>{nextLabel}</Button>
      </div>
    </div>
  );
}

function Done({ name, who, onDone }: { name: string; who: string; onDone: () => void }) {
  const done = useRef(onDone);
  useEffect(() => {
    const id = setTimeout(() => done.current(), 1500);
    return () => clearTimeout(id);
  }, []);
  return (
    <section className="py-10 text-center lg:text-left" aria-live="polite">
      <motion.svg viewBox="0 0 40 40" className="mx-auto size-10 lg:mx-0" aria-hidden>
        <motion.path d="m9 20.5 7 7L31.5 12" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: EASE, delay: 0.15 }} />
      </motion.svg>
      <h1 className="mt-6 text-display-l text-fg">You’re all set{name ? `, ${name}` : ""}.</h1>
      <p className="mt-4 text-body-l text-fg-muted">{who} is ready for your first interview. Taking you there.</p>
      <div className="mx-auto mt-8 h-0.5 w-40 overflow-hidden bg-line-strong lg:mx-0">
        <motion.div className="h-full origin-left bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.4, ease: "easeInOut" }} />
      </div>
    </section>
  );
}
