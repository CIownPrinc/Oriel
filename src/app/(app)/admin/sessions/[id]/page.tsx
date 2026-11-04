import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { adminSession } from "@/server/admin";
import { Card, Badge } from "@/components/ui/Card";
import { RetryButton } from "@/components/admin/RetryButton";
import { mmss } from "@/lib/format";

export const metadata = { title: "Admin · session" };

export default async function AdminSessionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const d = await adminSession(id);
  if (!d) notFound();
  const total = d.costs.reduce((a, c) => a + c.usd, 0);
  const byCat = Object.entries(d.costs.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.category]: (acc[c.category] ?? 0) + c.usd }), {}));
  const answersByQ = new Map(d.answers.map((a) => [a.questionId, a]));
  return (
    <div className="space-y-10">
      <Link href="/admin" className="text-ui text-fg-subtle hover:text-fg">← Admin</Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-m text-fg">{d.interview.role} · {d.interview.mode} · pressure {d.interview.pressure}</h1>
          <p className="mt-1 text-meta text-fg-subtle">Session {id}</p>
          <div className="mt-3 flex flex-wrap gap-2"><Badge>{d.session.status}</Badge><Badge tone={d.session.analysisStatus === "complete" ? "good" : d.session.analysisStatus === "failed" ? "bad" : "neutral"}>analysis {d.session.analysisStatus}</Badge><Badge>llm {d.session.llmProvider}</Badge><Badge>tts {d.session.ttsProvider}</Badge><Badge>avatar {d.session.avatarProvider ?? "—"}</Badge>{d.signals.map((s) => <Badge key={s.kind}>{s.kind} batches {s.n}</Badge>)}</div>
          {d.session.analysisError && <p className="mt-2 text-meta text-danger">{d.session.analysisError}</p>}
        </div>
        <RetryButton sessionId={id} />
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="p-5"><h2 className="text-ui font-medium text-fg">Cost record</h2><p className="mt-2 text-body-l text-fg">${total.toFixed(4)}</p><ul className="mt-3 space-y-1 text-ui text-fg-muted">{byCat.map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span>${v.toFixed(4)}</li>)}</ul></Card>
        <Card className="p-5"><h2 className="text-ui font-medium text-fg">Pipeline</h2>{d.jobs.map((j) => <div key={j.id} className="mt-2 text-ui"><p>{j.status} · attempts {j.attempts}</p>{j.error && <p className="text-meta text-danger">{j.error}</p>}<ul className="mt-2 space-y-0.5 text-meta text-fg-subtle">{Object.entries(j.stepTimings ?? {}).map(([k, v]) => <li key={k}>{k}: {v}ms</li>)}</ul></div>)}</Card>
        <Card className="p-5"><h2 className="text-ui font-medium text-fg">Memory ledger (claims)</h2><ul className="mt-2 space-y-1 text-ui">{d.claims.map((c) => <li key={c.id}><Badge tone={c.status === "weak" ? "warn" : c.status === "probed" ? "accent" : c.status === "supported" ? "good" : "neutral"}>{c.status}</Badge> <span className="text-fg-muted">#{c.answerSeq} {c.text}</span></li>)}</ul></Card>
      </section>

      <section>
        <h2 className="text-ui font-medium text-fg">Conversation &amp; interviewer decisions</h2>
        <ol className="mt-4 space-y-3">
          {d.questions.map((q) => {
            const a = answersByQ.get(q.id);
            return (
              <li key={q.id} className="rounded-control border border-line p-5 text-ui">
                <p className="text-meta text-fg-subtle">{mmss(q.askedAtMs)} · {q.kind} · {q.competency ?? "—"} · difficulty {q.difficulty}</p>
                <p className="mt-1 text-fg-muted">Decision: {q.decisionReason}</p>
                <p className="mt-2 text-fg">Q: {q.text}</p>
                {a && <div className="mt-3 border-t border-line pt-3"><p className="text-fg-muted">A ({a.inputMode}{a.interrupted ? ", interrupted" : ""}, first word {a.firstWordLatencyMs ?? "—"}ms): {a.text}</p>{a.serverText && a.serverText !== a.text && <p className="mt-1 text-fg-subtle">Server transcript: {a.serverText}</p>}<p className="mt-1 text-meta text-fg-subtle">flags {JSON.stringify(a.flags)}</p>{a.analysis && <p className="mt-1 text-meta text-fg-subtle">analyzer {JSON.stringify(a.analysis).slice(0, 400)}</p>}</div>}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><h2 className="text-ui font-medium text-fg">Metrics &amp; confidence</h2><ul className="mt-3 space-y-1.5 text-ui">{d.metrics.map((m) => <li key={m.id} className="flex justify-between gap-4"><span>{m.key}</span><span className="text-fg-muted">{m.value ?? "—"} {m.unit} [{m.low ?? "·"}–{m.high ?? "·"}] · {m.confidence}</span></li>)}</ul></Card>
        <Card className="p-5"><h2 className="text-ui font-medium text-fg">Playback generation</h2><ul className="mt-3 space-y-3 text-ui">{d.clips.map((c) => <li key={c.id}><p className="text-meta text-fg-subtle">{mmss(c.startMs)}–{mmss(c.endMs)} · {c.signal} · {c.confidence} · {c.source}</p><p className="text-fg">{c.title}</p><p className="text-fg-muted">{c.observed}</p><p className="text-fg-muted">{c.suggestion}</p></li>)}</ul></Card>
      </section>

      <section>
        <h2 className="text-ui font-medium text-fg">Event log (decisions, latency, AI outputs, errors)</h2>
        <ol className="mt-4 max-h-[600px] overflow-y-auto rounded-control border border-line text-meta">
          {d.events.map((e) => <li key={e.id} className="border-b border-line px-4 py-2"><span className="text-fg-subtle">{e.createdAt.toLocaleTimeString()}</span> <span className={e.type === "error" ? "text-danger" : e.type === "fallback" ? "text-warning" : e.type === "latency" ? "text-success" : "text-fg-muted"}>{e.type}</span> {e.name} {e.durationMs !== null ? `${e.durationMs}ms` : ""} <span className="text-fg-subtle">{JSON.stringify(e.data).slice(0, 500)}</span></li>)}
        </ol>
      </section>
    </div>
  );
}
