import { cn } from "./cn";
import type { Confidence } from "@/db/schema";

const CONF: Record<Confidence, { label: string; dots: number }> = {
  high: { label: "High confidence", dots: 3 },
  medium: { label: "Medium confidence", dots: 2 },
  low: { label: "Low confidence", dots: 1 },
};

/**
 * How far to trust a measure, said in words with a three-dot scale. Deliberately neutral:
 * confidence is about certainty, not quality, so it never borrows the good/bad signal colours.
 */
export function ConfidenceMark({ confidence, className }: { confidence: Confidence; className?: string }) {
  const c = CONF[confidence];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-meta text-fg-subtle", className)}>
      <span className="flex gap-0.5" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={cn("size-1 rounded-full", i < c.dots ? "bg-fg-muted" : "bg-line-strong")} />)}</span>
      {c.label}
    </span>
  );
}
