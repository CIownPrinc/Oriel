"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { Button, TextLink } from "@/components/ui/Button";

/** A page that failed to render: say so plainly, offer to try again, and keep the way home open. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="frame flex h-16 items-center"><Link href="/" aria-label="Oriel home" className="-ml-1 inline-flex rounded-control p-1"><Logo /></Link></header>
      <main id="content" className="frame flex flex-1 items-center pb-section">
        <div className="max-w-lead">
          <h1 className="text-display-l text-fg">This page didn&apos;t load<span className="text-accent">.</span></h1>
          <p className="mt-5 text-body-l text-fg-muted">Nothing you&apos;ve saved is lost. Try again, and if it keeps happening, come back in a few minutes.</p>
          {error.digest && <p className="mt-3 text-meta text-fg-subtle">Reference {error.digest}</p>}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button size="lg" onClick={reset}>Try again</Button>
            <TextLink href="/" className="text-ui">Go to the home page</TextLink>
          </div>
        </div>
      </main>
    </div>
  );
}
