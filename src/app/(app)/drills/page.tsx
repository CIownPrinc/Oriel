import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/db/client";
import { DRILLS, type DrillDef } from "@/lib/practice/catalog";
import { recommendDrill } from "@/lib/practice/progress";
import { progressSummary } from "@/server/queries";
import { DrillCard } from "@/components/app/cards";
import { TRACKS } from "@/lib/lessons/library";
import type { Track } from "@/lib/lessons/types";
import { relDate } from "@/lib/format";

export const metadata = { title: "Drills" };

/** Drills sit in the same three tracks as lessons: what you say, how you sound, how you come across. */
const TRACK_OF: Record<DrillDef["targetMetric"], Track> = {
  opener_seconds: "responses", quantified_claims: "responses", structure_score: "responses", hedges_per_min: "responses", answer_seconds: "responses",
  filler_per_min: "delivery", pace_wpm: "delivery", vocal_variety: "delivery", recovery_ms: "delivery",
  camera_engagement: "presence", posture_upright: "presence",
};
const ORDER: Track[] = ["responses", "delivery", "presence"];

export default async function DrillsPage() {
  const user = await requireUser();
  const attempts = await getDb().select().from(schema.drillAttempts).where(eq(schema.drillAttempts.userId, user.id)).orderBy(desc(schema.drillAttempts.createdAt)).limit(50).all();
  const { latest } = await progressSummary(user.id);
  const rec = recommendDrill(latest?.metrics ?? {});
  const last = (id: string) => {
    const a = attempts.find((x) => x.drillId === id);
    if (!a) return null;
    const unit = (a.result as { unit?: string } | null)?.unit ?? "";
    return `${a.value ?? "—"} ${unit}${a.passed ? ", target met" : ""}`.trim();
  };
  const recommended = DRILLS.find((d) => d.id === rec.drillId);
  return (
    <div>
      <header className="max-w-[44rem]">
        <h1 className="text-display-l text-fg">Five minutes on one thing.</h1>
        <p className="mt-5 text-body-l text-fg-muted">Each drill has one objective, one measurement and your own baseline to beat.</p>
      </header>

      {recommended && (
        <section className="page-grid mt-[var(--spacing-group)] gap-y-5 border-t border-line pt-10">
          <h2 className="col-span-4 text-ui font-medium text-fg sm:col-span-8 lg:col-span-3">Recommended for you</h2>
          <div className="col-span-4 max-w-[36rem] sm:col-span-8 lg:col-span-9"><DrillCard drill={recommended} recommended={rec.reason} lastValue={last(recommended.id)} /></div>
        </section>
      )}

      <div className="mt-14 grid gap-x-6 gap-y-12 lg:grid-cols-3">
        {ORDER.map((t) => (
          <section key={t}>
            <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
              <h2 className="text-display-m text-fg">{TRACKS[t].label}</h2>
              <span className="text-meta text-fg-subtle">{TRACKS[t].blurb}</span>
            </div>
            <div className="mt-2">
              {DRILLS.filter((d) => TRACK_OF[d.targetMetric] === t && d.id !== recommended?.id).map((d) => <DrillCard key={d.id} drill={d} lastValue={last(d.id)} />)}
            </div>
          </section>
        ))}
      </div>

      {attempts.length > 0 && (
        <section className="mt-16">
          <h2 className="text-ui font-medium text-fg">Recent attempts</h2>
          <table className="mt-3 w-full text-left text-ui">
            <thead className="sr-only"><tr><th scope="col">Drill</th><th scope="col">Result</th><th scope="col">Baseline</th><th scope="col">Outcome</th><th scope="col">When</th></tr></thead>
            <tbody className="border-t border-line">
              {attempts.slice(0, 8).map((a) => (
                <tr key={a.id} className="border-b border-line">
                  <th scope="row" className="py-3 pr-4 font-normal text-fg">{DRILLS.find((d) => d.id === a.drillId)?.title}</th>
                  <td className="py-3 pr-4 text-fg-muted">{a.value ?? "—"} {(a.result as { unit?: string } | null)?.unit}</td>
                  <td className="hidden py-3 pr-4 text-fg-subtle sm:table-cell">{a.baselineValue !== null ? <>baseline {Math.round(a.baselineValue * 10) / 10}</> : "First attempt"}</td>
                  <td className={a.passed ? "py-3 pr-4 text-success" : "py-3 pr-4 text-fg-subtle"}>{a.passed ? "Target met" : a.passed === false ? "Not yet" : ""}</td>
                  <td className="py-3 text-right text-fg-subtle">{relDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
