import { requireUser } from "@/lib/auth/session";
import { ladderState } from "@/server/queries";
import { loadEntitlementContext } from "@/lib/billing/entitlement-context";
import { canUseLadder } from "@/lib/billing/entitlements";
import { LadderStep } from "@/components/app/cards";
import { ButtonLink } from "@/components/ui/Button";
import { InterviewerStage } from "@/components/avatar/InterviewerStage";
import { savedStyles } from "@/server/avatar-styles";

export const metadata = { title: "Ladder" };

/** The rungs on the right; on the left, the promise and the room you're in now, with who is waiting in it. */
export default async function LadderPage() {
  const user = await requireUser();
  const { steps, current } = await ladderState(user.id);
  const allowed = canUseLadder(await loadEntitlementContext(user.id));
  return (
    <div className="page-grid gap-y-12">
      <div className="col-span-4 sm:col-span-8 lg:sticky lg:top-24 lg:col-span-5 lg:self-start">
        <h1 className="text-display-l text-fg">From friendly recruiter to curveball panel<span className="text-accent">.</span></h1>
        <p className="mt-5 text-body-l text-fg-muted">Each rung is a harder room. You unlock the next after two sessions above your own baseline, measured against you, never against anyone else.</p>
        <div className="mt-10 rounded-panel bg-surface px-6 pb-6 pt-4 sm:px-8 sm:pb-8">
          <InterviewerStage personaIds={current.personaIds} styles={await savedStyles(user.id)} className="mx-auto h-[clamp(10rem,7rem+8vw,14rem)] w-full" />
          <p className="-mt-2 text-display-m text-fg">{current.name}</p>
          <p className="mt-2 text-ui text-fg-muted"><span className="text-fg">You&apos;re on rung {current.level} of {steps.length}.</span> {current.description}</p>
          {allowed.allowed ? <ButtonLink href={`/practice?ladder=${current.level}`} size="lg" className="mt-6">Practice this rung</ButtonLink> : (
            <><p className="mt-4 text-ui text-fg-muted">{allowed.reason}</p><ButtonLink href="/profile#plan" variant="secondary" className="mt-4">See plans</ButtonLink></>
          )}
        </div>
      </div>
      <ol className="col-span-4 sm:col-span-8 lg:col-span-6 lg:col-start-7">
        {steps.map((s) => <li key={s.level}><LadderStep step={s} current={s.level === current.level} /></li>)}
      </ol>
    </div>
  );
}
