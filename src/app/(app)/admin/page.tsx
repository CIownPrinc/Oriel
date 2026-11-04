import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { adminOverview } from "@/server/admin";
import { providerStatus } from "@/lib/ai/providers/registry";
import { Card, Badge } from "@/components/ui/Card";
import { trainingEvidence, type EvidenceCell } from "@/server/training/service";

export const metadata = { title: "Admin" };

const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);

export default async function AdminPage() {
  await requireAdmin();
  const o = await adminOverview();
  const ps = providerStatus();
  const total = o.sessions.reduce((a, s) => a + s.usd, 0);
  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-display-l text-fg">Admin</h1>
        <p className="mt-3 text-body-l text-fg-muted">Providers, latency, cost and errors across recent sessions.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-meta">
          <Badge tone={ps.llmMock ? "warn" : "good"}>LLM: {ps.llm}</Badge><Badge tone={ps.ttsMock ? "warn" : "good"}>TTS: {ps.tts}</Badge><Badge tone={ps.sttMock ? "warn" : "good"}>STT: {ps.stt}</Badge><Badge>Avatar: local WebGL (managed vendor not configured)</Badge>
          {o.jobs.map((j) => <Badge key={j.status}>jobs {j.status}: {j.n}</Badge>)}
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-ui font-medium text-fg">Latency (measured)</h2>
          <div className="overflow-x-auto"><table className="mt-4 w-full min-w-[420px] text-ui">
            <thead className="text-left text-meta text-fg-subtle"><tr><th className="pb-2 font-normal">Stage</th><th className="font-normal">n</th><th className="font-normal">p50</th><th className="font-normal">p90</th></tr></thead>
            <tbody className="">
              {o.latencySummary.map((l) => <tr key={l.name} className="border-t border-line"><td className="py-2 pr-4 font-sans text-fg">{l.name}</td><td className="pr-3">{l.n}</td><td className="whitespace-nowrap pr-3">{l.p50 === null ? "—" : `${l.p50} ms`}</td><td className="whitespace-nowrap">{l.p90 === null ? "—" : `${l.p90} ms`}</td></tr>)}
            </tbody>
          </table></div>
          <p className="mt-3 text-meta text-fg-subtle">Target conversational latency ≈ 1,200 ms (business plan budget: endpointing 250 · LLM 400 · voice 150 · avatar 300 · network 100). Endpointing silence is added on top of these server figures.</p>
        </Card>
        <Card className="p-6">
          <h2 className="text-ui font-medium text-fg">Cost by provider</h2>
          <div className="overflow-x-auto"><table className="mt-4 w-full min-w-[420px] text-ui">
            <thead className="text-left text-meta text-fg-subtle"><tr><th className="pb-2 font-normal">Category</th><th className="font-normal">Provider</th><th className="font-normal">Units</th><th className="font-normal text-right">USD</th></tr></thead>
            <tbody>
              {o.costByCategory.map((c, i) => <tr key={i} className="border-t border-line"><td className="py-2">{c.category}</td><td className="text-meta text-fg-muted">{c.provider}</td><td className="text-meta">{Math.round(c.units)} {c.unit}</td><td className="text-right">{usd(c.usd)}</td></tr>)}
            </tbody>
          </table></div>
          <p className="mt-3 text-ui text-fg-muted">Total across listed sessions: {usd(total)}</p>
        </Card>
      </section>

      <section>
        <h2 className="text-ui font-medium text-fg">Sessions</h2>
        <div className="mt-4 overflow-x-auto rounded-control border border-line">
          <table className="w-full min-w-[800px] text-ui">
            <thead className="text-left text-meta text-fg-subtle"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-normal"><th>When</th><th>User</th><th>Role</th><th>Mode</th><th>Status</th><th>Analysis</th><th>Degraded</th><th className="text-right">Cost</th></tr></thead>
            <tbody>
              {o.sessions.map((s) => (
                <tr key={s.id} className="border-t border-line hover:bg-surface [&>td]:px-4 [&>td]:py-3">
                  <td><Link href={`/admin/sessions/${s.id}`} className="text-fg underline-offset-4 hover:underline">{s.createdAt.toLocaleString()}</Link></td>
                  <td className="text-fg-muted">{s.email}</td><td>{s.role}</td><td>{s.mode} · p{s.pressure}</td><td>{s.status}</td>
                  <td><Badge tone={s.analysis === "complete" ? "good" : s.analysis === "failed" ? "bad" : "neutral"}>{s.analysis}</Badge></td>
                  <td className="text-fg-subtle">{s.degraded ?? "—"}</td><td className="text-right">{usd(s.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <TrainEvidence />

      <section>
        <h2 className="text-ui font-medium text-fg">Recent errors &amp; fallbacks</h2>
        <ul className="mt-4 divide-y divide-line rounded-control border border-line text-ui">
          {o.errors.length ? o.errors.map((e) => <li key={e.id} className="px-5 py-3"><span className="text-meta text-fg-subtle">{e.createdAt.toLocaleString()}</span> <Badge tone={e.type === "error" ? "bad" : "warn"}>{e.type}</Badge> <span className="text-fg">{e.name}</span> <span className="text-meta text-fg-subtle">{JSON.stringify(e.data).slice(0, 220)}</span></li>) : <li className="px-5 py-4 text-fg-subtle">None.</li>}
        </ul>
      </section>
    </div>
  );
}

/** A rate only when there are enough cases to say anything; otherwise the count alone. */
function rate(c: EvidenceCell) {
  if (c.n === 0) return <span className="text-fg-subtle">no cases yet</span>;
  if (c.n < 5) return <span className="text-fg-muted">{c.yes} of {c.n} <span className="text-fg-subtle">(too few for a rate)</span></span>;
  return <span className="text-fg">{Math.round((c.yes / c.n) * 100)}% <span className="text-fg-subtle">({c.yes} of {c.n})</span></span>;
}

/** Whether the practice loop is associated with transfer and retention. Observational, not causal. */
async function TrainEvidence() {
  const t = await trainingEvidence();
  const rows: [string, EvidenceCell][] = [
    ["Carried to a new question, when the retry improved", t.transferAfterImproved],
    ["Carried to a new question, when the retry didn't improve", t.transferAfterNotImproved],
    ["Held at review, after it carried over", t.retainedAfterTransfer],
    ["Held at review, after it didn't carry over", t.retainedAfterNoTransfer],
  ];
  return (
    <section>
      <h2 className="text-ui font-medium text-fg">Train: is it working?</h2>
      <p className="mt-2 max-w-[48rem] text-meta text-fg-muted">{t.loops} completed practice loops. People choose what to practise and when to come back, so these are associations, not effects; a real test needs a comparison group. Answers judged by the model: {t.evaluators.model}; by pattern rules: {t.evaluators.pattern}; not assessable: {t.evaluators.insufficient}.</p>
      <table className="mt-4 w-full max-w-[48rem] text-left text-ui">
        <tbody>{rows.map(([k, c]) => <tr key={k} className="border-t border-line"><th scope="row" className="py-2.5 pr-4 font-normal text-fg-muted">{k}</th><td className="py-2.5">{rate(c)}</td></tr>)}</tbody>
      </table>
    </section>
  );
}
