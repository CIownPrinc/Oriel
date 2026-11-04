import { Interviewer } from "@/components/brand/Interviewer";
import { OrielMark } from "@/components/brand/OrielMark";
import { cn } from "./cn";

/** The mark: Oriel's supplied logo. Waiting states use the interviewer's own face instead, because it can blink. */
export function LogoMark({ className, blink, size = 24 }: { className?: string; blink?: boolean; size?: number }) {
  return blink ? <Interviewer size={size} waiting className={className ?? "w-6"} /> : <OrielMark className={className} />;
}

/** The wordmark is set in the serif: Oriel speaks in the same voice as its headlines. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-fg", className)}>
      <OrielMark className="w-7" />
      <span className="font-display text-[1.4375rem] font-medium leading-none tracking-[-0.01em]">Oriel</span>
    </span>
  );
}

/** A waiting state in Oriel's own shape: the face, blinking slowly, with a line beside it. */
export function Thinking({ label, className }: { label: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2.5 text-ui text-fg-muted", className)}>
      <LogoMark blink size={20} className="w-5" />
      {label}
    </span>
  );
}
