import { requireUser } from "@/lib/auth/session";
import { progressSummary, listSessions } from "@/server/queries";
import { PROGRESS_METRICS } from "@/lib/practice/progress";
import { ButtonLink } from "@/components/ui/Button";
import { Sparkline } from "@/components/app/Sparkline";

export const metadata = { title: "Progress" };

/**
 * You against you: one table, one row per measure. First session, latest, the baseline, and the
 * whole history as a small trend line in the row itself, so nothing is said twice.
 */
export default async function ProgressPage() {
  const user = await requireUser();
  const { history, latest, first, baseline } = await progressSummary(user.id);
  const sessions = await listSessions(user.id, 200);
  if (history.length === 0) {
    return (
      <header className="max-w-[40rem]">
        <h1 className="text-display-l text-fg">Your baseline starts with your first session.</h1>
        <p className="mt-5 text-body-l text-fg-muted">Every session after that is measured against you, never against other people.</p>
        <ButtonLink href="/practice" size="lg" className="mt-8">Start practice</ButtonLink>
      </header>
    );
  }
  const rows = PROGRESS_METRICS.map((m) => {
    const series = history.map((h) => h.metrics[m.key]).filter((v): v is number => typeof v === "number");
    const a = first?.metrics[m.key] ?? null, b = latest?.metrics[m.key] ?? null;
    const better = history.length > 1 && a != null && b != null && (m.better === "lower" ? b < a : m.better === "higher" ? b > a : Math.abs(b - (m.target ?? 0)) < Math.abs(a - (m.target ?? 0)));
    return { m, series, a, b, better, base: baseline[m.key] ?? null };
  }).filter((r) => r.series.length || r.a != null || r.b != null);
  const completed = sessions.filter((s) => s.status === "ended").length;

  return (
    <div>
      <header className="max-w-[44rem]">
        <h1 className="text-display-l text-fg">{history.length > 1 ? "You against you." : "Baseline set."}</h1>
        <p className="mt-5 text-body-l text-fg-muted">{history.length} analyzed session{history.length > 1 ? "s" : ""}. Comparisons are always with your own history, never other people.</p>
      </header>

      <table className="mt-[var(--spacing-group)] w-full text-left">
        <thead>
          <tr className="border-b border-line text-meta text-fg-subtle">
            <th scope="col" className="pb-2 font-normal">Measure</th>
            <th scope="col" className="pb-2 font-normal">First session</th>
            <th scope="col" className="pb-2 font-normal">Latest</th>
            <th scope="col" className="hidden pb-2 font-normal md:table-cell">Baseline</th>
            <th scope="col" className="hidden pb-2 font-normal sm:table-cell"><span className="sr-only">Trend over </span>Every session</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ m, series, a, b, better, base }) => (
            <tr key={m.key} className="border-b border-line">
              <th scope="row" className="py-4 pr-4 align-top font-normal">
                <span className="block text-ui font-medium text-fg">{m.label}</span>
                <span className="mt-0.5 block text-meta text-fg-subtle">{m.better === "lower" ? "Lower is better" : m.better === "higher" ? "Higher is better" : `Aim for about ${m.target}`}</span>
              </th>
              <td className="py-4 pr-4 align-top text-ui text-fg-subtle">{a == null ? "n/a" : m.format(a)}</td>
              <td className="py-4 pr-4 align-top">
                <span className="block text-ui text-fg">{b == null ? "n/a" : m.format(b)}</span>
                {better && <span className="mt-0.5 block text-meta font-medium text-success">Better</span>}
              </td>
              <td className="hidden py-4 pr-4 align-top text-ui text-fg-subtle md:table-cell">{base == null ? <span className="text-meta">After two sessions</span> : m.format(base)}</td>
              <td className="hidden w-[38%] py-4 align-middle sm:table-cell">
                {series.length > 1 ? <Sparkline values={series} baseline={base} better={m.better} className="h-10 w-full max-w-[22rem]" /> : <span className="text-meta text-fg-subtle">One session so far</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 max-w-[44rem] text-ui text-fg-muted">{completed} completed session{completed === 1 ? "" : "s"} in total. The dashed line is your baseline. Camera engagement is an estimate and only appears when camera signals were on.</p>
    </div>
  );
}
