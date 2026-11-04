import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/db/client";
import { lessonsFor } from "@/server/lessons";
import { LESSONS, LESSON_ORDER, TRACKS } from "@/lib/lessons/library";
import type { LessonKey, Track } from "@/lib/lessons/types";
import { ButtonLink } from "@/components/ui/Button";
import { LessonCard, LessonSteps, TrackLabel, summarize } from "@/components/app/lessons";
import { relPhrase } from "@/lib/format";

export const metadata = { title: "Lessons" };

const TRACK_ORDER: Track[] = ["responses", "delivery", "presence"];
const NOT_MEASURED: Record<Track, string> = {
  responses: "Not measured: your last interview had too few full answers.",
  delivery: "Not measured: speak your answers so we can hear your delivery.",
  presence: "Not measured in your last interview: allow camera signals in the Room for presence lessons.",
};

export default async function LessonsPage() {
  const user = await requireUser();
  const rows = await lessonsFor(user.id);
  const latest = await getDb().select({ id: schema.interviewSessions.id, endedAt: schema.interviewSessions.endedAt, createdAt: schema.interviewSessions.createdAt })
    .from(schema.interviewSessions).where(and(eq(schema.interviewSessions.userId, user.id), eq(schema.interviewSessions.analysisStatus, "complete")))
    .orderBy(desc(schema.interviewSessions.createdAt)).get();
  const open = rows.filter((r) => r.status !== "mastered");
  const mastered = rows.filter((r) => r.status === "mastered");
  const first = open.find((r) => r.status === "active");
  const latestMetrics = latest ? await getDb().select({ key: schema.metrics.key, value: schema.metrics.value }).from(schema.metrics).where(eq(schema.metrics.sessionId, latest.id)).all() : [];
  const has = (k: string) => latestMetrics.some((m) => m.key === k && m.value !== null);
  // Say "not measured" rather than "on target" when an interview couldn't measure a track.
  const measured: Record<Track, boolean> = {
    responses: has("structure_score") || has("specificity"),
    delivery: has("filler_per_min") || has("pace_wpm"),
    presence: has("camera_engagement") || has("movement") || latestMetrics.some((m) => m.key === "setup"),
  };

  if (!latest) {
    return (
      <div>
        <h1 className="max-w-[20ch] text-display-l text-fg">Your lessons start with one interview<span className="text-accent">.</span></h1>
        <p className="mt-5 max-w-lead text-body-l text-fg-muted">Lessons are built from what we measure while you practice: your pace and fillers, how your answers land, your posture and eye contact on camera. Do one interview and we&apos;ll pick the skills that will make the biggest difference for you, using your own answers as the examples.</p>
        <ButtonLink href="/practice" size="lg" className="mt-8">Start an interview</ButtonLink>
        <Library title="What you could learn" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-display-l text-fg">Built from how you interviewed<span className="text-accent">.</span></h1>
      <p className="mt-5 max-w-lead text-body-l text-fg-muted">
        {open.length
          ? <>From your interview {relPhrase(latest.endedAt ?? latest.createdAt)}: the skills furthest from target, taught with your own answers. Learn it, pass the practice twice, then use it in your next interview: that&apos;s where we confirm it.</>
          : <>Every skill we measured in your interview {relPhrase(latest.endedAt ?? latest.createdAt)} was on target. Raise the pressure next time; new lessons appear when something slips.</>}
      </p>

      {first && (() => {
        const def = LESSONS[first.lessonKey as LessonKey];
        return (
          <Link href={`/lessons/${first.lessonKey}`} className="group mt-group block rounded-panel bg-surface px-6 py-7 transition-colors duration-state hover:bg-raised sm:px-10 sm:py-10">
            <div className="grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-end">
              <div>
                <p className="text-ui font-medium text-fg">Start here · <TrackLabel track={def.track} className="text-fg-muted" /></p>
                <p className="mt-3 text-display-l text-fg">{def.title}</p>
                <p className="mt-3 max-w-prose text-body-l text-fg-muted">{def.promise}</p>
              </div>
              <div>
                <p className="text-ui text-fg-muted">In your interview</p>
                <p className="mt-1 text-body-l text-fg">{first.evidence.display}</p>
                <p className="text-ui text-fg-subtle">target {first.evidence.target}</p>
                <LessonSteps l={summarize(first)} className="mt-5" />
                <span className="mt-5 inline-block text-ui font-medium text-fg underline decoration-accent decoration-1 underline-offset-text group-hover:decoration-2">Open the lesson</span>
              </div>
            </div>
          </Link>
        );
      })()}

      <div className="mt-12 grid gap-8 lg:grid-cols-3">
        {TRACK_ORDER.map((t) => {
          const ls = open.filter((r) => r.track === t && r.lessonKey !== first?.lessonKey);
          const done = mastered.filter((r) => r.track === t);
          return (
            <section key={t}>
              <div className="flex items-baseline justify-between border-b border-line pb-3">
                <h2 className="text-display-m text-fg">{TRACKS[t].label}</h2>
                <span className="text-meta text-fg-subtle">{TRACKS[t].blurb}</span>
              </div>
              <div className="mt-2">
                {ls.map((r) => <LessonCard key={r.id} l={summarize(r)} />)}
                {!ls.length && <p className="border-t border-line py-4 text-ui text-fg-subtle">{first?.track === t ? "Your first lesson is above." : !measured[t] ? NOT_MEASURED[t] : done.length ? "On target. Nicely done." : "On target in your last interview."}</p>}
              </div>
            </section>
          );
        })}
      </div>

      {mastered.length > 0 && (
        <section className="mt-14">
          <h2 className="text-ui font-medium text-fg">Mastered</h2>
          <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {mastered.map((r) => <LessonCard key={r.id} l={summarize(r)} />)}
          </div>
        </section>
      )}

      <Library title="Every lesson" />
    </div>
  );
}

/** The whole library, so any lesson can be read — personal evidence appears only where we measured a need. */
function Library({ title }: { title: string }) {
  return (
    <section className="mt-16">
      <h2 className="text-ui font-medium text-fg">{title}</h2>
      <div className="mt-4 grid gap-x-8 gap-y-10 md:grid-cols-3">
        {TRACK_ORDER.map((t) => (
          <div key={t} className="border-t border-line pt-4">
            <TrackLabel track={t} />
            <ul className="mt-3 space-y-3">
              {LESSON_ORDER.filter((k) => LESSONS[k].track === t).map((k) => (
                <li key={k}><Link href={`/lessons/${k}`} className="-mx-2 block rounded-control px-2 py-1 text-ui text-fg transition-colors duration-press hover:bg-surface">{LESSONS[k].title}<span className="block text-meta text-fg-subtle">{LESSONS[k].promise}</span></Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
