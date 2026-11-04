import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { LESSONS, PRACTICE_PASSES_NEEDED as PRACTICE_NEEDED, TRACKS, formatMeasure } from "@/lib/lessons/library";
import type { LessonEvidence, LessonKey, Track } from "@/lib/lessons/types";

export interface LessonSummary {
  key: LessonKey;
  status: "active" | "queued" | "mastered";
  evidence: Pick<LessonEvidence, "display" | "target"> | null;
  practicePasses: number;
  viewed: boolean;
  metricKey?: string;
  startValue?: number | null;
  latestValue?: number | null;
}

export function summarize(r: { lessonKey: string; status: "active" | "queued" | "mastered"; evidence: LessonEvidence; practicePasses: number; viewedAt: Date | null; metricKey: string; startValue: number | null; latestValue: number | null }): LessonSummary {
  return { key: r.lessonKey as LessonKey, status: r.status, evidence: r.evidence, practicePasses: r.practicePasses, viewed: !!r.viewedAt, metricKey: r.metricKey, startValue: r.startValue, latestValue: r.latestValue };
}


/** Learn → practice → use it in an interview: where a lesson stands. Only what actually happened is ticked. */
export function LessonSteps({ l, className }: { l: LessonSummary; className?: string }) {
  const practised = l.practicePasses >= PRACTICE_NEEDED;
  const steps = [
    { label: "Learn", done: l.viewed || l.practicePasses > 0 },
    { label: practised ? "Practiced" : `Practice ${Math.min(l.practicePasses, PRACTICE_NEEDED)} of ${PRACTICE_NEEDED}`, done: practised },
    { label: l.status === "mastered" ? "Confirmed in an interview" : "Use it in an interview", done: l.status === "mastered" },
  ];
  return (
    <ol className={cn("flex gap-1.5", className)} aria-label="Lesson progress">
      {steps.map((s) => (
        <li key={s.label} className="min-w-0 flex-1">
          <span className={cn("block h-0.5", s.done ? "bg-accent" : "bg-line-strong")} />
          <span className={cn("mt-1.5 block text-meta", s.done ? "text-fg" : "text-fg-subtle")}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function TrackLabel({ track, className }: { track: Track; className?: string }) {
  return <span className={cn("text-meta font-medium text-fg-subtle", className)}>{TRACKS[track].label}</span>;
}

export function LessonCard({ l }: { l: LessonSummary }) {
  const def = LESSONS[l.key];
  return (
    <Link href={`/lessons/${l.key}`} className={cn("group block border-t pb-2 pt-4 transition-colors duration-press", l.status === "active" ? "border-line-strong hover:border-fg-subtle" : "border-line hover:border-fg-subtle")}>
      <div className="flex items-start justify-between gap-3">
        <TrackLabel track={def.track} />
        {l.status === "queued" && <span className="text-meta font-medium text-fg-subtle">Up next</span>}
        {l.status === "mastered" && <span className="text-meta font-medium text-success">Mastered</span>}
      </div>
      <p className="mt-2 text-display-m text-fg">{def.title}</p>
      {l.status === "mastered" && l.metricKey && l.startValue != null && l.latestValue != null && l.startValue !== l.latestValue ? (
        <p className="mt-2 text-ui text-fg-subtle">was {formatMeasure(l.metricKey, l.startValue)} · <span className="text-success">now {formatMeasure(l.metricKey, l.latestValue)}</span></p>
      ) : l.evidence && <p className="mt-2 text-ui text-fg-muted"><span className="text-fg">{l.evidence.display}</span> <span className="text-fg-subtle">· target {l.evidence.target}</span></p>}
      {l.status !== "queued" && <LessonSteps l={l} className="mt-4" />}
    </Link>
  );
}
