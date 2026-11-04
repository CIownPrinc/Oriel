"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

/** A page that failed to render: say so plainly, offer to try again, and keep the way home open. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="frame flex h-16 items-center"><Link href="/" aria-label="Oriel home" className="-ml-1 inline-flex rounded-control p-1"><Logo /></Link></header>
      <main id="content" className="frame flex flex-1 items-center pb-section">
        <div className="max-w-[40rem]">
          <h1 className="text-display-l text-fg">This page didn&apos;t load<span className="text-accent">.</span></h1>
          <p className="mt-5 text-body-l text-fg-muted">Nothing you&apos;ve saved is lost. Try again, and if it keeps happening, come back in a few minutes.</p>
          {error.digest && <p className="mt-3 text-meta text-fg-subtle">Reference {error.digest}</p>}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <button type="button" onClick={reset} className="inline-flex h-12 items-center rounded-button border border-transparent bg-accent px-6 text-ui font-medium text-on-accent transition-[background-color,transform] duration-[var(--dur-press)] hover:bg-accent-hover active:bg-accent-press active:scale-[0.97]">Try again</button>
            <Link href="/" className="text-ui text-fg-muted underline decoration-1 underline-offset-[0.2em] transition-colors duration-[var(--dur-press)] hover:text-fg">Go to the home page</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
