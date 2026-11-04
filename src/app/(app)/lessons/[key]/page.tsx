import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { lessonFor } from "@/server/lessons";
import { LESSONS, PRACTICE_PASSES_NEEDED, TRACKS, formatMeasure } from "@/lib/lessons/library";
import type { LessonKey } from "@/lib/lessons/types";
import { getDrill } from "@/lib/practice/catalog";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { LessonSteps, summarize } from "@/components/app/lessons";
import { SetupCheck } from "@/features/lessons/SetupCheck";
import { relDate, relPhrase } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: LESSONS[key as LessonKey]?.title ?? "Lesson" };
}

export default async function LessonPage({ params }: { params: Promise<{ key: string }> }) {
  const user = await requireUser();
  const { key } = await params;
  if (!(key in LESSONS)) notFound();
  const def = LESSONS[key as LessonKey];
  const found = await lessonFor(user.id, key);
  const l = found?.lesson ?? null;
  const drill = def.drillId ? getDrill(def.drillId) : null;
  const passes = l?.practicePasses ?? 0;
  const status = l?.status ?? null;

  return (
    <div>
      <Link href="/lessons" className="-ml-1 inline-flex h-9 items-center rounded-control px-1 text-ui text-fg-muted transition-colors duration-press hover:text-fg">← Lessons</Link>
      <header className="mt-6 max-w-column">
        <h1 className="text-display-l text-fg">{def.title}</h1>
        <p className="mt-5 text-body-l text-fg-muted">{def.promise}</p>
        <p className="mt-3 text-ui text-fg-subtle">
          {TRACKS[def.track].label} lesson.{status === "active" ? <> <span className="text-fg">In your plan.</span></> : status === "queued" ? " Up next." : status === "mastered" ? <> <span className="text-success">Mastered.</span></> : ""}
        </p>
        {l && <LessonSteps l={{ ...summarize(l), viewed: true }} className="mt-8 max-w-prose" />}
      </header>

      <div className="page-grid mt-group gap-y-12">
        <div className="col-span-4 space-y-14 sm:col-span-8 lg:col-span-7">
          {l ? (
            <section className="border-t border-line pt-6">
              <h2 className="text-ui font-medium text-fg">What we saw in your interview</h2>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-body-l text-fg">{l.evidence.display}</span>
                <span className="text-ui text-fg-subtle">target {l.evidence.target}{l.evidence.confidence !== "high" ? ` · ${l.evidence.confidence} confidence` : ""}</span>
              </p>
              {l.startValue !== null && l.latestValue !== null && l.startValue !== l.latestValue && <p className="mt-1 text-ui text-fg-subtle">{l.status === "mastered" ? `Was ${formatMeasure(l.metricKey, l.startValue)}, now ${formatMeasure(l.metricKey, l.latestValue)}.` : `When this lesson started: ${formatMeasure(l.metricKey, l.startValue)}.`}</p>}
              <p className="mt-5 text-body text-fg">{l.content.observation}</p>
              {l.evidence.quotes.length > 0 && (
                <ul className="mt-8 space-y-6">
                  {l.evidence.quotes.map((q, i) => (
                    <li key={i}>
                      {q.question && <p className="text-meta text-fg-subtle">Answering <span className="font-display text-ui">“{q.question}”</span></p>}
                      <blockquote className="hang-sans mt-1.5 text-body-l text-fg">“{q.text}”</blockquote>
                      <p className="mt-1.5 flex flex-wrap gap-x-3 text-meta text-fg-subtle">
                        {q.note && <span>{q.note}</span>}
                        {q.startMs !== null && <Link href={`/playback/${q.sessionId}?t=${q.startMs}`} className="text-fg-muted underline decoration-1 underline-offset-text hover:text-fg">{found?.recorded && !q.typed ? "Hear it in Playback" : "See it in Playback"}</Link>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {l.evidence.moments.length > 0 && (
                <ul className="mt-6 space-y-2">
                  {l.evidence.moments.map((m, i) => (
                    <li key={i}><Link href={`/playback/${m.sessionId}?t=${m.startMs}`} className="text-ui text-fg-muted underline decoration-1 underline-offset-text hover:text-fg">{m.label}</Link></li>
                  ))}
                </ul>
              )}
              <p className="mt-6 text-meta text-fg-subtle">Measured {relPhrase(l.updatedAt)}. Your numbers only, never compared with other people.</p>
            </section>
          ) : (
            <section className="border-t border-line pt-6">
              <h2 className="text-ui font-medium text-fg">Not in your plan</h2>
              <p className="mt-3 text-body text-fg-muted">We haven&apos;t measured a need for this one: it was on target, or your interviews haven&apos;t measured it yet (typed answers have no pace or voice; camera skills need the camera). The technique below still works.</p>
            </section>
          )}

          <section>
            <h2 className="text-display-m text-fg">Why it matters</h2>
            <p className="mt-3 text-body text-fg-muted">{def.why}</p>
          </section>

          <section>
            <h2 className="text-display-m text-fg">How to do it</h2>
            <ol className="mt-5 border-t border-line">
              {def.steps.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line py-4">
                  <span className="font-display text-display-m leading-none text-fg-subtle">{i + 1}</span>
                  <div><p className="text-body font-medium text-fg">{s.title}</p><p className="mt-1 text-ui text-fg-muted">{s.body}</p></div>
                </li>
              ))}
            </ol>
            {l?.content.tip && <p className="mt-6 border-t border-line pt-4 text-ui text-fg"><span className="font-medium">For you. </span>{l.content.tip}</p>}
          </section>

          {l?.content.rewrite && (
            <section>
              <h2 className="text-display-m text-fg">Your answer, rewritten</h2>
              <div className="mt-5 grid gap-6 md:grid-cols-2">
                <figure className="border-t border-line pt-4"><figcaption className="text-meta font-medium text-fg-subtle">What you said</figcaption><blockquote className="hang-sans mt-2 text-body text-fg-muted">“{l.content.rewrite.before}”</blockquote></figure>
                <figure className="border-t border-line pt-4"><figcaption className="text-meta font-medium text-fg-subtle">Same story, with the lesson</figcaption><blockquote className="hang-sans mt-2 text-body text-fg">“{l.content.rewrite.after}”</blockquote></figure>
              </div>
              <p className="mt-3 text-meta text-fg-subtle">{l.content.rewrite.note}</p>
            </section>
          )}
        </div>

        {/* One panel beside the lesson: the practice that proves it, then the goal that confirms it. */}
        <aside className="col-span-4 sm:col-span-8 lg:col-span-5 lg:col-start-8 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-panel bg-surface px-6 py-6 sm:px-8 sm:py-7">
            <h2 className="text-ui font-medium text-fg">Practice it</h2>
            {drill ? (
              <>
                <p className="mt-3 text-display-m text-fg">{drill.title}</p>
                <p className="mt-1 text-ui text-fg-muted">{drill.objective}</p>
                <p className="mt-3 text-meta text-fg-subtle">Pass: {drill.passRule}</p>
                <ButtonLink href={`/drills/${drill.id}?lesson=${def.key}${l?.sourceSessionId ? `&from=${l.sourceSessionId}` : ""}`} size="lg" className="mt-6 w-full">Start practice</ButtonLink>
                {l && <p className="mt-3 text-center text-meta text-fg-subtle">{passes >= PRACTICE_PASSES_NEEDED ? "Practiced. Now use it in an interview." : `${passes} of ${PRACTICE_PASSES_NEEDED} passes`}</p>}
                {found && found.attempts.length > 0 && (
                  <ul className="mt-5 divide-y divide-line border-t border-line text-ui">
                    {found.attempts.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="text-fg">{a.value ?? "—"} {(a.result as { unit?: string } | null)?.unit}</span>
                        <span className="text-meta text-fg-subtle">{relDate(a.createdAt)}</span>
                        <Badge tone={a.passed ? "good" : "neutral"}>{a.passed ? "Pass" : a.passed === false ? "Not yet" : "—"}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <SetupCheck passes={passes} needed={PRACTICE_PASSES_NEEDED} inPlan={!!l && l.status !== "mastered"} />
            )}
            <div className="mt-8 border-t border-line pt-6">
              <h2 className="text-ui font-medium text-fg">The goal</h2>
              <p className="mt-2 text-body text-fg">{def.goal}</p>
              <p className="mt-2 text-ui text-fg-muted">{status === "mastered" && l?.masteredAt ? `Confirmed in your interview ${relPhrase(l.masteredAt)}.` : "Your next interview confirms it: lessons are only marked mastered when the skill shows up in a real interview."}</p>
              {status !== "mastered" && <ButtonLink href="/practice" variant="secondary" size="sm" className="mt-4">New interview</ButtonLink>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
