import { cn } from "./cn";

/**
 * A ruled panel: a hairline frame, no fill, no shadow. Only for a real object the eye should
 * read as one thing (a form, a recording, a plan); sections and lists are separated by rules.
 */
export function Card({ className, children, as: As = "div", ...rest }: { className?: string; children: React.ReactNode; as?: "div" | "section" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return <As className={cn("rounded-control border border-line", className)} {...rest}>{children}</As>;
}

/** A status, said in words with a coloured mark, not wrapped in a pill. */
export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "accent" | "good" | "warn" | "bad"; className?: string }) {
  const tones = {
    neutral: "text-fg-muted [--dot:var(--color-fg-subtle)]",
    accent: "text-accent [--dot:var(--color-accent)]",
    good: "text-success [--dot:var(--color-success)]",
    warn: "text-warning [--dot:var(--color-warning)]",
    bad: "text-danger [--dot:var(--color-danger)]",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-meta font-medium", tones[tone], className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-[var(--dot)]" aria-hidden />
      {children}
    </span>
  );
}
