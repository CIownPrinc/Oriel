import { ButtonLink } from "@/components/ui/Button";
import { InterviewPreview } from "./InterviewPreview";

/**
 * The first screen is a room: the promise above, the interviewer facing you below it. Centred,
 * so the headline, the action and the face sit on one axis and are read in one pass.
 */
export function Hero({ cta, signedIn }: { cta: string; signedIn: boolean }) {
  return (
    <section aria-labelledby="hero-title" className="frame flex flex-col items-center pt-[calc(var(--header-h)+var(--spacing-hero))] text-center">
      <h1 id="hero-title" className="max-w-[11em] text-balance text-display-xl text-fg">
        Practice for the&nbsp;room before you’re in&nbsp;it<span className="text-accent">.</span>
      </h1>
      <p className="mt-6 max-w-[34rem] text-balance text-body-l text-fg-muted">
        An AI interviewer that asks real follow‑ups, then shows you exactly what to fix.
      </p>
      <ButtonLink href={cta} size="lg" className="mt-8 w-full min-[480px]:w-auto">
        {signedIn ? "Practice an interview" : "Start practicing free"}
      </ButtonLink>
      {!signedIn && <p className="mt-3 text-meta text-fg-subtle">One free interview a week. No&nbsp;card&nbsp;required.</p>}
      <div className="mt-6 w-full sm:mt-8">
        <InterviewPreview />
      </div>
    </section>
  );
}
