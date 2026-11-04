import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listSessions, sessionInterviewers } from "@/server/queries";
import { Badge } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { relDate, TYPE_LABEL } from "@/lib/format";
import { callName } from "@/lib/avatar/style";

export const metadata = { title: "Playback" };

/** Every session as a ruled list: Oriel's one-line verdict (in its serif voice), then the facts. */
export default async function PlaybackIndex() {
  const user = await requireUser();
  const sessions = await listSessions(user.id);
  const ivs = await sessionInterviewers(sessions.map((s) => s.id));
  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="max-w-lead">
          <h1 className="text-display-l text-fg">Every session, with evidence<span className="text-accent">.</span></h1>
          <p className="mt-5 text-body-l text-fg-muted">Your recording, the moments that mattered and what to change, for every interview you finish.</p>
        </div>
        <ButtonLink href="/practice" size="lg">New session</ButtonLink>
      </header>
      <ul className="mt-group border-t border-line">
        {sessions.length === 0 && <li className="border-b border-line py-8 text-ui text-fg-muted">No sessions yet. Your first one sets your baseline.</li>}
        {sessions.map((s) => (
          <li key={s.id} className="border-b border-line">
            <Link href={s.status === "ended" ? `/playback/${s.id}` : `/room/${s.id}`} className="-mx-3 grid gap-2 rounded-control px-3 py-5 transition-colors duration-press hover:bg-surface sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-8">
              <div className="min-w-0">
                <p className="font-display text-body-l text-fg">{s.summary?.headline ?? `${s.role} · ${TYPE_LABEL[s.type] ?? s.type}`}</p>
                <p className="mt-1 text-ui text-fg-subtle">{relDate(s.createdAt)} · {s.role} · {TYPE_LABEL[s.type] ?? s.type} · with {(ivs.get(s.id) ?? []).map((i) => callName(i.name, i.style)).join(", ")} · pressure {s.pressure} of 5{s.ladderLevel ? ` · Ladder ${s.ladderLevel}` : ""}</p>
              </div>
              <div>{s.status !== "ended" ? <Badge tone="warn">Unfinished: rejoin</Badge> : s.analysisStatus === "complete" ? <Badge>Read ready</Badge> : s.analysisStatus === "failed" ? <Badge tone="bad">Analysis failed: retry</Badge> : <Badge>Analyzing</Badge>}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
