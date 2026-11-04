import { cn } from "./cn";

/**
 * A title whose closing full stop is lit in the accent: the recurring tally mark on every page.
 * Only plain strings get the mark; anything else renders as given.
 */
export function Title({ children }: { children: React.ReactNode }) {
  if (typeof children === "string" && children.endsWith(".")) {
    return <>{children.slice(0, -1)}<span className="text-accent">.</span></>;
  }
  return <>{children}</>;
}

/**
 * The top of every app page: one title, at most one sentence under it, and at most one action.
 * Pages say what they are for here, once, and nowhere else.
 */
export function PageHeader({ title, lead, action, className }: { title: React.ReactNode; lead?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="max-w-lead">
        <h1 className="text-display-l text-fg"><Title>{title}</Title></h1>
        {lead && <p className="mt-4 max-w-prose text-body-l text-fg-muted">{lead}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
