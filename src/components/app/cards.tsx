import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { ConfidenceMark } from "@/components/ui/Metric";
import { mmss } from "@/lib/format";
import type { Confidence } from "@/db/schema";

/**
 * A moment from a recording: when, what happened, and the one change to try. The interviewer's
 * question is quoted in the serif (Oriel's voice); `compact` drops it where the list is a digest.
 */
export function PlaybackClipCard({ clip, href, active, onClick, compact }: {
  clip: { startMs: number; title: string; observed: string; suggestion: string; confidence: Confidence; questionText: string };
  href?: string; active?: boolean; onClick?: () => void; compact?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-baseline gap-3">
        <span className="text-meta text-accent">{mmss(clip.startMs)}</span>
        <span className="text-ui font-medium text-fg">{clip.title}</span>
        {!compact && <span className="ml-auto hidden sm:block"><ConfidenceMark confidence={clip.confidence} /></span>}
      </div>
      {!compact && <p className="mt-1.5 line-clamp-1 font-display text-body text-fg-subtle">“{clip.questionText}”</p>}
      <p className="mt-2.5 text-ui text-fg-muted">{clip.observed}</p>
      <p className="mt-2 text-ui text-fg">{clip.suggestion.startsWith("Try:") ? <><span className="font-medium text-accent">Try:</span>{clip.suggestion.slice(4)}</> : clip.suggestion}</p>
    </>
  );
  const cls = cn("-mx-2 block w-[calc(100%+1rem)] rounded-control border-t px-2 py-5 text-left transition-colors duration-press", active ? "border-transparent bg-raised" : "border-line hover:bg-surface");
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls} aria-pressed={active}>{body}</button>;
}

export function DrillCard({ drill, recommended, lastValue }: { drill: { id: string; title: string; objective: string; durationSec: number; requiresCamera: boolean }; recommended?: string | null; lastValue?: string | null }) {
  return (
    <Link href={`/drills/${drill.id}`} className={cn("group flex flex-col border-t pb-2 pt-4 transition-colors duration-press", "border-line-strong hover:border-fg-subtle")}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-meta text-fg-subtle">{Math.round(drill.durationSec / 60) || 1} min{drill.requiresCamera ? " · camera" : ""}</span>
      </div>
      <p className="mt-3 text-display-m text-fg">{drill.title}</p>
      <p className="mt-2 flex-1 text-ui text-fg-muted">{drill.objective}</p>
      {recommended && <p className="mt-3 text-meta text-fg">{recommended}</p>}
      <div className="mt-5 flex items-center justify-between text-ui">
        <span className="text-fg-subtle">{lastValue ? `Last: ${lastValue}` : "Not tried yet"}</span>
        <span className="font-medium text-fg underline decoration-accent decoration-1 underline-offset-4 group-hover:decoration-2">Start</span>
      </div>
    </Link>
  );
}

export function LadderStep({ step, current }: { step: { level: number; name: string; description: string; unlocked: boolean; completed: boolean; qualifying: number; mode: string; personaIds: string[]; pressure: number }; current: boolean }) {
  return (
    <div className="relative grid grid-cols-[2.25rem_1fr] items-baseline gap-x-4 border-t border-line py-5">
      <span className={cn("font-display text-display-m leading-none", step.completed ? "text-success" : current ? "text-accent" : "text-fg-subtle")}>{step.level}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* Locked rungs are quieter in colour, not faded: every word still reads at 4.5:1. */}
          <p className={cn("text-display-m", step.unlocked ? "text-fg" : "text-fg-subtle")}>{step.name}</p>
          <p className="text-meta text-fg-subtle">{step.mode === "panel" ? `${step.personaIds.length}-person panel` : "One-on-one"} · pressure {step.pressure} of 5</p>
          <p className={cn("ml-auto text-meta font-medium", step.completed ? "text-success" : current ? "text-accent" : "text-fg-subtle")}>{step.completed ? "Done" : current ? "You are here" : step.unlocked ? "Open" : "Locked"}</p>
        </div>
        <p className={cn("mt-1 text-ui", step.unlocked ? "text-fg-muted" : "text-fg-subtle")}>{step.description}</p>
        {step.unlocked && !step.completed && <p className="mt-2 text-meta text-fg-muted">{step.qualifying} of 2 sessions above your baseline</p>}
      </div>
    </div>
  );
}
