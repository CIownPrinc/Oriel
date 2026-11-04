import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listSessions, sessionInterviewers } from "@/server/queries";
import { Badge } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { relDate, TYPE_LABEL } from "@/lib/format";
import { callName } from "@/lib/avatar/style";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StartInterview } from "@/components/app/StartInterview";

export const metadata = { title: "Playback" };

/** Every session as a ruled list: Oriel's one-line verdict (in its serif voice), then the facts. */
export default async function PlaybackIndex() {
  const user = await requireUser();
  const sessions = await listSessions(user.id);
  const ivs = await sessionInterviewers(sessions.map((s) => s.id));
  return (
    <div>
      <PageHeader title="Every session, with evidence." lead="Your recording, the moments that mattered and what to change, for every interview you finish."
        action={sessions.length > 0 ? <ButtonLink href="/practice" variant="secondary" size="lg">New interview</ButtonLink> : undefined} />
      {sessions.length === 0 && <EmptyState className="mt-group" title="No sessions yet." body="Your first interview sets the baseline everything after is measured against." action={<StartInterview userId={user.id} />} />}
      <ul className={sessions.length ? "mt-group border-t border-line" : "hidden"}>
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
