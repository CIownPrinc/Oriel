import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

/*
 * Form controls. A control's edge is the `control` token (3:1 against every surface, as WCAG
 * asks of a field's boundary); focus is the page-wide accent outline. Text is 16px or larger,
 * so phones never zoom into a field.
 */
const control = "w-full rounded-control border border-control bg-surface px-3.5 text-body text-fg placeholder:text-fg-subtle transition-[border-color,background-color] duration-[var(--dur-press)] hover:border-fg-subtle aria-[invalid=true]:border-danger disabled:opacity-50";

export function Label({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 flex items-baseline justify-between gap-4">
      <span className="text-ui font-medium text-fg">{children}</span>
      {hint && <span className="text-meta text-fg-subtle">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-28 resize-y py-3 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, "h-11 cursor-pointer appearance-none pr-10", className)} {...rest}>{children}</select>
      <svg className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-fg-muted" width="12" height="8" viewBox="0 0 12 8" aria-hidden><path d="M1 1.5 6 6.5l5-5" stroke="currentColor" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
});

export function FieldError({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-2 text-ui leading-snug text-danger">
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="mt-[3px] shrink-0"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" fill="none" /><path d="M8 4.5v4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="11.2" r="0.9" fill="currentColor" /></svg>
      <span>{children}</span>
    </p>
  );
}

/**
 * A single choice. Short options read as a quiet row of words: only the chosen one is drawn,
 * as a raised chip with a control edge, so a form of five choices shows five marks, not thirty
 * boxes. Options that need a sentence of explanation become a ruled list of radio rows.
 */
export function Segmented<T extends string>({ value, onChange, options, name, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string; disabled?: boolean; /** The option's full name when its label is a number or a word out of context. */ spoken?: string }[]; name: string; className?: string }) {
  const rows = options.some((o) => o.hint);
  return (
    <div role="radiogroup" aria-label={name} className={cn(rows ? "grid border-t border-line" : "flex flex-wrap gap-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return rows ? (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.hint ? `${o.label}, ${o.hint}` : o.label} disabled={o.disabled} onClick={() => onChange(o.value)}
            className={cn("group grid grid-cols-[1.25rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-line py-3.5 text-left transition-colors duration-[var(--dur-press)] disabled:cursor-not-allowed disabled:opacity-40",
              !on && "hover:bg-surface/60")}>
            <span className={cn("relative top-[3px] grid size-4 place-items-center rounded-full border transition-colors duration-[var(--dur-press)]", on ? "border-accent" : "border-control group-hover:border-fg-subtle")} aria-hidden>
              <span className={cn("size-2 rounded-full bg-accent transition-transform duration-[var(--dur-state)] ease-[var(--ease-enter)]", on ? "scale-100" : "scale-0")} />
            </span>
            <span>
              <span className={cn("block text-ui font-medium", on ? "text-fg" : "text-fg-muted")}>{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-meta leading-snug text-fg-subtle">{o.hint}</span>}
            </span>
          </button>
        ) : (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.spoken ?? o.label} disabled={o.disabled} onClick={() => onChange(o.value)}
            className={cn("h-9 min-w-9 whitespace-nowrap rounded-control px-3 text-ui transition-[background-color,color,box-shadow] duration-[var(--dur-press)] disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:h-11",
              on ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--color-control)]" : "text-fg-muted hover:bg-surface hover:text-fg")}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start justify-between gap-6 py-4", disabled && "opacity-40")}>
      <span>
        <span className="block text-ui font-medium text-fg">{label}</span>
        {description && <span className="mt-1 block max-w-prose text-ui leading-relaxed text-fg-muted">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-6 w-10 shrink-0 rounded-full border transition-colors duration-[var(--dur-state)]", checked ? "border-accent bg-accent" : "border-control bg-raised")}>
        <span className={cn("absolute left-[2px] top-[2px] size-[18px] rounded-full transition-transform duration-[var(--dur-state)] ease-[var(--ease-enter)]", checked ? "translate-x-4 bg-on-accent" : "translate-x-0 bg-fg-muted")} />
      </button>
    </label>
  );
}
