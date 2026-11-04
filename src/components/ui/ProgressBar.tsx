import { cn } from "./cn";
export function ProgressBar({ value, max = 1, className, label }: { value: number; max?: number; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("h-0.5 w-full overflow-hidden bg-line-strong", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full origin-left bg-accent transition-transform duration-enter ease-enter" style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}
