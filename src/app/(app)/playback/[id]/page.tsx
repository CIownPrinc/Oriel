import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { firstComparableAnswer, sessionDetail } from "@/server/queries";
import { Processing } from "@/features/playback/Processing";
import { PlaybackView, type PlaybackData } from "@/features/playback/PlaybackView";
import { PROGRESS_METRICS, compare, recommendDrill } from "@/lib/practice/progress";
import { getDrill } from "@/lib/practice/catalog";
import { canUsePlayback } from "@/lib/billing/entitlements";
import { loadEntitlementContext } from "@/lib/billing/entitlement-context";
import { PANEL_ROLE_LABEL, type PanelRole } from "@/lib/interview/personas";
import { longDate, TYPE_LABEL } from "@/lib/format";
import type { PostureEvent } from "@/lib/analysis/read";
import { callName } from "@/lib/avatar/style";
import { lessonsFor } from "@/server/lessons";
import { summarize } from "@/components/app/lessons";

export const metadata = { title: "Playback" };

export default async function PlaybackPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; clip?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const d = await sessionDetail(id, user.id);
  if (!d) notFound();
  if (d.session.analysisStatus !== "complete") return <Processing sessionId={id} initialStatus={d.session.analysisStatus} />;

  const metricVal = Object.fromEntries(d.metrics.map((m) => [m.key, m.value]));
  const rec = recommendDrill(metricVal);
  const drill = getDrill(rec.drillId)!;
  const ivById = new Map(d.interviewers.map((i) => [i.id, i]));
  const questionById = new Map(d.questions.map((q) => [q.id, q]));
  const summary = d.session.summary;
  const rewriteQ = summary?.rewrittenAnswer ? questionById.get(summary.rewrittenAnswer.questionId) : null;
  // Side-by-side: this session's strongest-signal primary answer vs the first session's answer in the same competency.
  const primary = d.answers.map((a) => ({ a, q: questionById.get(a.questionId) })).find((x) => x.q?.kind === "primary" && x.a.text.split(" ").length > 30);
  const first = primary ? await firstComparableAnswer(user.id, primary.q!.competency, id) : null;
  const firstIsEarlier = first && first.createdAt < d.session.createdAt;
  const movement = d.metrics.find((m) => m.key === "movement");
  const competencies = d.metrics.find((m) => m.key === "competencies")?.detail?.competencies as Record<string, { label: string; answers: number; avgQuality: number }> | undefined;
  const cmp = d.snapshot && Object.values(d.snapshot.baseline).some((v) => v !== null) ? compare(d.snapshot.metrics, d.snapshot.baseline) : [];
  const fmt = (k: string, v: number | null) => (v === null ? null : PROGRESS_METRICS.find((m) => m.key === k)!.format(v));
  const names = d.interviewers.map((i) => callName(i.displayName, i.avatarStyle)).join(", ");

  const data: PlaybackData = {
    sessionId: id,
    title: d.interview.role,
    subtitle: `${d.interview.role} · ${TYPE_LABEL[d.interview.type] ?? d.interview.type} · ${d.interview.mode === "panel" ? `panel with ${names}` : `with ${names}`} · pressure ${d.interview.pressure} of 5 · ${longDate(d.session.createdAt)}`,
    headline: summary?.headline ?? null,
    summarySource: summary?.source ?? null,
    strengths: summary?.strengths ?? [],
    focus: summary?.focus ?? [],
    rewrite: summary?.rewrittenAnswer && rewriteQ ? { question: rewriteQ.text, original: summary.rewrittenAnswer.original, rewritten: summary.rewrittenAnswer.rewritten, note: summary.rewrittenAnswer.note } : null,
    comparison: primary && first && firstIsEarlier ? { question: primary.q!.text, first: first.answer, latest: primary.a.text, firstDate: longDate(first.createdAt) } : null,
    media: d.media ? { parts: d.media.parts.map(({ url, mimeType, startMs }) => ({ url, mimeType, startMs })), expiresAt: d.media.expiresAt?.toISOString() ?? null } : null,
    mediaDeleted: d.mediaDeleted,
    durationMs: d.session.startedAt && d.session.endedAt ? d.session.endedAt.getTime() - d.session.startedAt.getTime() : Math.max(0, ...d.segments.map((s) => s.endMs)),
    clips: d.clips.map((c) => ({ id: c.id, startMs: c.startMs, endMs: c.endMs, title: c.title, observed: c.observed, suggestion: c.suggestion, confidence: c.confidence, questionText: c.questionText, transcript: c.transcript, signal: c.signal })),
    metrics: d.metrics.filter((m) => m.key !== "competencies").map((m) => ({
      key: m.key, label: (m.detail?.label as string) ?? m.key, value: m.value, low: m.low, high: m.high, unit: m.unit, confidence: m.confidence,
      targetLow: m.targetLow, targetHigh: m.targetHigh, note: (m.detail?.note as string) ?? "", detail: null,
    })),
    competencies: competencies ? Object.entries(competencies).map(([key, v]) => ({ key, ...v })) : [],
    posture: ((movement?.detail?.events as PostureEvent[] | undefined) ?? []).map((e) => ({ t: e.t, kind: e.kind, durationMs: e.durationMs })),
    transcript: d.segments.map((s) => {
      const iv = s.interviewerId ? ivById.get(s.interviewerId) : null;
      return { id: s.id, speaker: s.speaker, who: s.speaker === "candidate" ? "You" : iv ? `${callName(iv.displayName, iv.avatarStyle)}${iv.panelRole ? ` · ${PANEL_ROLE_LABEL[iv.panelRole as PanelRole]}` : ""}` : "Interviewer", text: s.text, startMs: s.startMs, endMs: s.endMs };
    }),
    questions: d.questions.map((q) => ({ id: q.id, startMs: q.askedAtMs, kind: q.kind })),
    recommendedDrill: { id: drill.id, title: drill.title, reason: rec.reason },
    playbackLevel: canUsePlayback(await loadEntitlementContext(user.id)).level,
    comparisonToBaseline: cmp.map((c) => ({ label: c.label, current: fmt(c.key, c.current), baseline: fmt(c.key, c.baseline), improved: c.improved })),
    initialT: sp.t ? Number(sp.t) : null,
    initialClip: sp.clip ?? null,
    lessons: (await lessonsFor(user.id)).filter((l) => l.sourceSessionId === id && l.status !== "mastered")
      .map(summarize),
  };
  return <PlaybackView d={data} />;
}
