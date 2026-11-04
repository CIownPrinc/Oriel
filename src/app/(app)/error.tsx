"use client";
import { useEffect } from "react";
import { Button, TextLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * A page inside the app failed. The navigation stays where it is, so you can go anywhere else;
 * "Try again" re-renders just this page without losing your place.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div>
      <PageHeader title="This page didn't load." lead="Nothing you've saved is lost. Try again; if it keeps happening, come back in a few minutes." />
      {error.digest && <p className="mt-3 text-meta text-fg-subtle">Reference {error.digest}</p>}
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button size="lg" onClick={reset}>Try again</Button>
        <TextLink href="/home" className="text-ui">Go to Home</TextLink>
      </div>
    </div>
  );
}
