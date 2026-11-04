import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/db/client";
import { dueReviews, learningState, openLoops, type SkillState } from "@/server/training/service";
import { StartPractice, StartReview } from "@/features/training/StartPractice";
import { CATEGORIES, type Category } from "@/lib/training/competencies";
import type { Outcome } from "@/lib/training/engine";

export const metadata = { title: "Training" };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** An outcome in words, with its date; "not assessed" is said as such, never as a low result. */
function said(o: { outcome: Outcome; at: string | null }, yes: string, no: string) {
  if (o.outcome === "not_assessed") return <span className="text-fg-subtle">Not assessed</span>;
  return <span className={o.outcome === "yes" ? "text-fg" : "text-fg-muted"}>{o.outcome === "yes" ? yes : no}{o.at ? `, ${day(o.at)}` : ""}</span>;
}

export default async function TrainPage() {
  const user = await requireUser();
  const profile = await getDb().select({ type: schema.profiles.preferredInterviewType }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get();
  const preferred = (CATEGORIES.some((c) => c.id === profile?.type) ? profile!.type : "behavioral") as Category;
  const due = await dueReviews(user.id);
  // A started review shows once, as its review.
  // Only the most recent unfinished practice is offered; older ones are left, not listed.
  const open = (await openLoops(user.id)).filter((l) => !due.some((d) => d.startedLoopId === l.id)).slice(0, 1);
  const skills = await learningState(user.id);
  const assessed = skills.filter((s) => s.assessed);
  const unassessed = skills.filter((s) => !s.assessed);

  return (
    <div>
      <header className="max-w-lead">
        <h1 className="text-display-l text-fg">Practice one skill until it holds<span className="text-accent">.</span></h1>
        <p className="mt-5 text-body-l text-fg-muted">Answer cold. Get one note. Try again on your own. Then face a question you haven&apos;t seen, and come back later to see if it stuck.</p>
      </header>

      {(due.length > 0 || open.length > 0) && (
        <section aria-labelledby="due-title" className="mt-group">
          <h2 id="due-title" className="text-ui font-medium text-fg">Waiting for you</h2>
          <ul className="mt-3 border-t border-line">
            {due.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
                <div>
                  <p className="text-body text-fg">Review: {r.label}</p>
                  <p className="text-meta text-fg-subtle">Due {day(r.dueAt)} · a new question, answered cold</p>
                </div>
                <StartReview id={r.id} label={r.label} />
              </li>
            ))}
            {open.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
                <div>
                  <p className="text-body text-fg">{l.kind === "review" ? "Review" : "Practice"} in progress</p>
                  <p className="text-meta text-fg-subtle">{CATEGORIES.find((c) => c.id === l.category)?.label} · started {day(l.createdAt.toISOString())}</p>
                </div>
                <Link href={`/train/${l.id}`} className="text-ui text-fg-muted underline decoration-1 underline-offset-text hover:text-fg">Resume</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="start-title" className="page-grid mt-group gap-y-12">
        <div className="col-span-4 sm:col-span-8 lg:col-span-6">
          <h2 id="start-title" className="text-display-m text-fg">Start a practice</h2>
          <div className="mt-6"><StartPractice defaultCategory={preferred} /></div>
        </div>
        <aside className="col-span-4 sm:col-span-8 lg:col-span-5 lg:col-start-8">
          <h2 className="text-ui font-medium text-fg">How a practice runs</h2>
          <ol className="mt-3 border-t border-line text-ui">
            {[
              ["Answer", "One question, no hints."],
              ["One note", "The single change that matters most, quoted from your answer."],
              ["Try again", "Same question, in your own words. Up to two retries, with a little more help each time."],
              ["A new question", "A different situation that needs the same skill. It isn't announced."],
              ["Later", "A review on another day, with a different question again."],
            ].map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 border-b border-line py-3">
                <span className="text-fg-subtle">{i + 1}</span>
                <span><span className="text-fg">{t}.</span> <span className="text-fg-muted">{d}</span></span>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section aria-labelledby="history-title" className="mt-section">
        <h2 id="history-title" className="text-display-m text-fg">What you&apos;ve shown</h2>
        <p className="mt-2 max-w-lead text-ui text-fg-muted">Three things are kept apart: improving on the same question, carrying it to a new one, and holding it after a delay. Each is based only on answers there was enough evidence to judge.</p>
        {assessed.length ? (
          <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label="What you've shown, by skill">
            <table className="w-full min-w-[40rem] text-left text-ui">
              <thead><tr className="border-b border-line text-meta text-fg-subtle">
                <th scope="col" className="pb-2 pr-4 font-normal">Skill</th><th scope="col" className="pb-2 pr-4 font-normal">Same question</th>
                <th scope="col" className="pb-2 pr-4 font-normal">New question</th><th scope="col" className="pb-2 pr-4 font-normal">After a delay</th><th scope="col" className="pb-2 font-normal">Evidence</th>
              </tr></thead>
              <tbody>{assessed.map((s) => <Row key={s.competencyId} s={s} />)}</tbody>
            </table>
          </div>
        ) : <p className="mt-6 border-t border-line pt-4 text-ui text-fg-muted">Nothing assessed yet. Your first practice starts the record.</p>}
        {unassessed.length > 0 && (
          <p className="mt-6 text-ui text-fg-subtle">Not assessed yet: {unassessed.map((s) => s.label.toLowerCase()).join(", ")}.</p>
        )}
      </section>
    </div>
  );
}

function Row({ s }: { s: SkillState }) {
  return (
    <tr className="border-b border-line align-top">
      <th scope="row" className="py-3 pr-4 font-normal text-fg">{s.label}</th>
      <td className="py-3 pr-4">{said(s.improvedOnRetry, "Improved", "Not yet")}</td>
      <td className="py-3 pr-4">{said(s.transferred, "Carried over", "Not yet")}</td>
      <td className="py-3 pr-4">{s.retained.outcome !== "not_assessed" ? said(s.retained, "Held", "Not yet") : s.nextReviewAt ? <span className="text-fg-muted">Review {day(s.nextReviewAt)}</span> : <span className="text-fg-subtle">Not assessed</span>}</td>
      <td className="py-3 text-fg-subtle">{s.evidence.judged} answer{s.evidence.judged === 1 ? "" : "s"} judged{s.evidence.lowConfidence ? `, ${s.evidence.lowConfidence} with low confidence` : ""}</td>
    </tr>
  );
}
