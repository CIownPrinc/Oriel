import { cn } from "./cn";

/**
 * Nothing here yet: say why in one line and offer the one thing that fills it. Never a blank
 * area, never a paragraph.
 */
export function EmptyState({ title, body, action, className }: { title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border-t border-line py-10", className)}>
      <p className="text-display-m text-fg">{title}</p>
      {body && <p className="mt-2 max-w-prose text-ui text-fg-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
