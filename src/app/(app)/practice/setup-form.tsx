"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, LinkButton } from "@/components/ui/Button";
import { FieldError, Input, Segmented, Toggle } from "@/components/ui/Field";
import { api, ApiError } from "@/lib/client/api";
import { PRESSURE_DESCRIPTIONS, PRESSURE_LABELS, type PressureLevel } from "@/lib/interview/pressure";
import { ROLE_TO_DOMAIN } from "@/lib/interview/domain-packs";
import { PANEL_ROLE_LABEL, PANEL_ROLE_PERSONA, PERSONAS, SOLO_INTERVIEWERS, panelRolesForSize, type PersonaId, type SoloInterviewer } from "@/lib/interview/personas";
import { InterviewerPicker } from "@/components/app/InterviewerPicker";
import { AvatarStudio, type SavedStyles } from "@/components/avatar/AvatarStudio";
import { BotStill } from "@/components/avatar/BotStill";
import { InterviewerStage } from "@/components/avatar/InterviewerStage";
import { cn } from "@/components/ui/cn";
import { Title } from "@/components/ui/PageHeader";

/** Where in the hiring process this round sits. Named for the stage, not a person, so it never reads like an interviewer. */
const STAGES: { value: "recruiter" | "hiring_manager" | "senior_manager" | "executive"; label: string }[] = [
  { value: "recruiter", label: "Screen" }, { value: "hiring_manager", label: "Hiring manager round" }, { value: "senior_manager", label: "Final round" }, { value: "executive", label: "Executive" },
];

const TYPE_LABELS: Record<string, string> = { behavioral: "Behavioral", technical: "Technical", case: "Case", leadership: "Leadership", mixed: "Mixed" };

const ROLES = ["Software Engineer", "Product Manager", "Consultant", "Finance", "Research", "Clinical", "Executive", "Custom"] as const;

type Props = {
  profile: { targetRole: string; domain: string; type: string; persona: string; experience: string; cameraMetrics: boolean };
  resume: { name: string; roles: number } | null;
  jd: { title: string; competencies: string[] } | null;
  ladder: { level: number; name: string; description: string; unlocked: boolean; mode: string; pressure: number; personaIds: string[] }[];
  currentLadder: number;
  initialLadder: number | null;
  firstRun: boolean;
  limits: { plan: string; canStart: string | null; panel: boolean; maxPanel: number; ladder: boolean; maxMinutes: number };
  styles: SavedStyles;
};

export function SetupForm(p: Props) {
  const router = useRouter();
  const matchedRole = ROLES.find((r) => ROLE_TO_DOMAIN[r] === p.profile.domain) ?? "Custom";
  const [roleChoice, setRoleChoice] = useState<(typeof ROLES)[number]>(matchedRole);
  const [customRole, setCustomRole] = useState(p.profile.targetRole);
  const [level, setLevel] = useState<"recruiter" | "hiring_manager" | "senior_manager" | "executive">(p.profile.experience === "executive" ? "executive" : p.profile.experience === "senior" ? "senior_manager" : "hiring_manager");
  const [type, setType] = useState(p.profile.type as "behavioral" | "technical" | "case" | "leadership" | "mixed");
  const [persona, setPersona] = useState<SoloInterviewer>((SOLO_INTERVIEWERS as readonly string[]).includes(p.profile.persona) ? (p.profile.persona as SoloInterviewer) : "hiring_manager");
  const [pressure, setPressure] = useState<PressureLevel>(p.firstRun ? 2 : 3);
  const [mode, setMode] = useState<"single" | "panel">("single");
  const [panelSize, setPanelSize] = useState(3);
  const [minutes, setMinutes] = useState(Math.min(15, p.limits.maxMinutes));
  const [cameraMetrics, setCameraMetrics] = useState(p.profile.cameraMetrics);
  const [ladderLevel, setLadderLevel] = useState<number | null>(p.initialLadder);
  const [more, setMore] = useState(p.initialLadder !== null);
  const [styles, setStyles] = useState<SavedStyles>(p.styles);
  const [editing, setEditing] = useState<PersonaId | null>(null);
  const nameOf = (id: PersonaId) => styles[id]?.name ?? PERSONAS[id].name.split(" ")[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; upgrade?: string } | null>(p.limits.canStart ? { message: p.limits.canStart, upgrade: "sprint" } : null);

  // When the chip matches the user's own field, interview for their actual target role.
  const role = roleChoice === "Custom" ? customRole : ROLE_TO_DOMAIN[roleChoice] === p.profile.domain ? (p.profile.targetRole || roleChoice) : roleChoice;
  const domain = roleChoice === "Custom" ? p.profile.domain : ROLE_TO_DOMAIN[roleChoice];
  const rung = ladderLevel ? p.ladder.find((l) => l.level === ladderLevel) : null;

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ sessionId: string }>("/api/interviews", {
        method: "POST",
        json: { role: role.trim() || "Candidate", domain, level, type, pressure, persona, mode, panelSize, ladderLevel, targetMinutes: minutes, cameraMetrics },
      });
      router.push(`/room/${r.sessionId}`);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError({ message: err?.message ?? "Couldn't set up the interview", upgrade: err?.code?.startsWith("upgrade:") ? err.code.slice(8) : undefined });
      setBusy(false);
    }
  }

  const walking: string[] = rung?.personaIds?.length ? rung.personaIds : mode === "panel" ? panelRolesForSize(panelSize).map((r) => PANEL_ROLE_PERSONA[r]) : [persona];
  const roles = p.resume?.roles ?? 0;

  return (
    <div className="page-grid gap-y-12">
      <div className="col-span-4 sm:col-span-8 lg:col-span-7">
        <header>
          <h1 className="text-display-l text-fg"><Title>{p.firstRun ? "Your first interview." : "Set up the room."}</Title></h1>
          {p.firstRun && <p className="mt-5 max-w-prose text-body-l text-fg-muted">We&apos;ve started you at Realistic pressure. Speak naturally: the interviewer can hear pauses, follow-ups adapt to what you say, and nothing is scored until afterwards.</p>}
        </header>

        {/* The four things most people choose. Everything else waits under "More options". */}
        <Part title="The interview">
          <Group label="Role">
            <Segmented name="Role" value={roleChoice} onChange={setRoleChoice} options={ROLES.map((r) => ({ value: r, label: r }))} />
            {roleChoice === "Custom" && <Input className="mt-3 max-w-[26rem]" value={customRole} onChange={(e) => setCustomRole(e.target.value)} placeholder="Role title" aria-label="Custom role" />}
          </Group>
          <Group label="Type">
            <Segmented name="Type" value={type} onChange={setType} options={[
              { value: "behavioral", label: "Behavioral" }, { value: "technical", label: "Technical" }, { value: "case", label: "Case" }, { value: "leadership", label: "Leadership" }, { value: "mixed", label: "Mixed" },
            ]} />
          </Group>
          {rung ? (
            <Group label="Interviewer">
              <p className="max-w-prose text-ui text-fg-muted"><span className="text-fg">Rung {rung.level}, {rung.name}</span> sets who you face and the pressure. Turn the Ladder off under More options to choose yourself.</p>
            </Group>
          ) : mode === "single" ? (
            <Group label="Interviewer" hint="Choose one, then make it yours.">
              <InterviewerPicker value={persona} onChange={setPersona} styles={styles} onCustomize={setEditing} />
            </Group>
          ) : (
            <Group label="Your panel">
              <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
                {panelRolesForSize(panelSize).map((role) => {
                  const id = PANEL_ROLE_PERSONA[role];
                  return (
                    <div key={role} className="flex flex-col items-center text-center">
                      <BotStill personaId={id} style={styles[id]} className="aspect-square w-full max-w-[8.5rem]" />
                      <p className="-mt-1 max-w-full truncate text-display-m text-fg">{nameOf(id)}</p>
                      <p className="mt-0.5 text-meta text-fg-muted">{PANEL_ROLE_LABEL[role]}</p>
                      <LinkButton onClick={() => setEditing(id)} aria-label={`Customize ${nameOf(id)}`}>Customize</LinkButton>
                    </div>
                  );
                })}
              </div>
            </Group>
          )}
          <Group label="Length">
            <Segmented name="Length" value={String(minutes)} onChange={(v) => setMinutes(Number(v))} options={[10, 15, 20, 30].map((m) => ({ value: String(m), label: `${m} min`, disabled: m > p.limits.maxMinutes }))} />
          </Group>
        </Part>

        <section className="mt-14">
          <button type="button" aria-expanded={more} aria-controls="more-options" onClick={() => setMore((m) => !m)}
            className="flex min-h-12 w-full items-center justify-between gap-4 border-b border-line pb-3 text-left text-display-m text-fg">
            More options
            <span className="flex items-center gap-3 text-ui text-fg-muted">
              <span className="hidden sm:inline">{STAGES.find((x) => x.value === level)?.label} · {rung ? `rung ${rung.level}` : PRESSURE_LABELS[pressure]}{mode === "panel" ? " · panel" : ""}</span>
              <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden className={cn("transition-transform duration-state", more && "rotate-180")}><path d="M1 1.5 6 6.5l5-5" stroke="currentColor" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          </button>
          <div id="more-options" hidden={!more} className="mt-6 space-y-8">
            <Group label="Interview stage" hint="How far along the process this round is.">
              <Segmented name="Interview stage" value={level} onChange={setLevel} options={STAGES} />
            </Group>
            {p.limits.ladder && (
              <Group label="The Ladder" hint="A rung sets the interviewer and pressure for you.">
                {/* Rungs by number; the chosen rung is said in words beneath, so seven options take one line. */}
                <Segmented name="Ladder rung" value={ladderLevel ? String(ladderLevel) : "custom"} onChange={(v) => setLadderLevel(v === "custom" ? null : Number(v))}
                  options={[{ value: "custom", label: "Off" }, ...p.ladder.map((l) => ({ value: String(l.level), label: String(l.level), spoken: `Rung ${l.level}, ${l.name}${l.unlocked ? "" : ", locked"}`, disabled: !l.unlocked }))]} />
                <p className="mt-3 max-w-prose text-ui text-fg-muted" aria-live="polite">
                  {rung ? <><span className="text-fg">Rung {rung.level}, {rung.name}.</span> {rung.description}</> : "Off. You choose the interviewer and pressure."}
                </p>
              </Group>
            )}
            {!rung && (
              <>
                <Group label="Format">
                  <Segmented name="Format" value={mode} onChange={setMode} options={[
                    { value: "single", label: "One interviewer" },
                    { value: "panel", label: "Panel", hint: p.limits.panel ? "2 to 4 interviewers who cross-question" : "Sprint and Executive plans", disabled: !p.limits.panel },
                  ]} />
                  {mode === "panel" && (
                    <div className="mt-4">
                      <Segmented name="Panel size" value={String(panelSize)} onChange={(v) => setPanelSize(Number(v))} options={[2, 3, 4].map((n) => ({ value: String(n), label: `${n} interviewers`, hint: ["Hiring manager and skeptic", "Adds a peer", "Adds an executive"][n - 2], disabled: n > p.limits.maxPanel }))} />
                    </div>
                  )}
                </Group>
                <Group label="Pressure" aside={<span className="text-display-m text-fg">{PRESSURE_LABELS[pressure]}</span>}>
                  <input aria-label="Pressure" aria-valuetext={PRESSURE_LABELS[pressure]} type="range" min={1} max={5} step={1} value={pressure} onChange={(e) => setPressure(Number(e.target.value) as PressureLevel)} className="dial w-full" />
                  <div className="mt-1 flex justify-between text-meta text-fg-subtle">{[1, 2, 3, 4, 5].map((l) => <span key={l}>{l}</span>)}</div>
                  <p className="mt-3 max-w-prose text-ui text-fg-muted">{PRESSURE_DESCRIPTIONS[pressure]}</p>
                </Group>
              </>
            )}
            <div className="border-t border-line">
              <Toggle checked={cameraMetrics} onChange={setCameraMetrics} label="Camera-based signals" description="Estimate camera engagement and posture on your device. Off means no gaze or posture in your Read; you can still see yourself and record." />
            </div>
          </div>
        </section>
      </div>

      {/* The ticket for this session: who you are about to meet, live, and the one action that matters. */}
      <aside aria-label="This session" className="col-span-4 sm:col-span-8 lg:col-span-5 lg:col-start-8 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-panel bg-surface px-6 pb-6 pt-4 sm:px-8 sm:pb-8">
          <InterviewerStage personaIds={walking} styles={styles} className="mx-auto h-[clamp(11rem,8rem+8vw,15rem)] w-full" />
          <p className="-mt-2 text-display-m text-fg">{rung ? rung.name : mode === "panel" ? `A ${panelSize}-person panel` : `${nameOf(persona)}, ${PERSONAS[persona].label.toLowerCase()}`}</p>
          <p className="mt-2 text-ui text-fg-muted">{role || "Your role"} · {TYPE_LABELS[type]} · {rung ? `pressure ${rung.pressure} of 5` : PRESSURE_LABELS[pressure]} · about {minutes} min</p>
          <dl className="mt-6 divide-y divide-line border-y border-line text-ui">
            <div className="flex items-center justify-between py-2.5"><dt className="text-fg-muted">Resume</dt><dd>{p.resume ? <span className="text-fg">{roles ? `${roles} role${roles === 1 ? "" : "s"}` : "Added"}</span> : <Link href="/profile#documents" className="-my-2 inline-flex min-h-11 items-center px-2 text-fg-muted underline decoration-1 underline-offset-text hover:text-fg">Add</Link>}</dd></div>
            <div className="flex items-center justify-between py-2.5"><dt className="text-fg-muted">Job description</dt><dd>{p.jd ? <span className="text-fg">{p.jd.competencies.length} competencies</span> : <Link href="/profile#documents" className="-my-2 inline-flex min-h-11 items-center px-2 text-fg-muted underline decoration-1 underline-offset-text hover:text-fg">Add</Link>}</dd></div>
            <div className="flex items-center justify-between py-2.5"><dt className="text-fg-muted">Plan</dt><dd className="text-fg">{p.limits.plan}</dd></div>
          </dl>
          {error && (
            <div className="mt-5">
              <FieldError>{error.message}</FieldError>
              {error.upgrade && <Link href="/profile#plan" className="mt-1 inline-flex min-h-11 items-center text-ui text-fg-muted underline decoration-accent decoration-1 underline-offset-text hover:text-accent">See plans</Link>}
            </div>
          )}
          <Button size="lg" className="mt-6 w-full" onClick={start} loading={busy} disabled={!!p.limits.canStart}>Start interview</Button>
          <p className="mt-3 text-center text-meta text-fg-subtle">You&apos;ll confirm camera and microphone consent first.</p>
        </div>
      </aside>
      {/* On phones and tablets the ticket sits after every setting, so its action also rides along at the bottom. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-page pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="frame flex h-16 items-center justify-between gap-4">
          <p className="min-w-0 truncate text-ui text-fg-muted"><span className="text-fg">{rung ? rung.name : mode === "panel" ? `${panelSize}-person panel` : nameOf(persona)}</span> · {minutes} min</p>
          <Button className="shrink-0" onClick={start} loading={busy} disabled={!!p.limits.canStart}>Start interview</Button>
        </div>
      </div>
      <div className="h-16 lg:hidden" aria-hidden />
      <AvatarStudio personaId={editing} saved={styles} onClose={() => setEditing(null)} onSaved={setStyles} />
    </div>
  );
}

/** A part of the form: a title in the serif, then its settings. */
function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14 first-of-type:mt-group">
      <h2 className="border-b border-line pb-3 text-display-m text-fg">{title}</h2>
      <div className="mt-6 space-y-8">{children}</div>
    </section>
  );
}

/** One setting: its label (and optional hint or current value) above the control. */
function Group({ label, hint, aside, children }: { label: string; hint?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="text-ui font-medium text-fg">{label}{hint && <span className="ml-2 font-normal text-fg-subtle">{hint}</span>}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
