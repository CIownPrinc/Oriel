"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { FieldError, Input, Segmented, Textarea, Toggle } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { api, ApiError } from "@/lib/client/api";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { PERSONAS, type PersonaId } from "@/lib/interview/personas";
import { AvatarStudio, type SavedStyles } from "@/components/avatar/AvatarStudio";
import { BotStill } from "@/components/avatar/BotStill";
import { voiceFor } from "@/lib/avatar/style";
import { longDate } from "@/lib/format";

type Privacy = { cameraMetricsEnabled: boolean; gazeMetricEnabled: boolean; postureMetricEnabled: boolean; recordVideo: boolean; videoRetentionDays: number };

export function ProfileClient(p: {
  privacy: Privacy; resume: { name: string; roles: string[]; createdAt: string } | null; jd: { title: string; competencies: string[] } | null;
  plan: { id: PlanId; name: string; periodEnd: string | null; sessionsThisWeek: number; drillsToday: number }; storedRecordings: number;
  consents: { id: string; kind: string; granted: boolean; version: string; at: string }[];
  styles: SavedStyles;
}) {
  const router = useRouter();
  const [privacy, setPrivacy] = useState(p.privacy);
  const [saving, setSaving] = useState<string | null>(null);
  const [jdText, setJdText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [styles, setStyles] = useState<SavedStyles>(p.styles);
  const [editing, setEditing] = useState<PersonaId | null>(null);

  async function savePrivacy(patch: Partial<Privacy>) {
    const next = { ...privacy, ...patch };
    setPrivacy(next);
    setSaving(Object.keys(patch)[0]);
    try { await api("/api/privacy/settings", { method: "PATCH", json: patch }); } finally { setSaving(null); }
  }

  async function uploadResume(file?: File) {
    setDocError(null);
    setBusy("resume");
    try {
      const form = new FormData();
      if (file) form.set("file", file); else form.set("text", resumeText);
      await api("/api/resume", { method: "POST", body: form });
      setResumeText("");
      router.refresh();
    } catch (e) { setDocError(e instanceof ApiError ? e.message : "Upload failed"); } finally { setBusy(null); }
  }

  async function saveJd() {
    setDocError(null);
    setBusy("jd");
    try { await api("/api/job-description", { method: "POST", json: { text: jdText } }); setJdText(""); router.refresh(); }
    catch (e) { setDocError(e instanceof ApiError ? e.message : "Couldn't save"); } finally { setBusy(null); }
  }

  async function choosePlan(plan: PlanId) {
    setBusy(plan);
    try { await api("/api/billing/checkout", { method: "POST", json: { plan } }); router.refresh(); }
    catch (e) { setDocError(e instanceof ApiError ? e.message : "Checkout failed"); } finally { setBusy(null); }
  }

  async function deleteAccount() {
    setBusy("delete");
    await api("/api/privacy/delete-account", { method: "POST", json: { confirm: "DELETE" } });
    router.replace("/");
    router.refresh();
  }

  const sections: [string, string][] = [["documents", "Resume & role"], ["interviewers", "Your interviewers"], ["privacy", "Privacy"], ["plan", "Plan"], ["data", "Your data"]];

  return (
    <div className="page-grid mt-group gap-y-12">
      {/* The page's own contents in the margin, as a document's would be. */}
      <nav aria-label="On this page" className="hidden lg:col-span-3 lg:block">
        <ul className="sticky top-24 space-y-1 text-ui">{sections.map(([id, l]) => <li key={id}><a href={`#${id}`} className="-mx-2 block rounded-control px-2 py-1.5 text-fg-muted transition-colors duration-press hover:bg-surface hover:text-fg">{l}</a></li>)}</ul>
      </nav>
      <div className="col-span-4 space-y-20 sm:col-span-8 lg:col-span-9">
        <section id="documents">
          <h2 className="text-display-m text-fg">Resume &amp; role</h2>
          <div className="mt-6 grid gap-x-6 gap-y-10 md:grid-cols-2">
            <div className="border-t border-line pt-5">
              <div className="flex items-center justify-between"><h3 className="text-ui font-medium text-fg">Resume</h3>{p.resume && <Badge>Active</Badge>}</div>
              {p.resume ? (<><p className="mt-3 text-body text-fg">{p.resume.name}</p><ul className="mt-2 space-y-1 text-ui text-fg-muted">{p.resume.roles.slice(0, 4).map((r) => <li key={r}>{r}</li>)}</ul></>) : <p className="mt-3 text-ui text-fg-muted">No resume yet.</p>}
              <div className="mt-5 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} loading={busy === "resume"}>Upload PDF or DOCX</Button>
                <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadResume(f); }} />
              </div>
              <Textarea className="mt-3" rows={3} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="…or paste resume text" aria-label="Resume text" />
              {resumeText.trim().length >= 40 && <Button size="sm" className="mt-2" onClick={() => uploadResume()} loading={busy === "resume"}>Save pasted resume</Button>}
            </div>
            <div className="border-t border-line pt-5">
              <div className="flex items-center justify-between"><h3 className="text-ui font-medium text-fg">Job description</h3>{p.jd && <Badge>Active</Badge>}</div>
              {p.jd ? (<><p className="mt-3 text-body text-fg">{p.jd.title}</p><p className="mt-2 text-ui text-fg-muted">{p.jd.competencies.join(" · ") || "No specific competencies found"}</p></>) : <p className="mt-3 text-ui text-fg-muted">No job description yet.</p>}
              <Textarea className="mt-5" rows={4} value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="Paste a job description" aria-label="Job description text" />
              <Button size="sm" className="mt-2" onClick={saveJd} disabled={jdText.trim().length < 40} loading={busy === "jd"}>Save job description</Button>
            </div>
          </div>
          <FieldError>{docError}</FieldError>
        </section>

        <section id="interviewers">
          <h2 className="text-display-m text-fg">Your interviewers</h2>
          <p className="mt-2 max-w-lead text-ui text-fg-muted">Give any of them a new shape, color, name and voice. They keep their interviewing style; the look and sound are yours.</p>
          {/* The whole cast, standing together: each the real avatar, as it appears in the Room. */}
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3">
            {(Object.keys(PERSONAS) as PersonaId[]).map((id) => {
              const name = styles[id]?.name ?? PERSONAS[id].name.split(" ")[0];
              return (
                <div key={id} className="flex flex-col items-center text-center">
                  <BotStill personaId={id} style={styles[id]} className="aspect-square w-full max-w-[11rem]" />
                  <p className="-mt-1 max-w-full truncate text-display-m text-fg">{name}</p>
                  <p className="mt-1 text-meta text-fg-muted">{PERSONAS[id].label} · {voiceFor(id, styles[id])} voice</p>
                  <button type="button" onClick={() => setEditing(id)} aria-label={`Customize ${name}`}
                    className="mt-2 h-9 rounded-control px-3 text-ui text-fg-muted underline decoration-1 underline-offset-text transition-colors duration-press hover:text-fg pointer-coarse:h-11">Customize</button>
                </div>
              );
            })}
          </div>
          <AvatarStudio personaId={editing} saved={styles} onClose={() => setEditing(null)} onSaved={setStyles} />
        </section>

        <section id="privacy">
          <h2 className="text-display-m text-fg">Privacy</h2>
          <p className="mt-2 max-w-lead text-ui text-fg-muted">Camera signals are computed on your device; only derived numbers are stored. We never sell biometric data or share individual results with employers.</p>
          <div className="mt-6 divide-y divide-line border-y border-line">
            <Toggle checked={privacy.cameraMetricsEnabled} onChange={(v) => savePrivacy({ cameraMetricsEnabled: v })} label="Camera-based signals" description="Estimate camera engagement and posture. Off: you still see yourself and can record, but no camera measurements are made." />
            <Toggle checked={privacy.gazeMetricEnabled} disabled={!privacy.cameraMetricsEnabled} onChange={(v) => savePrivacy({ gazeMetricEnabled: v })} label="Camera engagement (gaze)" description="Turn off if you avoid eye contact for cultural, neurological or personal reasons; nothing is penalized." />
            <Toggle checked={privacy.postureMetricEnabled} disabled={!privacy.cameraMetricsEnabled} onChange={(v) => savePrivacy({ postureMetricEnabled: v })} label="Posture and movement" description="Lean, slouch, sway and fidgeting, shown as a timeline." />
            <Toggle checked={privacy.recordVideo} onChange={(v) => savePrivacy({ recordVideo: v })} label="Record sessions" description="Needed for video Playback. Off: you still get the transcript and the Read." />
            <div className="py-4">
              <p className="text-ui font-medium text-fg">Keep raw video for</p>
              <p className="mt-1 max-w-lead text-ui text-fg-muted">Recordings are encrypted and deleted automatically after this period. Shortening it applies to existing recordings too.</p>
              <Segmented className="mt-3" name="Retention" value={String(privacy.videoRetentionDays)} onChange={(v) => savePrivacy({ videoRetentionDays: Number(v) as 1 | 7 | 30 | 90 })} options={[{ value: "1", label: "1 day" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
            </div>
          </div>
          <p className="mt-2 h-5 text-meta text-fg-subtle" aria-live="polite">{saving ? "Saving…" : ""}</p>
        </section>

        <section id="plan">
          <h2 className="text-display-m text-fg">Plan</h2>
          <p className="mt-2 text-ui text-fg-muted">You&apos;re on <span className="text-fg">{p.plan.name}</span>{p.plan.periodEnd ? ` until ${longDate(new Date(p.plan.periodEnd))}` : ""}. {p.plan.sessionsThisWeek} session{p.plan.sessionsThisWeek === 1 ? "" : "s"} this week.</p>
          {/* Plans as ruled columns, as on the pricing page: the current one says so in words. */}
          <div className="mt-6 grid gap-x-6 gap-y-10 md:grid-cols-3">
            {(["free", "sprint", "pro"] as const).map((id) => (
              <div key={id} className="flex flex-col border-t border-line pt-5">
                <p className="flex items-baseline justify-between gap-3"><span className="text-display-m text-fg">{PLANS[id].name}</span>{p.plan.id === id && <span className="text-meta font-medium text-fg">Your plan</span>}</p>
                <p className="mt-2 flex items-baseline gap-2"><span className="font-display text-display-l leading-none text-fg">{PLANS[id].price}</span><span className="text-ui text-fg-muted">{PLANS[id].cadence}</span></p>
                <ul className="mt-4 flex-1 space-y-1.5 text-ui text-fg-muted">{PLANS[id].features.map((f) => <li key={f}>{f}</li>)}</ul>
                {p.plan.id !== id && <Button className="mt-5 self-start" size="sm" variant="secondary" loading={busy === id} onClick={() => choosePlan(id)}>Switch to {PLANS[id].name}</Button>}
              </div>
            ))}
          </div>
          <p className="mt-4 text-meta text-fg-subtle">Development checkout: plan changes apply immediately with no charge. A payment processor plugs into the same endpoint for production.</p>
        </section>

        <section id="data">
          <h2 className="text-display-m text-fg">Your data</h2>
          <p className="mt-2 text-ui text-fg-muted">{p.storedRecordings} encrypted recording{p.storedRecordings === 1 ? "" : "s"} stored. Delete individual sessions from Playback.</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a href="/api/privacy/export" className="inline-flex h-10 items-center rounded-button border border-control px-4 text-ui font-medium text-fg transition-colors duration-press hover:border-fg-muted hover:bg-surface pointer-coarse:h-11">Download my data (JSON)</a>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete my account</Button>
          </div>
          <h3 className="mt-12 text-ui font-medium text-fg">Consent history</h3>
          <table className="mt-3 w-full text-left text-ui">
            <thead className="sr-only"><tr><th scope="col">Consent</th><th scope="col">Choice</th><th scope="col">Version</th><th scope="col">When</th></tr></thead>
            <tbody className="border-t border-line">
              {p.consents.map((c) => (
                <tr key={c.id} className="border-b border-line">
                  <th scope="row" className="py-3 pr-4 font-normal capitalize text-fg">{c.kind.replaceAll("_", " ")}</th>
                  <td className={c.granted ? "py-3 pr-4 text-success" : "py-3 pr-4 text-fg-subtle"}>{c.granted ? "Granted" : "Declined"}</td>
                  <td className="hidden py-3 pr-4 text-meta text-fg-subtle sm:table-cell">v{c.version}</td>
                  <td className="py-3 text-right text-fg-muted">{longDate(new Date(c.at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete account">
        <div className="p-8">
          <h2 className="text-display-m text-fg">Delete your account?</h2>
          <p className="mt-3 text-ui text-fg-muted">This permanently deletes your profile, resume, every session, recording, transcript, metric and drill. It can&apos;t be undone.</p>
          <p className="mt-5 text-ui text-fg-muted">Type <span className="font-medium text-fg">DELETE</span> to confirm.</p>
          <Input className="mt-2" value={deleteWord} onChange={(e) => setDeleteWord(e.target.value)} aria-label="Type DELETE to confirm" />
          <div className="mt-7 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" disabled={deleteWord !== "DELETE"} loading={busy === "delete"} onClick={deleteAccount}>Delete everything</Button></div>
        </div>
      </Modal>
    </div>
  );
}
