import { cn } from "./cn";

/** A placeholder in the shape of what is loading, so the page doesn't jump when it arrives. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("skeleton block", className)} />;
}

/** The shape every app page shares while its data loads: a title, a sentence, then rows. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="h-10 w-[min(28rem,80%)] rounded-control" />
      <Skeleton className="mt-5 h-5 w-[min(34rem,95%)]" />
      <div className="mt-group space-y-3 border-t border-line pt-6">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-control" />)}
      </div>
    </div>
  );
}
