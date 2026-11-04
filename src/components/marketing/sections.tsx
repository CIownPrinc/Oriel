import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { InterviewerStage } from "@/components/avatar/InterviewerStage";
import { cn } from "@/components/ui/cn";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { PERSONAS, type PersonaId } from "@/lib/interview/personas";

/*
 * The landing page after the hero: one idea per section, each said in a headline and shown once,
 * with as few words around it as it needs. Who interviews you, what you get back, how your words
 * improve, how your data is handled, what it costs. Every claim comes from the product (personas,
 * the Read, the lesson writer, the privacy policy, the plan data), and every sample says so.
 *
 * Rhythm: every section starts one `section` space below the last; its headline sits a fixed
 * distance above what it shows (`gap`). The Read is the one band, so the page breathes once.
 */

const gap = "mt-12 sm:mt-16";
const linkCls = "text-fg-muted underline decoration-1 underline-offset-[0.2em] transition-colors duration-[var(--dur-press)] hover:text-accent";

function Statement({ id, title, sub, center }: { id: string; title: React.ReactNode; sub?: string; center?: boolean }) {
  return (
    <div className={cn("max-w-[44rem]", center && "mx-auto text-center")}>
      {/* The recurring tally mark: one short accent rule opens every section. */}
      <span className={cn("mb-6 block h-0.5 w-8 bg-accent", center && "mx-auto")} aria-hidden />
      <h2 id={id} className="text-balance text-display-section text-fg">{title}</h2>
      {sub && <p className="mt-5 text-balance text-body-l text-fg-muted">{sub}</p>}
    </div>
  );
}

// ─── The interviewers ─────────────────────────────────────────────────────────

/** The cast, in the order the Ladder introduces them, each with how they interview, in a word or two. */
const CAST: [PersonaId, string][] = [
  ["warm_recruiter", "Encouraging"],
  ["hiring_manager", "Direct"],
  ["direct_manager", "Short on time"],
  ["skeptic", "Skeptical"],
  ["peer", "Collegial"],
  ["executive", "Few words, long pauses"],
];

export function Interviewers() {
  return (
    <section id="how" aria-labelledby="cast-title" className="pt-section">
      <div className="frame">
        <Statement id="cast-title" center title={<>Pick who sits across from&nbsp;you.</>} sub="Six interviewers. Each one listens, remembers what you said and follows up." />
        <ul className={cn(gap, "grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-6")}>
          {CAST.map(([id, how]) => (
            <li key={id} className="flex flex-col items-center text-center">
              <InterviewerStage personaIds={[id]} still={`/interviewer/${id}.webp`} className="aspect-square w-full max-w-[9rem] sm:max-w-[12rem]" />
              <p className="-mt-1 text-display-m text-fg">{PERSONAS[id].name.split(" ")[0]}</p>
              <p className="mt-1 text-ui text-fg-muted">{how}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── The Read ─────────────────────────────────────────────────────────────────

const markCls = "bg-transparent text-fg underline decoration-accent decoration-2 underline-offset-[0.28em]";
const noteNo = "text-meta text-accent";

/** Three measures from the same sample Read: the number, what it measures, and its target. */
const MEASURES: [string, string, string][] = [
  ["142", "words a minute", "Target 120 to 160"],
  ["2.1", "fillers a minute", "Target under 3"],
  ["2 of 3", "answers without an outcome", "Target: every answer"],
];

export function Feedback() {
  return (
    <section id="read" aria-labelledby="read-title" className="mt-section bg-surface py-section">
      <div className="frame">
        <Statement id="read-title" title="Evidence, not adjectives." sub="After every interview: the moments that mattered, and one change for each." />

        <figure className={gap}>
          <figcaption className="sr-only">A sample Read</figcaption>
          <div className="page-grid gap-y-10">
            <blockquote className="col-span-4 sm:col-span-8 lg:col-span-7">
              <p className="hang-sans text-body-l leading-relaxed text-fg-muted">
                “The usage data was incomplete, so{" "}
                <mark className={markCls}>I set a decision date and agreed up front on what would change our minds</mark>
                <sup className={`${noteNo} ml-0.5`}>1</sup>. We ran the holdout for a week, and{" "}
                <mark className={markCls}>I think in the end we kept parts of both</mark>
                <sup className={`${noteNo} ml-0.5`}>2</sup>.”
              </p>
              <p className="mt-4 text-meta text-fg-subtle">From a sample Read</p>
            </blockquote>
            <ol className="col-span-4 space-y-6 sm:col-span-8 lg:col-span-4 lg:col-start-9">
              <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-baseline">
                <span className={noteNo} aria-hidden>1</span>
                <p className="text-ui text-fg-muted"><span className="block font-medium text-fg">Strength</span>You defined what would change your mind before the test.</p>
              </li>
              <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-baseline">
                <span className={noteNo} aria-hidden>2</span>
                <p className="text-ui text-fg-muted"><span className="block font-medium text-fg">Next time</span>Say what happened. Close with the outcome.</p>
              </li>
            </ol>
          </div>

          <dl className="mt-14 grid gap-y-8 border-t border-line pt-8 sm:grid-cols-3 sm:gap-x-6">
            {MEASURES.map(([value, what, target]) => (
              <div key={what}>
                <dt className="sr-only">{what}</dt>
                <dd className="text-display-l text-accent">{value}</dd>
                <dd className="mt-1 text-ui text-fg-muted">{what}</dd>
                <dd className="text-meta text-fg-subtle">{target}</dd>
              </div>
            ))}
          </dl>
        </figure>

        <p className="mt-10 text-ui text-fg-subtle">
          Never measured: appearance, age, race, emotion or accent.{" "}
          <Link href="/trust" className={`${linkCls} whitespace-nowrap`}>How accurate is the Read</Link>
        </p>
      </div>
    </section>
  );
}

// ─── Your words, rewritten ────────────────────────────────────────────────────

const blank = "text-fg-muted";

export function Practice() {
  return (
    <section id="practice" aria-labelledby="practice-title" className="pt-section">
      <div className="frame">
        <Statement id="practice-title" title={<>Then see your answer, done&nbsp;right.</>} sub="Lessons rewrite your words. Five-minute drills make it stick." />
        <figure className={cn(gap, "page-grid gap-y-8")}>
          <figcaption className="sr-only">A sample rewrite, from the lesson “Land the result”</figcaption>
          <div className="col-span-4 sm:col-span-4 lg:col-span-5">
            <p className="text-meta text-fg-subtle">You said</p>
            <p className="hang-sans mt-3 text-body-l text-fg-muted">“We ran the holdout for a week, and I think in the end we kept parts of both.”</p>
          </div>
          <div className="col-span-4 sm:col-span-4 lg:col-span-6 lg:col-start-7">
            <p className="text-meta text-fg-subtle">With the lesson</p>
            <p className="hang-sans mt-3 text-body-l text-fg">“We ran the holdout for a week and kept <span className={blank}>[what you kept]</span>. As a result, <span className={blank}>[what changed, with a number]</span>.”</p>
            <p className="mt-4 text-meta text-fg-subtle">The blanks are yours to fill. Oriel never adds facts.</p>
          </div>
        </figure>
      </div>
    </section>
  );
}

// ─── Trust and privacy ────────────────────────────────────────────────────────

/** Four promises from the privacy policy, one line each. */
const PRIVACY = [
  "Your interviewer says it’s an AI.",
  "The camera waits for your consent.",
  "Face tracking runs on your device.",
  "Delete any session, any time.",
];

export function Privacy() {
  return (
    <section id="privacy" aria-labelledby="privacy-title" className="pt-section">
      <div className="frame">
        <Statement id="privacy-title" title="Private by default. Practice only." />
        <ul className={cn(gap, "grid gap-x-6 gap-y-4 border-t border-line pt-8 sm:grid-cols-2 lg:grid-cols-4")}>
          {PRIVACY.map((t) => <li key={t} className="text-body-l text-fg">{t}</li>)}
        </ul>
        <p className="mt-8 text-ui"><Link href="/privacy" className={linkCls}>Read the privacy and biometric policy</Link></p>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

const TIERS: PlanId[] = ["free", "sprint", "pro", "executive"];
/** The plan data's cadence, said as a phrase beside the price. */
const CADENCE: Partial<Record<PlanId, string>> = { sprint: "once, for 14 days", pro: "a month", executive: "add-on" };

export function Pricing({ cta }: { cta: string }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="pt-section">
      <div className="frame">
        <Statement id="pricing-title" title={<>Pay for the interview you have coming&nbsp;up.</>} />
        <ul className={cn(gap, "grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4")}>
          {TIERS.map((id) => {
            const p = PLANS[id];
            // The plan built for an interview on the calendar carries the page's one filled action.
            const featured = id === "sprint";
            return (
              <li key={id} className={cn("flex flex-col border-t pt-6", featured ? "border-t-2 border-accent" : "border-line")}>
                <h3 className="text-ui font-medium text-fg">{p.name}</h3>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="text-display-l leading-none text-fg">{p.price}</span>
                  {CADENCE[id] && <span className="text-ui text-fg-muted">{CADENCE[id]}</span>}
                </p>
                <ul className="mt-6 flex-1 space-y-2 text-ui text-fg-muted">
                  {p.features.slice(0, 3).map((f) => <li key={f}>{f}</li>)}
                </ul>
                <ButtonLink href={id === "executive" ? "mailto:hello@oriel.example" : cta} variant={featured ? "primary" : "secondary"} className="mt-8 self-start">
                  {id === "free" ? "Start free" : id === "executive" ? "Talk to us" : `Choose ${p.name}`}
                </ButtonLink>
              </li>
            );
          })}
        </ul>
        <p className="mt-12 text-ui text-fg-subtle">Career centers: <a href="mailto:hello@oriel.example?subject=Campus" className={linkCls}>ask about campus seats</a>.</p>
      </div>
    </section>
  );
}

// ─── The last line ────────────────────────────────────────────────────────────

export function Closing({ cta, signedIn }: { cta: string; signedIn: boolean }) {
  return (
    <section aria-labelledby="closing-title" className="py-section">
      <div className="frame flex flex-col items-center text-center">
        {/* The cast once more, small and still: the room you're about to walk into. */}
        <div className="flex -space-x-2" aria-hidden>
          {CAST.map(([id]) => (
            // eslint-disable-next-line @next/next/no-img-element -- small stills rendered by the avatar engine
            <img key={id} src={`/interviewer/${id}.webp`} alt="" width={352} height={352} loading="lazy" decoding="async" className="size-16 sm:size-20" />
          ))}
        </div>
        <h2 id="closing-title" className="mt-6 text-display-xl text-fg">Walk in ready<span className="text-accent">.</span></h2>
        <ButtonLink href={cta} size="lg" className="mt-10 w-full min-[480px]:w-auto">
          {signedIn ? "Practice an interview" : "Start practicing free"}
        </ButtonLink>
        {!signedIn && <p className="mt-3 text-meta text-fg-subtle">One free interview a week. No&nbsp;card&nbsp;required.</p>}
      </div>
    </section>
  );
}
