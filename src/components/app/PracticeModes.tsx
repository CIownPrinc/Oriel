import Link from "next/link";
import { cn } from "@/components/ui/cn";

/**
 * Practice comes in three kinds. Each says when to reach for it, so nobody has to try all three to
 * find out. Sits above every Practice page; the current kind is marked, the others are one tap away.
 */
const MODES = [
  { href: "/train", name: "Skill practice", when: "When one skill keeps slipping. Answer, get a note, try again." },
  { href: "/lessons", name: "Lessons", when: "After an interview. Fixes built from your own answers." },
  { href: "/drills", name: "Quick drills", when: "When you have five minutes. One habit, one number to beat." },
] as const;

export function PracticeModes({ current }: { current: (typeof MODES)[number]["href"] }) {
  return (
    <nav aria-label="Kinds of practice" className="mb-group grid gap-px overflow-hidden rounded-control border border-line bg-line sm:grid-cols-3">
      {MODES.map((m) => {
        const on = m.href === current;
        return (
          <Link key={m.href} href={m.href} aria-current={on ? "page" : undefined}
            className={cn("group relative flex flex-col gap-1 bg-page px-4 py-3.5 transition-colors duration-press sm:px-5 sm:py-4", on ? "bg-surface" : "hover:bg-surface/60")}>
            {on && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden />}
            <span className={cn("text-ui font-medium", on ? "text-fg" : "text-fg-muted group-hover:text-fg")}>{m.name}</span>
            <span className="text-meta text-fg-subtle">{m.when}</span>
          </Link>
        );
      })}
    </nav>
  );
}
