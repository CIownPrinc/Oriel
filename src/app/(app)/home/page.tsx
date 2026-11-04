import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/db/client";
import { ButtonLink, TextLink } from "@/components/ui/Button";
import { QuickStart } from "@/components/app/QuickStart";
import { quickStartSetup } from "@/server/quick-start";
import { loadEntitlementContext } from "@/lib/billing/entitlement-context";
import { Badge } from "@/components/ui/Card";
import { listSessions, progressSummary } from "@/server/queries";
import { recommendDrill } from "@/lib/practice/progress";
import { getDrill } from "@/lib/practice/catalog";
import { relDate, TYPE_LABEL } from "@/lib/format";
import { nextLesson } from "@/server/lessons";
import { InterviewerStage } from "@/components/avatar/InterviewerStage";
import { savedStyles } from "@/server/avatar-styles";
import { PERSONAS, type PersonaId } from "@/lib/interview/personas";
import { callName } from "@/lib/avatar/style";
import { dueReviews } from "@/server/training/service";
import { LESSONS } from "@/lib/lessons/library";
import type { LessonKey } from "@/lib/lessons/types";

export const metadata = { title: "Home" };

export default async function Home() {
  const user = await requireUser();
  // Everything Home needs, fetched at once rather than one query after another.
  const [profile, sessions, { latest, history }, lesson, styles, reviews, ent] = await Promise.all([
    getDb().select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get(),
    listSessions(user.id, 5),
    progressSummary(user.id),
    nextLesson(user.id),
    savedStyles(user.id),
    dueReviews(user.id),
    loadEntitlementContext(user.id),
  ]);
  // "First run" lasts until a session has actually been analyzed; an abandoned one doesn't count.
  const firstRun = history.length === 0;
  const quick = profile ? quickStartSetup(profile, ent, sessions.length === 0) : null;
  // The interviewer on Home is the one "Start interview" puts you in front of.
  const next: PersonaId = quick?.setup.persona ?? "hiring_manager";
  const rec = recommendDrill(latest?.metrics ?? {});
  const drill = getDrill(rec.drillId)!;
  // One suggestion, in order of what matters most: a review that's due, the next lesson, a drill.
  // Before the first interview there is nothing to suggest: the interview is the next step.
  const upNext = reviews.length
    ? { title: `Review: ${reviews[0].label}`, why: "A new question, answered cold, to see whether what you practiced has held.", href: "/train", action: "Start the review" }
    : lesson
      ? { title: LESSONS[lesson.lessonKey as LessonKey].title, why: LESSONS[lesson.lessonKey as LessonKey].promise, href: `/lessons/${lesson.lessonKey}`, action: "Open the lesson" }
      : firstRun ? null : { title: drill.title, why: rec.reason, href: `/drills/${drill.id}`, action: "Start the drill" };

  return (
    <div>
      {/* The promise of the page, and the interviewer it promises: standing on the page, not boxed. */}
      <section className="page-grid items-center gap-y-6 pb-group">
        <div className="col-span-4 sm:col-span-8 lg:col-span-6">
          <h1 className="text-display-l text-fg">Ready for the room{profile?.name ? `, ${profile.name.split(" ")[0]}` : ""}?</h1>
          <p className="mt-5 max-w-prose text-body-l text-fg-muted">
            {firstRun
              ? `${quick?.setup.targetMinutes ?? 15} minutes, ${TYPE_LABEL[quick?.setup.type ?? "behavioral"]?.toLowerCase() ?? "behavioral"} questions for ${quick?.setup.role ?? "your role"}. Your first session sets the baseline everything after is measured against.`
              : `${history.length} session${history.length === 1 ? "" : "s"} analyzed${profile?.targetRole ? ` for ${profile.targetRole}` : ""}. Same setup as before, or change it.`}
          </p>
          <div className="mt-8 flex flex-wrap items-start gap-x-6 gap-y-3">
            {quick ? <QuickStart setup={quick.setup} blocked={quick.blocked} /> : <ButtonLink href="/practice" size="lg">Start interview</ButtonLink>}
            <TextLink href="/practice" className="inline-flex min-h-12 items-center text-ui">Change setup</TextLink>
            {sessions[0]?.analysisStatus === "complete" && <TextLink href={`/playback/${sessions[0].id}`} className="inline-flex min-h-12 items-center text-ui">Open your last Playback</TextLink>}
          </div>
        </div>
        <figure className="col-span-4 sm:col-span-8 lg:col-span-6">
          <InterviewerStage personaIds={[next]} styles={styles} className="mx-auto h-[clamp(13rem,9rem+12vw,22rem)] w-full max-w-[34rem]" />
          <figcaption className="-mt-1 text-center text-ui text-fg-muted">
            <span className="text-fg">{callName(PERSONAS[next].name, styles[next])}</span>, {PERSONAS[next].label.toLowerCase()}
          </figcaption>
        </figure>
      </section>

      {/* After the greeting, only two things: the one thing to do next, and where you've been.
          Before the first interview there is neither, so the page is just the greeting and its action. */}
      {(!firstRun || sessions.length > 0) && <section className="page-grid gap-y-14 pt-16">
        {upNext && <div className="col-span-4 sm:col-span-8 lg:col-span-6">
          <h2 className="text-ui font-medium text-fg">Up next</h2>
          <div className="mt-3 border-t border-line pt-5">
            <p className="text-display-m text-fg">{upNext.title}</p>
            <p className="mt-2 max-w-prose text-ui text-fg-muted">{upNext.why}</p>
            <TextLink href={upNext.href} className="mt-2 inline-flex min-h-11 items-center text-ui">{upNext.action}</TextLink>
          </div>
        </div>}
        <div className="col-span-4 sm:col-span-8 lg:col-span-5 lg:col-start-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-ui font-medium text-fg">Recent sessions</h2>
            {sessions.length > 0 && <TextLink href="/playback" className="inline-flex min-h-11 items-center text-meta">All results</TextLink>}
          </div>
          <ul className="mt-3 border-t border-line">
            {sessions.length ? sessions.slice(0, 3).map((s) => (
              <li key={s.id} className="border-b border-line">
                <Link href={s.status === "ended" ? `/playback/${s.id}` : `/room/${s.id}`} className="-mx-2 flex items-center gap-4 rounded-control px-2 py-3.5 transition-colors duration-press hover:bg-surface">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui text-fg">{s.role} · {TYPE_LABEL[s.type] ?? s.type}{s.mode === "panel" ? " · panel" : ""}</p>
                    <p className="mt-0.5 text-meta text-fg-subtle">{relDate(s.createdAt)} · pressure {s.pressure} of 5</p>
                  </div>
                  {s.status !== "ended" ? <Badge tone="warn">Unfinished</Badge> : s.analysisStatus === "complete" ? <Badge>Read ready</Badge> : s.analysisStatus === "failed" ? <Badge tone="bad">Needs retry</Badge> : <Badge>Analyzing</Badge>}
                </Link>
              </li>
            )) : null}
          </ul>
        </div>
      </section>}
    </div>
  );
}
