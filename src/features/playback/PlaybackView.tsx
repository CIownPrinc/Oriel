"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlaybackClipCard } from "@/components/app/cards";
import { ConfidenceMark } from "@/components/ui/Metric";
import { Badge } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/components/ui/cn";
import { mmss } from "@/lib/format";
import { LessonCard, type LessonSummary } from "@/components/app/lessons";
import { POSTURE_LABEL, type PostureKind } from "@/lib/analysis/posture";
import type { Confidence } from "@/db/schema";
import { partAt } from "@/lib/playback/parts";

export interface PlaybackData {
  sessionId: string;
  title: string;
  subtitle: string;
  headline: string | null;
  summarySource: string | null;
  strengths: string[];
  focus: string[];
  rewrite: { question: string; original: string; rewritten: string; note: string } | null;
  comparison: { question: string; first: string; latest: string; firstDate: string } | null;
  /** The recording, in parts on the session clock (a new part starts each time the Room was rejoined). */
  media: { parts: { url: string; mimeType: string; startMs: number }[]; expiresAt: string | null } | null;
  mediaDeleted: boolean;
  durationMs: number;
  clips: { id: string; startMs: number; endMs: number; title: string; observed: string; suggestion: string; confidence: Confidence; questionText: string; transcript: string; signal: string }[];
  metrics: { key: string; label: string; value: number | null; low: number | null; high: number | null; unit: string; confidence: Confidence; targetLow: number | null; targetHigh: number | null; note: string; detail: Record<string, unknown> | null }[];
  competencies: { key: string; label: string; answers: number; avgQuality: number }[];
  posture: { t: number; kind: PostureKind; durationMs: number }[];
  transcript: { id: string; speaker: "candidate" | "interviewer"; who: string; text: string; startMs: number; endMs: number; kind?: string }[];
  questions: { id: string; startMs: number; kind: string }[];
  recommendedDrill: { id: string; title: string; reason: string };
  playbackLevel: "basic" | "full";
  comparisonToBaseline: { label: string; current: string | null; baseline: string | null; improved: boolean | null }[];
  initialT: number | null;
  initialClip: string | null;
  lessons: LessonSummary[];
}

const POSTURE_COLOR: Record<PostureKind, string> = {
  slouch: "bg-warning/80", lean_in: "bg-accent", lean_back: "bg-fg-muted/60", fidget: "bg-fg-subtle/50", off_frame: "bg-line-strong",
};

const METRIC_ORDER = ["pace_wpm", "filler_per_min", "pauses", "hedges_per_min", "structure_score", "specificity", "recovery_ms", "vocal_variety", "camera_engagement", "movement", "setup"];

export function PlaybackView({ d }: { d: PlaybackData }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [activeClip, setActiveClip] = useState<string | null>(d.initialClip);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(d.durationMs / 1000);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const parts = useMemo(() => d.media?.parts ?? [], [d.media]);
  const [partIndex, setPartIndex] = useState(0);
  const part = parts[partIndex] ?? null;
  // A seek into another part waits for that part's metadata before setting the position.
  const pendingSeek = useRef<{ ms: number; play: boolean } | null>(null);

  const placeInPart = useCallback((v: HTMLVideoElement, startMs: number, ms: number, play: boolean) => {
    v.currentTime = Math.max(0, (ms - startMs) / 1000);
    if (play) void v.play().catch(() => {});
  }, []);

  const seek = useCallback((ms: number, play = true) => {
    const v = video.current;
    if (!v || !parts.length) return;
    const target = partAt(parts, ms);
    v.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target !== partIndex) {
      pendingSeek.current = { ms, play };
      setPartIndex(target);
      return;
    }
    placeInPart(v, parts[target].startMs, ms, play);
  }, [parts, partIndex, placeInPart]);

  useEffect(() => {
    const v = video.current;
    if (!v || d.initialT === null) return;
    const go = () => seek(d.initialT!, false);
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
  }, [d.initialT, seek]);

  // MediaRecorder WebM files have no duration header; fall back to the session length.
  const onMeta = () => {
    const v = video.current;
    if (!v || !part) return;
    if (parts.length === 1 && Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    const pending = pendingSeek.current;
    pendingSeek.current = null;
    if (pending) placeInPart(v, part.startMs, pending.ms, pending.play);
  };

  // When one part ends, carry on with the next, as one continuous recording.
  const onEnded = () => {
    if (partIndex >= parts.length - 1) return;
    pendingSeek.current = { ms: parts[partIndex + 1].startMs, play: true };
    setPartIndex(partIndex + 1);
  };

  const metrics = useMemo(() => [...d.metrics].sort((a, b) => METRIC_ORDER.indexOf(a.key) - METRIC_ORDER.indexOf(b.key)), [d.metrics]);
  const tl = Math.max(duration * 1000, d.durationMs, 1);

  async function del() {
    setDeleting(true);
    await fetch(`/api/sessions/${d.sessionId}`, { method: "DELETE" });
    router.push("/playback");
    router.refresh();
  }

  const groups = grouped(metrics);
  const baseline = d.comparisonToBaseline.filter((c) => c.baseline !== null && c.current !== null);

  return (
    <article>
      {/* The assessment as the title; the session it describes as its byline. */}
      <header className="pb-group">
        <h1 className="max-w-[28ch] text-display-l text-fg">{d.headline ?? "Your feedback"}</h1>
        <p className="mt-5 max-w-column text-ui text-fg-muted">{d.subtitle}</p>
        {d.summarySource === "heuristic" && <p className="mt-2 text-meta text-fg-subtle">Coaching generated from measurements (no language model configured).</p>}
      </header>

      {/* At a glance: where you stand, and what to do about it. */}
      <section aria-label="At a glance" className="page-grid gap-y-12">
        <div className="col-span-4 sm:col-span-8 lg:col-span-7">
          <h2 className="text-ui font-medium text-fg">Where you stand</h2>
          <Breakdown metrics={metrics} />
          {baseline.length > 0 && (
            <table className="mt-8 w-full text-left">
              <caption className="pb-2 text-left text-ui font-medium text-fg">Against your baseline</caption>
              <thead><tr className="border-b border-line text-meta text-fg-subtle"><th scope="col" className="pb-2 font-normal">Measure</th><th scope="col" className="pb-2 font-normal">This session</th><th scope="col" className="pb-2 font-normal">Baseline</th><th scope="col" className="pb-2 text-right font-normal">Change</th></tr></thead>
              <tbody>
                {baseline.map((c) => (
                  <tr key={c.label} className="border-b border-line">
                    <th scope="row" className="py-2.5 pr-4 text-ui font-normal text-fg">{c.label}</th>
                    <td className="py-2.5 pr-4 text-ui text-fg">{c.current}</td>
                    <td className="py-2.5 pr-4 text-ui text-fg-subtle">{c.baseline}</td>
                    <td className={cn("py-2.5 text-right text-meta font-medium", c.improved ? "text-success" : "text-fg-subtle")}>{c.improved ? "Better" : c.improved === false ? "Not yet" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="col-span-4 sm:col-span-8 lg:col-span-5 lg:col-start-8">
          <h2 className="text-ui font-medium text-fg">Next steps</h2>
          {d.focus.length > 0 ? (
            <ol className="mt-3 border-t border-line">
              {d.focus.slice(0, 3).map((f, i) => (
                <li key={f} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-baseline border-b border-line py-3.5">
                  <span className="font-display text-body-l text-fg-subtle">{i + 1}</span>
                  <span className="text-ui text-fg">{f}</span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-3 border-t border-line pt-3 text-ui text-fg-muted">{d.recommendedDrill.reason}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href={`/drills/${d.recommendedDrill.id}?from=${d.sessionId}`}>Drill: {d.recommendedDrill.title}</ButtonLink>
            <ButtonLink href="/practice" variant="secondary">New interview</ButtonLink>
          </div>
          {d.strengths.length > 0 && (
            <div className="mt-10">
              <h3 className="text-ui font-medium text-fg">What worked</h3>
              <ul className="mt-3 space-y-2 border-t border-line pt-3 text-ui text-fg-muted">{d.strengths.map((x) => <li key={x} className="flex gap-2.5"><span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-fg-subtle" aria-hidden />{x}</li>)}</ul>
            </div>
          )}
        </div>
      </section>

      {/* The recording, and the moments in it worth watching. */}
      <section className="pt-20">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 className="text-display-m text-fg">Key moments</h2>
          {d.playbackLevel === "basic" && <Badge>Basic Playback</Badge>}
        </div>
        <div className="page-grid gap-y-8">
          <div className="col-span-4 sm:col-span-8 lg:col-span-7">
            {part && !mediaError ? (
              <div className="relative overflow-hidden rounded-panel bg-surface">
                <video ref={video} src={part.url} controls playsInline preload="metadata" onLoadedMetadata={onMeta} onEnded={onEnded}
                  onTimeUpdate={(e) => setTime(part.startMs / 1000 + e.currentTarget.currentTime)} onError={() => setMediaError(true)}
                  className={cn("aspect-video w-full bg-page", part.mimeType.startsWith("audio") && "h-24 aspect-auto")} />
              </div>
            ) : (
              <p className="border-t border-line pt-4 text-ui text-fg-muted">
                <span className="text-fg">{d.mediaDeleted ? "The recording was deleted." : mediaError ? "The recording couldn't be loaded." : "No recording for this session."}</span>{" "}
                {d.mediaDeleted ? "Raw video is removed after your retention period; your transcript and feedback remain." : "The timeline still shows when each question and moment came; your transcript and feedback are below."}
              </p>
            )}
            {/* Timeline: questions, moments and posture shifts on the session clock. */}
            <div className="relative mt-4 h-9 select-none" aria-label="Session timeline">
              <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
              {d.questions.map((q) => (
                <button key={q.id} type="button" title={`Question at ${mmss(q.startMs)}`} onClick={() => seek(q.startMs)}
                  className={cn("absolute top-1/2 h-3 w-px -translate-y-1/2", ["pressure", "cross", "curveball", "memory_callback"].includes(q.kind) ? "bg-warning/80" : "bg-fg-subtle")} style={{ left: `${(q.startMs / tl) * 100}%` }} />
              ))}
              {d.posture.map((pz, i) => {
                const label = `${POSTURE_LABEL[pz.kind]} at ${mmss(pz.t)} for ${Math.round(pz.durationMs / 1000)} s`;
                return <button key={i} type="button" onClick={() => seek(pz.t)} title={label} aria-label={label}
                  className={cn("absolute top-[72%] h-1 transition-transform hover:scale-y-150", POSTURE_COLOR[pz.kind])} style={{ left: `${(pz.t / tl) * 100}%`, width: `${Math.max(0.4, (pz.durationMs / tl) * 100)}%` }} />;
              })}
              {d.clips.map((c) => (
                <button key={c.id} type="button" onClick={() => { setActiveClip(c.id); seek(c.startMs); }} title={`${mmss(c.startMs)}: ${c.title}`} aria-label={`Jump to ${mmss(c.startMs)}: ${c.title}`}
                  className={cn("absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 transition-colors", activeClip === c.id ? "bg-accent" : "bg-fg-subtle hover:bg-accent")} style={{ left: `${(c.startMs / tl) * 100}%` }} />
              ))}
              <span className="absolute top-1/2 h-5 w-px -translate-y-1/2 bg-fg" style={{ left: `${Math.min(100, ((time * 1000) / tl) * 100)}%` }} />
            </div>
            <div className="flex justify-between text-meta text-fg-subtle"><span>00:00</span><span>{mmss(tl)}</span></div>
            {d.posture.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-fg-subtle">
                <span>Posture:</span>
                {[...new Set(d.posture.map((pz) => pz.kind))].map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("h-1 w-3", POSTURE_COLOR[k])} />{POSTURE_LABEL[k]}</span>)}
              </p>
            )}
          </div>
          <div className="col-span-4 border-b border-line sm:col-span-8 lg:col-span-5 lg:col-start-8">
            {d.clips.length ? d.clips.map((c) => (
              <PlaybackClipCard key={c.id} clip={c} active={activeClip === c.id} onClick={() => { setActiveClip(c.id); seek(c.startMs); }} />
            )) : <p className="border-t border-line py-5 text-ui text-fg-subtle">No standout moments were detected: a steady session. Try a higher pressure level next time.</p>}
          </div>
        </div>
      </section>

      {d.lessons.length > 0 && (
        <section className="pt-20">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="text-display-m text-fg">What to work on next</h2>
            <Link href="/lessons" className="text-meta text-fg-muted underline decoration-1 underline-offset-text hover:text-fg">All lessons</Link>
          </div>
          <p className="mt-2 max-w-2xl text-ui text-fg-muted">Built from this interview; each one uses your own answers as the example and ends with measured practice.</p>
          <div className="mt-5 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">{d.lessons.map((l) => <LessonCard key={l.key} l={l} />)}</div>
        </section>
      )}

      {/* The Read, part by part. */}
      <section className="pt-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-display-m text-fg">What we measured</h2>
          <p className="max-w-md text-meta text-fg-muted">Each measure shows your range and how far to trust it. Camera-based signals are estimates. Nothing here judges appearance, accent or emotion.</p>
        </div>
        {groups.map((g) => (
          <div key={g.title} className="mt-8">
            <h3 className="flex items-baseline gap-3"><span className="text-ui font-medium text-fg">{g.title}</span><span className="text-meta text-fg-subtle">{g.blurb}</span></h3>
            <div className="mt-2 border-t border-line">{g.rows.map((m) => <MeasureRow key={m.key} m={m} />)}</div>
          </div>
        ))}
        {d.competencies.length > 0 && (
          <div className="mt-10">
            <h3 className="text-ui font-medium text-fg">By skill</h3>
            <ul className="mt-2 border-t border-line">
              {d.competencies.map((c) => (
                <li key={c.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_5rem] items-center gap-4 border-b border-line py-3">
                  <span className="text-ui text-fg">{c.label}</span>
                  <span className="h-1 bg-line"><span className="block h-full origin-left bg-fg-muted" style={{ transform: `scaleX(${Math.max(0, Math.min(1, c.avgQuality))})` }} /></span>
                  <span className="text-right text-meta text-fg-subtle">{c.answers} answer{c.answers === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-meta text-fg-subtle">Lines show answer strength (structure and specificity), inferred from your transcript, not a grade of you.</p>
          </div>
        )}
      </section>

      {(d.rewrite || d.comparison) && (
        <section className="pt-20">
          {d.rewrite && (
            <div>
              <h2 className="text-display-m text-fg">Your weakest answer, tightened</h2>
              <p className="hang mt-3 max-w-lead font-display text-body-l text-fg-muted">“{d.rewrite.question}”</p>
              <div className="page-grid mt-6 gap-y-6">
                <figure className="col-span-4 border-t border-line pt-4 sm:col-span-8 lg:col-span-6"><figcaption className="text-meta font-medium text-fg-subtle">What you said</figcaption><blockquote className="mt-2 text-body-l text-fg-muted">{d.rewrite.original}</blockquote></figure>
                <figure className="col-span-4 border-t border-line pt-4 sm:col-span-8 lg:col-span-6"><figcaption className="text-meta font-medium text-fg-subtle">Same facts, tighter</figcaption><blockquote className="mt-2 text-body-l text-fg">{d.rewrite.rewritten}</blockquote><p className="mt-3 text-meta text-fg-subtle">{d.rewrite.note} Only facts from your answer are used; [brackets] mark details only you can fill in.</p></figure>
              </div>
            </div>
          )}
          {d.comparison && (
            <div className={cn(d.rewrite && "mt-16")}>
              <h2 className="text-display-m text-fg">First session vs. now</h2>
              <p className="mt-3 text-ui text-fg-muted">A {d.comparison.question.toLowerCase().startsWith("tell") ? "similar question" : "question on the same skill"}, {d.comparison.firstDate} vs. today.</p>
              <div className="page-grid mt-6 gap-y-6">
                <figure className="col-span-4 border-t border-line pt-4 sm:col-span-8 lg:col-span-6"><figcaption className="text-meta font-medium text-fg-subtle">Then</figcaption><blockquote className="mt-2 text-body-l text-fg-muted">{d.comparison.first}</blockquote></figure>
                <figure className="col-span-4 border-t border-fg-subtle pt-4 sm:col-span-8 lg:col-span-6"><figcaption className="text-meta font-medium text-fg">Now</figcaption><blockquote className="mt-2 text-body-l text-fg">{d.comparison.latest}</blockquote></figure>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="pt-20">
        <h2 className="text-display-m text-fg">Transcript</h2>
        <ol className="mt-5 divide-y divide-line border-y border-line">
          {d.transcript.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => seek(x.startMs)} disabled={!d.media} className={cn("grid w-full grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-4 px-1 py-4 text-left transition-colors duration-press enabled:hover:bg-surface sm:grid-cols-[3rem_8rem_minmax(0,1fr)]", d.media && time > 0 && time * 1000 >= x.startMs && time * 1000 < x.endMs && "bg-accent-tint")}>
                <span className="text-meta text-fg-subtle">{mmss(x.startMs)}</span>
                <span className={cn("text-meta font-medium", x.speaker === "interviewer" ? "text-fg-subtle" : "text-fg")}>{x.who}</span>
                <span className={cn("col-start-2 sm:col-start-auto", x.speaker === "interviewer" ? "font-display text-body-l leading-snug text-fg-muted" : "text-body text-fg")}>{x.text}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-8 text-meta text-fg-muted">
        <p>{d.media?.expiresAt ? `Raw video is deleted automatically on ${new Date(d.media.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.` : "Transcript and feedback are kept until you delete them."}</p>
        <div className="flex items-center gap-6">
          <Link href="/playback" className="hover:text-fg">All sessions</Link>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete this session</Button>
        </div>
      </footer>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete session">
        <div className="p-8">
          <h2 className="text-display-m text-fg">Delete this session?</h2>
          <p className="mt-3 text-ui text-fg-muted">The recording, transcript and feedback are permanently removed. This can&apos;t be undone.</p>
          <div className="mt-7 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={deleting} onClick={del}>Delete permanently</Button></div>
        </div>
      </Modal>
    </article>
  );
}

type Row = PlaybackData["metrics"][number];
type Mark = "on" | "off" | "open" | "none";

/** The Read in four parts, so a long list of numbers reads as a few plain answers. */
const GROUPS: { title: string; keys: string[]; blurb: string }[] = [
  { title: "Delivery", keys: ["pace_wpm", "filler_per_min", "pauses", "vocal_variety"], blurb: "How you sound" },
  { title: "Content", keys: ["structure_score", "specificity", "hedges_per_min"], blurb: "What you say" },
  { title: "Composure", keys: ["recovery_ms"], blurb: "How you handle a hard question" },
  { title: "Presence", keys: ["camera_engagement", "movement", "setup"], blurb: "How you come across on camera" },
];

function markOf(m: Row): Mark {
  if (m.value === null) return "none";
  if (m.targetLow === null || m.targetHigh === null) return "open";
  return m.value >= m.targetLow && m.value <= m.targetHigh ? "on" : "off";
}

function grouped(metrics: Row[], keepEmpty = false) {
  const used = new Set(GROUPS.flatMap((g) => g.keys));
  const out = GROUPS.map((g) => ({ ...g, rows: g.keys.map((k) => metrics.find((m) => m.key === k)).filter((m): m is Row => !!m) }));
  const rest = metrics.filter((m) => !used.has(m.key));
  if (rest.length) out.push({ title: "Other", keys: [], blurb: "", rows: rest });
  return keepEmpty ? out : out.filter((g) => g.rows.length);
}

/** One line per part of the Read: how many measures landed on target, and which missed. */
function Breakdown({ metrics }: { metrics: Row[] }) {
  return (
    <ul className="mt-3 border-t border-line">
      {grouped(metrics, true).map((g) => {
        const marks = g.rows.map(markOf);
        const scored = marks.filter((x) => x === "on" || x === "off").length;
        const on = marks.filter((x) => x === "on").length;
        const off = g.rows.filter((m) => markOf(m) === "off").map((m) => m.label.toLowerCase());
        const verdict = !g.rows.some((m) => m.value !== null) ? "Not measured" : !scored ? "Measured, no target" : on === scored ? "On target" : `${on} of ${scored} on target`;
        const why = !g.rows.some((m) => m.value !== null) && g.title === "Presence" ? "Camera signals were off" : g.blurb;
        return (
          <li key={g.title} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 border-b border-line py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
            <p className="text-body font-medium text-fg">{g.title}</p>
            <p className="col-span-2 row-start-2 text-meta text-fg-subtle sm:col-span-1 sm:row-start-auto">{off.length ? `Off target: ${off.join(", ")}` : why}</p>
            <p className={cn("col-start-2 row-start-1 text-right text-ui sm:col-start-auto sm:row-start-auto", verdict === "On target" ? "text-fg" : "text-fg-muted")}>{verdict}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** A measurement as a line of the report: value, where it sits against its target, and the evidence. */
function MeasureRow({ m }: { m: Row }) {
  const fmt = m.key === "recovery_ms" ? (v: number) => (v / 1000).toFixed(1) : (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());
  const max = m.key === "structure_score" || m.key === "specificity" || m.key === "camera_engagement" ? 100 : Math.max(m.targetHigh ?? 0, m.high ?? 0, m.value ?? 0, 1) * 1.25;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const mark = markOf(m);
  const unit = m.key === "recovery_ms" ? "s" : m.unit;
  return (
    <div className="grid gap-x-6 gap-y-2 border-b border-line py-4 sm:grid-cols-[11rem_7.5rem_minmax(0,1fr)]">
      <div>
        <p className="text-ui font-medium text-fg">{m.label}</p>
        <div className="mt-1"><ConfidenceMark confidence={m.confidence} /></div>
      </div>
      <p className="flex items-baseline gap-1.5 sm:block">
        <span className={cn("text-body-l leading-none", mark === "off" ? "text-warning" : "text-fg")}>{m.value === null ? "n/a" : fmt(m.value)}</span>
        <span className="text-meta text-fg-subtle sm:ml-1">{unit}</span>
      </p>
      <div className="min-w-0">
        {m.value !== null && (m.targetLow !== null || m.low !== null) && (
          <div className="relative mt-2 h-1 bg-raised" aria-hidden>
            {m.targetLow !== null && m.targetHigh !== null && <div className="absolute inset-y-0 bg-accent/55" style={{ left: pct(m.targetLow), width: `calc(${pct(m.targetHigh)} - ${pct(m.targetLow)})` }} />}
            {m.low !== null && m.high !== null && <div className="absolute inset-y-[-3px] border-x border-fg-muted/70" style={{ left: pct(m.low), width: `calc(${pct(m.high)} - ${pct(m.low)})` }} />}
            <div className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-page", mark === "off" ? "bg-warning" : "bg-fg")} style={{ left: pct(m.value) }} />
          </div>
        )}
        {m.targetLow !== null && m.targetHigh !== null && m.value !== null && (
          <p className="mt-2 text-meta text-fg-subtle">Target {fmt(m.targetLow)} to {fmt(m.targetHigh)}{m.low !== null && m.high !== null ? `. Your range ${fmt(m.low)} to ${fmt(m.high)}.` : "."}</p>
        )}
        {m.note && <p className="mt-2 text-meta leading-relaxed text-fg-muted">{m.note}</p>}
      </div>
    </div>
  );
}
