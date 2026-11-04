"use client";
import { BotStill } from "@/components/avatar/BotStill";
import type { SavedStyles } from "@/components/avatar/AvatarStudio";
import { cn } from "@/components/ui/cn";
import { PERSONAS, SOLO_INTERVIEWERS, type PersonaId, type SoloInterviewer } from "@/lib/interview/personas";

/**
 * Choose an interviewer: the real avatars side by side, the chosen one lit. Used by onboarding and
 * by interview setup, so a name, label and hint read the same wherever you meet them.
 */
export function InterviewerPicker({ value, onChange, styles, onCustomize, className }: {
  value: SoloInterviewer;
  onChange: (id: SoloInterviewer) => void;
  styles?: SavedStyles;
  /** When given, each interviewer gets a "Customize" action beneath it. */
  onCustomize?: (id: PersonaId) => void;
  className?: string;
}) {
  const nameOf = (id: PersonaId) => styles?.[id]?.name ?? PERSONAS[id].name.split(" ")[0];
  return (
    <div role="radiogroup" aria-label="Interviewer" className={cn("grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4", className)}>
      {SOLO_INTERVIEWERS.map((id) => {
        const on = value === id;
        const p = PERSONAS[id];
        return (
          <div key={id} className="flex flex-col items-center">
            <button type="button" role="radio" aria-checked={on} aria-label={`${nameOf(id)}, ${p.label}: ${p.hint}`} onClick={() => onChange(id)}
              className={cn("w-full rounded-panel px-2 pb-4 pt-1 text-center transition-colors duration-state", on ? "bg-surface shadow-[inset_0_0_0_1px_var(--color-accent)]" : "hover:bg-surface/50")}>
              <BotStill personaId={id} style={styles?.[id]} className={cn("mx-auto aspect-square w-full max-w-[8.5rem] transition-opacity duration-state", !on && "opacity-80")} />
              <span className={cn("-mt-1 block truncate text-display-m", on ? "text-fg" : "text-fg-muted")}>{nameOf(id)}</span>
              <span className="mt-0.5 block text-meta text-fg-muted">{p.label}</span>
              <span className="mt-1 line-clamp-2 block text-meta text-fg-subtle">{p.hint}</span>
            </button>
            {onCustomize && (
              <button type="button" onClick={() => onCustomize(id)} aria-label={`Customize ${nameOf(id)}`}
                className="mt-1 h-11 rounded-control px-3 text-meta text-fg-muted underline decoration-1 underline-offset-text transition-colors duration-press hover:text-fg">Customize</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
