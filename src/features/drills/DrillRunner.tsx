"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { FieldError, Textarea } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import type { DrillDef } from "@/lib/practice/catalog";
import { InterviewerAudio, speakWithBrowser } from "@/lib/avatar/audio";
import { api, ApiError } from "@/lib/client/api";
import { LiveTranscriber } from "@/features/room/engine/speech";
import { MicAnalyzer } from "@/features/room/engine/mic";
import { AnswerRecorder } from "@/features/room/engine/recorder";
import { VisionTracker } from "@/features/room/engine/vision";
import { readNdjson } from "@/features/room/engine/stream";
import type { RoomEvent } from "@/server/interview/service";
import type { VisionSample } from "@/lib/analysis/read";

type Stage = "brief" | "calibrate" | "prompt" | "answer" | "scoring" | "result";
type Result = {
  measurement: { value: number | null; unit: string; label: string; passed: boolean | null; details: Record<string, unknown> };
  baseline: number | null; feedback: { feedback: string; nextTry: string }; source: string;
  lesson: { key: string; title: string; passes: number; needed: number } | null;
};

export function DrillRunner({ drill, sourceSessionId, serverStt, lesson }: { drill: DrillDef; sourceSessionId: string | null; serverStt: boolean; lesson?: { key: string; title: string } | null }) {
  const [stage, setStage] = useState<Stage>("brief");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [textMode, setTextMode] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calibOk, setCalibOk] = useState<boolean | null>(null);
  const r = useRef<{ audio?: InterviewerAudio; mic?: MicAnalyzer; stream?: MediaStream; cam?: MediaStream; tx?: LiveTranscriber; rec?: AnswerRecorder; vision?: VisionTracker; t0: number; promptEnd: number; timer?: ReturnType<typeof setInterval>; engaged: number[]; posture: VisionSample[] }>({ t0: 0, promptEnd: 0, engaged: [], posture: [] });
  const voiceOnly = !!drill.requiresVoice;
  const postureDrill = drill.targetMetric === "posture_upright";
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => () => {
    const x = r.current;
    x.stream?.getTracks().forEach((t) => t.stop());
    x.cam?.getTracks().forEach((t) => t.stop());
    x.mic?.close();
    x.vision?.close();
    x.audio?.close();
    if (x.timer) clearInterval(x.timer);
  }, []);

  async function begin() {
    setError(null);
    const x = r.current;
    try {
      x.audio ??= new InterviewerAudio();
      await x.audio.resume();
      if (!textMode) {
        x.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        x.t0 = performance.now();
        x.mic = new MicAnalyzer(x.audio.ctx, x.stream, () => performance.now() - x.t0);
        x.mic.start();
      }
      if (drill.requiresCamera && !x.cam) {
        x.cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
        x.vision = new VisionTracker();
        setStage("calibrate");
        if (videoRef.current) { videoRef.current.srcObject = x.cam; await videoRef.current.play().catch(() => {}); }
        const ok = await x.vision.init();
        if (!ok) { setCalibOk(false); return; }
        return;
      }
      await speakPrompt();
    } catch (e) {
      if (voiceOnly) { setError("This drill measures your voice, so it needs your microphone. Allow it in your browser's address bar and try again."); return; }
      setError(e instanceof DOMException ? "Microphone or camera access was blocked. You can type your answer instead." : "Couldn't start the drill.");
      setTextMode(true);
    }
  }

  async function calibrate() {
    const x = r.current;
    if (!x.vision || !videoRef.current) return;
    const ok = await x.vision.calibrate(videoRef.current);
    // Posture is measured against how you sat here, which needs your shoulders in view.
    const ready = ok && (!postureDrill || x.vision.postureReady);
    setCalibOk(ready);
    if (ready) await speakPrompt();
  }

  async function speakPrompt() {
    const x = r.current;
    setStage("prompt");
    let spoke = false;
    try {
      const res = await fetch(`/api/drills/${drill.id}/speak`, { method: "POST" });
      if (res.ok) {
        let started = false;
        await readNdjson<RoomEvent>(res, (ev) => {
          if (ev.type === "audio") {
            if (!started) { x.audio!.beginUtterance(); started = true; }
            x.audio!.enqueuePcm(ev.pcm, ev.sampleRate);
            spoke = true;
          } else if (ev.type === "audio_end") x.audio!.endUtterance();
        });
        if (spoke) await x.audio!.waitForEnd();
      }
    } catch { /* fall through */ }
    if (!spoke) await speakWithBrowser(drill.prompt, { audio: x.audio });
    startAnswer();
  }

  function startAnswer() {
    const x = r.current;
    x.promptEnd = performance.now() - x.t0;
    setStage("answer");
    setElapsed(0);
    x.engaged = [];
    x.posture = [];
    const started = performance.now();
    if (!textMode && x.stream) {
      if (LiveTranscriber.supported()) {
        x.tx = new LiveTranscriber();
        x.tx.onUpdate = setTranscript;
        x.tx.start();
      }
      x.rec = new AnswerRecorder();
      x.rec.start(x.stream);
    }
    x.timer = setInterval(() => {
      const e = performance.now() - started;
      setElapsed(e);
      if (x.vision && videoRef.current) {
        const f = x.vision.analyze(videoRef.current);
        const g = f ? x.vision.engagement(f) : null;
        if (g !== null) x.engaged.push(g);
        if (f && postureDrill) x.posture.push(x.vision.toSample(f, performance.now() - x.t0));
      }
      if (e > drill.durationSec * 1000 + 30000) void finish();
    }, 250);
  }

  async function finish() {
    const x = r.current;
    if (x.timer) clearInterval(x.timer);
    setStage("scoring");
    const durationMs = performance.now() - x.t0 - x.promptEnd;
    let text = textMode ? typed : (await x.tx?.stop()) ?? "";
    const blob = await x.rec?.stop();
    if (!textMode && blob && serverStt) {
      // Server transcription keeps filler words, which live captions drop.
      const res = await fetch(`/api/drills/${drill.id}/transcribe`, { method: "POST", headers: { "content-type": blob.type.split(";")[0] }, body: blob }).catch(() => null);
      const t = res?.ok ? ((await res.json()) as { text: string }).text : "";
      if (t && t.split(" ").length >= text.split(" ").length * 0.5) text = t;
    }
    const firstVoice = x.mic && x.mic.voiceStartedAt > x.promptEnd ? x.mic.voiceStartedAt - x.promptEnd : null;
    const engagement = x.engaged.length >= 8 ? x.engaged.filter((v) => v >= 0.5).length / x.engaged.length : null;
    try {
      const res = await api<Result>(`/api/drills/${drill.id}/attempts`, {
        method: "POST",
        json: {
          transcript: text.trim(), durationMs: Math.max(500, durationMs), firstWordLatencyMs: textMode ? null : firstVoice, cameraEngagement: engagement, sourceSessionId,
          answerStartMs: Math.max(0, x.promptEnd),
          audio: textMode ? undefined : x.mic?.samples.filter((a) => a.t >= x.promptEnd - 300 && a.t <= x.promptEnd + durationMs),
          vision: postureDrill ? x.posture : undefined,
        },
      });
      setResult(res);
      setStage("result");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't score this attempt");
      setStage("answer");
    }
  }

  function again() {
    setResult(null);
    setTranscript("");
    setTyped("");
    void speakPrompt();
  }

  const secs = Math.floor(elapsed / 1000);
  const over = secs > drill.durationSec;

  return (
    <div className="max-w-column">
      {lesson ? <Link href={`/lessons/${lesson.key}`} className="-ml-1 inline-flex h-9 items-center rounded-control px-1 text-ui text-fg-muted transition-colors duration-press hover:text-fg">← Lesson: {lesson.title}</Link> : <Link href="/drills" className="-ml-1 inline-flex h-9 items-center rounded-control px-1 text-ui text-fg-muted transition-colors duration-press hover:text-fg">← Drills</Link>}
      <h1 className="mt-6 text-display-l text-fg">{drill.title}</h1>
      <p className="mt-5 text-body-l text-fg-muted">{drill.objective}</p>
      <p className="mt-3 text-ui text-fg-subtle">A {Math.round(drill.durationSec / 60) || 1}-minute drill{drill.requiresCamera ? ", on camera" : ""}.</p>

      {stage === "brief" && (
        <section className="mt-10 border-t border-line pt-6">
          <h2 className="text-ui font-medium text-fg">How it works</h2>
          <p className="mt-3 text-body text-fg">{drill.instructions}</p>
          <p className="mt-4 text-ui text-fg-muted">Target: {drill.passRule}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button size="lg" onClick={begin}>Start drill</Button>
            {!drill.requiresCamera && !voiceOnly && <button type="button" className="h-11 rounded-control text-ui text-fg-muted underline decoration-1 underline-offset-text transition-colors duration-press hover:text-fg" onClick={() => setTextMode(!textMode)}>{textMode ? "Use my voice" : "Type instead"}</button>}
            {voiceOnly && <span className="text-ui text-fg-muted">Spoken only: this is measured from your voice.</span>}
          </div>
          <FieldError>{error}</FieldError>
        </section>
      )}

      {(stage === "calibrate" || (drill.requiresCamera && stage !== "brief")) && (
        <div className="mt-8 overflow-hidden rounded-panel bg-surface">
          <video ref={videoRef} muted playsInline className="aspect-video w-full -scale-x-100 object-cover" />
        </div>
      )}
      {stage === "calibrate" && (
        <div className="mt-5 flex items-center gap-4">
          <Button onClick={calibrate}>{postureDrill ? "Sit tall, look at the lens for 2 seconds" : "Look at the lens for 2 seconds"}</Button>
          {calibOk === false && <p className="text-ui text-warning">{postureDrill ? "We need your face and shoulders in view. Sit back a little or tilt your camera down, add light in front of you, and try again." : "We couldn't see your face clearly. Add light in front of you and try again."}</p>}
        </div>
      )}

      {(stage === "prompt" || stage === "answer" || stage === "scoring") && (
        <section className="mt-10">
          <div className="border-t border-line pt-6">
            <p className="text-ui text-fg-muted">The question</p>
            <p className="hang mt-3 text-display-m text-fg">“{drill.prompt}”</p>
          </div>
          {stage === "prompt" && <p className="mt-6 text-ui text-fg-muted">Listen…</p>}
          {stage !== "prompt" && (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <span className={cn("text-display-m tabular-nums", over ? "text-warning" : "text-fg")}>{String(Math.floor(secs / 60)).padStart(1, "0")}:{String(secs % 60).padStart(2, "0")}</span>
                <span className="text-ui text-fg-muted">target {drill.durationSec} s</span>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised"><div className={cn("h-full rounded-full transition-[width] duration-300", over ? "bg-warning" : "bg-accent")} style={{ width: `${Math.min(100, (elapsed / (drill.durationSec * 1000)) * 100)}%` }} /></div>
              {textMode ? (
                <Textarea className="mt-6" rows={6} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your answer" autoFocus />
              ) : (
                <p className="mt-6 min-h-20 text-body text-fg-muted">{transcript || <span className="text-fg-subtle">Speak your answer…</span>}</p>
              )}
              <div className="mt-6 flex items-center gap-3">
                <Button size="lg" onClick={finish} loading={stage === "scoring"} disabled={textMode && !typed.trim()}>I&apos;m done</Button>
                <FieldError>{error}</FieldError>
              </div>
            </div>
          )}
        </section>
      )}

      {stage === "result" && result && (
        <section className="mt-10">
          {/* The result is the one number this page exists to give: shown large, said in words, with its baseline. */}
          <div className="border-t border-line pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-ui text-fg-muted">{result.measurement.label}</p>
                <p className="mt-2 flex items-baseline gap-2"><span className="text-display-l tabular-nums text-fg">{result.measurement.value ?? "—"}</span><span className="text-body-l text-fg-muted">{result.measurement.unit}</span></p>
                {result.baseline !== null && <p className="mt-2 text-ui text-fg-muted">Your baseline: {Math.round(result.baseline * 10) / 10} {result.measurement.unit}</p>}
              </div>
              {result.measurement.passed !== null && <Badge tone={result.measurement.passed ? "good" : "warn"}>{result.measurement.passed ? "Target met" : "Not yet"}</Badge>}
            </div>
            {typeof result.measurement.details.reason === "string" && <p className="mt-4 text-ui text-warning">{result.measurement.details.reason}</p>}
            <p className="mt-6 text-body text-fg">{result.feedback.feedback}</p>
            <p className="mt-3 text-body text-fg"><span className="font-medium text-accent">Next try:</span> {result.feedback.nextTry}</p>
            {Array.isArray(result.measurement.details.statements) && (result.measurement.details.statements as string[]).length > 0 && (
              <ul className="mt-5 space-y-1 border-t border-line pt-4 text-ui text-fg-muted">{(result.measurement.details.statements as string[]).map((s) => <li key={s} className="hang-sans">“{s}”</li>)}</ul>
            )}
          </div>
          {result.lesson && (
            <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3 border-y border-line py-4">
              <p className="text-ui text-fg-muted">Lesson practice · <span className="text-fg">{result.lesson.title}</span>: {Math.min(result.lesson.passes, result.lesson.needed)} of {result.lesson.needed} passes{result.lesson.passes >= result.lesson.needed ? ". Practiced. Now use it in an interview." : ""}</p>
              <Link href={`/lessons/${result.lesson.key}`} className="text-ui text-fg-muted underline decoration-1 underline-offset-text hover:text-fg">Back to the lesson</Link>
            </div>
          )}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button size="lg" onClick={again}>Try again</Button>
            <Link href="/drills" className="text-ui text-fg-muted underline decoration-1 underline-offset-text hover:text-fg">Other drills</Link>
          </div>
        </section>
      )}
    </div>
  );
}
