"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BotAvatar } from "@/components/avatar/BotAvatar";
import { InterviewerStage } from "@/components/avatar/InterviewerStage";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/components/ui/cn";
import { LogoMark, Thinking } from "@/components/ui/Logo";
import { Interviewer } from "@/components/brand/Interviewer";
import { LocalAvatarProvider } from "@/lib/avatar/local-provider";
import { ExternalAvatarProvider } from "@/lib/avatar/external-provider";
import type { AvatarSeatConfig, AvatarSession } from "@/lib/avatar/types";
import { ConsentDialog, type ConsentChoices } from "./ConsentDialog";
import { RoomController, type RoomUiState } from "./engine/controller";
import { LiveTranscriber } from "./engine/speech";
import { VisionTracker } from "./engine/vision";
import { postureKind, type PostureKind } from "@/lib/analysis/posture";
import { callName } from "@/lib/avatar/style";
import { PALETTE } from "@/lib/palette";

export interface RoomProps {
  sessionId: string;
  resuming: boolean;
  seats: (AvatarSeatConfig & { title: string })[];
  pressure: number;
  stillness: number;
  role: string;
  targetMinutes: number;
  privacy: { recordVideo: boolean; cameraMetrics: boolean; posture: boolean };
  serverStt: boolean;
}

type Stage = "consent" | "check" | "entering" | "live" | "ending";

const LIVE_POSTURE: Record<PostureKind | "upright", string> = {
  upright: "Upright", slouch: "Slouching", lean_in: "Leaning in", lean_back: "Sitting back", fidget: "Moving a lot", off_frame: "Face not in view",
};

/** A rendering failure falls back to the voice-only interviewer instead of breaking the Room. */
class AvatarBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Room(props: RoomProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("consent");
  const [consent, setConsent] = useState<ConsentChoices | null>(null);
  const [devices, setDevices] = useState<{ mic: MediaStream | null; cam: MediaStream | null; micError: string | null; camError: string | null } | null>(null);
  const [ui, setUi] = useState<RoomUiState | null>(null);
  const [voiceOnly, setVoiceOnly] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [muted, setMuted] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [typed, setTyped] = useState("");
  const [calib, setCalib] = useState<"idle" | "running" | "done" | "failed" | "unavailable">("idle");
  const [visionReady, setVisionReady] = useState(false);
  const [postureReady, setPostureReady] = useState(false);
  const [livePosture, setLivePosture] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // The questions asked so far, captured once each has been spoken (so captions-off stays honest).
  const [asked, setAsked] = useState<{ t: number; who: string; text: string }[]>([]);
  const lastAsked = useRef<string | null>(null);
  const startedAt = useRef(0);
  const provider = useMemo(() => new LocalAvatarProvider(), []);
  const controller = useRef<RoomController | null>(null);
  const avatarSession = useRef<AvatarSession | null>(null);
  const vision = useRef<VisionTracker | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const checkVideoRef = useRef<HTMLVideoElement>(null);
  // Hidden, always-mounted element that on-device vision reads from (survives stage changes).
  const analysisVideoRef = useRef<HTMLVideoElement>(null);
  const [micLevel, setMicLevel] = useState(0);

  // ─── Consent → devices ──────────────────────────────────────────────────
  async function onConsent(c: ConsentChoices, version: string, signature: string | null) {
    setConsent(c);
    void fetch(`/api/sessions/${props.sessionId}/consent`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, signature: signature ?? undefined, consents: [
        { kind: "ai_disclosure", granted: true }, { kind: "microphone", granted: c.microphone }, { kind: "camera", granted: c.camera },
        { kind: "recording", granted: c.recording }, { kind: "camera_metrics", granted: c.cameraMetrics },
      ] }),
    });
    const res: { mic: MediaStream | null; cam: MediaStream | null; micError: string | null; camError: string | null } = { mic: null, cam: null, micError: null, camError: null };
    if (c.microphone) {
      try {
        res.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        res.micError = e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone access was blocked." : "No microphone was found.";
      }
    }
    if (c.camera) {
      try {
        res.cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
      } catch (e) {
        res.camError = e instanceof DOMException && e.name === "NotAllowedError" ? "Camera access was blocked." : "No camera was found.";
      }
    }
    setDevices(res);
    setStage("check");
    if (res.cam && c.cameraMetrics) {
      const v = new VisionTracker();
      vision.current = v;
      void v.init().then((ok) => { setVisionReady(ok); if (!ok) setCalib("unavailable"); });
    }
  }

  useEffect(() => {
    const cam = devices?.cam;
    for (const el of [checkVideoRef.current, videoRef.current, analysisVideoRef.current]) if (el && cam && el.srcObject !== cam) { el.srcObject = cam; void el.play().catch(() => {}); }
  }, [devices, stage]);

  // Mic meter during the check.
  useEffect(() => {
    if (stage !== "check" || !devices?.mic) return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(devices.mic).connect(an);
    const buf = new Float32Array(an.fftSize);
    const id = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x * x;
      setMicLevel(Math.min(1, Math.sqrt(s / buf.length) * 8));
    }, 80);
    return () => { clearInterval(id); void ctx.close(); };
  }, [stage, devices]);

  async function calibrate() {
    if (!vision.current || !analysisVideoRef.current) return;
    setCalib("running");
    const ok = await vision.current.calibrate(analysisVideoRef.current);
    setPostureReady(ok && vision.current.postureReady);
    setCalib(ok ? "done" : "failed");
  }

  // Live posture readout during the check, so people can see what will be measured.
  // Same code and thresholds as the interview; nothing here is sent or stored.
  useEffect(() => {
    const v = vision.current, el = analysisVideoRef.current;
    if (stage !== "check" || calib !== "done" || !postureReady || !props.privacy.posture || !v || !el) return;
    const recent: string[] = [];
    const id = setInterval(() => {
      const f = v.analyze(el);
      if (!f) return;
      const s = v.toSample(f, 0);
      recent.push(!s.face ? LIVE_POSTURE.off_frame : s.sway === null ? "Shoulders out of view" : s.slouch === null ? "Looking down" : LIVE_POSTURE[postureKind(s) ?? "upright"]);
      if (recent.length > 4) recent.shift();
      // Show what held for most of the last second, so tracker jitter doesn't flicker the label.
      const counts = new Map<string, number>();
      for (const r of recent) counts.set(r, (counts.get(r) ?? 0) + 1);
      setLivePosture([...counts].sort((a, b) => b[1] - a[1])[0][0]);
    }, 250);
    return () => clearInterval(id);
  }, [stage, calib, postureReady, props.privacy.posture]);

  // ─── Enter the Room ─────────────────────────────────────────────────────
  const enter = useCallback(async () => {
    if (!consent || !devices) return;
    setStage("entering");
    // Prefer a managed avatar vendor when configured; the on-device interviewer is the fallback.
    try {
      await new ExternalAvatarProvider().createSession({ seats: props.seats, pressure: props.pressure, stillness: props.stillness });
    } catch { /* not configured → local */ }
    avatarSession.current = await provider.createSession({ seats: props.seats, pressure: props.pressure, stillness: props.stillness });
    const sttMode = !devices.mic ? "none" : LiveTranscriber.supported() ? "browser" : props.serverStt ? "server" : "none";
    const c = new RoomController({
      sessionId: props.sessionId, provider, avatarSession: avatarSession.current,
      micStream: devices.mic, cameraStream: devices.cam, record: consent.recording,
      vision: consent.cameraMetrics && visionReady ? vision.current : null, videoEl: analysisVideoRef.current,
      sttMode, onEnded: () => router.push(`/playback/${props.sessionId}?processing=1`),
      onState: (st) => {
        setUi(st);
        if (st.phase === "listening" && st.caption && st.caption !== lastAsked.current) {
          lastAsked.current = st.caption;
          const seat = props.seats.find((x) => x.seat === st.activeSeat) ?? props.seats[0];
          const line = st.caption;
          setAsked((h) => [...h, { t: Date.now() - startedAt.current, who: callName(seat.name, seat.style), text: line }]);
        }
      },
    });
    if (sttMode === "none") c.switchToText();
    controller.current = c;
    await new Promise((r) => setTimeout(r, 900)); // let the room light up before the first word
    startedAt.current = Date.now();
    setStage("live");
    void c.start();
  }, [consent, devices, props, provider, router, visionReady]);

  useEffect(() => {
    if (stage !== "live") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 1000);
    return () => clearInterval(id);
  }, [stage]);

  // Keyboard: Space = done answering, M = mute, C = captions, T = type or speak. Never while typing,
  // and never with a modifier, so browser shortcuts (copy, minimise) keep working.
  useEffect(() => {
    if (stage !== "live") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space" && ui?.phase === "listening" && ui.inputMode === "voice") { e.preventDefault(); void controller.current?.finishAnswer(false); }
      else if (k === "m") toggleMute();
      else if (k === "c") setCaptions((c) => !c);
      else if (k === "t") toggleInput();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Leaving mid-interview (reload, closed tab) keeps the session live so it can be
  // rejoined; the server finalises abandoned sessions after 30 idle minutes.

  useEffect(() => () => {
    devices?.mic?.getTracks().forEach((t) => t.stop());
    devices?.cam?.getTracks().forEach((t) => t.stop());
    vision.current?.close();
  }, [devices]);

  function toggleInput() {
    if (ui?.inputMode === "voice") controller.current?.switchToText();
    else if (devices?.mic) controller.current?.switchToVoice();
  }

  function toggleMute() {
    const m = !muted;
    setMuted(m);
    controller.current?.setMuted(m);
  }

  async function endNow() {
    setConfirmEnd(false);
    setStage("ending");
    await controller.current?.end("ended_early");
  }

  const phase = ui?.phase;
  const active = props.seats.find((s) => s.seat === (ui?.activeSeat ?? 0)) ?? props.seats[0];
  const remaining = Math.max(0, props.targetMinutes * 60000 - elapsed);
  const live = stage === "entering" || stage === "live" || stage === "ending";
  const clock = `${Math.floor(elapsed / 60000)}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}`;
  // The question stays readable once it has been asked; while it is being spoken, only with captions on.
  const question = ui?.caption ?? null;
  const showQuestion = !!question && phase !== "starting" && (phase !== "interviewer" || captions);
  const status = phase === "starting" ? "Connecting" : phase === "listening" ? (ui?.inputMode === "text" ? "Your turn: type" : "Listening")
    : phase === "interviewer" ? (ui?.voice === "browser" ? "Backup voice" : "Speaking") : phase === "processing" ? "Thinking" : "";

  return (
    <div className="fixed inset-0 overflow-hidden bg-page text-fg">
      {devices?.cam && <video ref={analysisVideoRef} muted playsInline aria-hidden className="pointer-events-none absolute size-px opacity-0" />}

      {live && (
        <div className="absolute inset-0 flex flex-col">
          {/* Session bar: where you are, how long, whether it's recording. */}
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <LogoMark className="w-6 text-fg" />
              <p className="truncate text-meta text-fg-muted"><span className="font-medium text-fg">Mock interview</span><span className="hidden sm:inline"> · {props.role}</span></p>
            </div>
            <div className="flex shrink-0 items-center gap-4 text-meta">
              {ui?.recording && <span className="flex items-center gap-1.5 text-fg-muted"><span className="size-1.5 rounded-full bg-danger" aria-hidden />Recording</span>}
              <span className="text-fg"><Clock text={clock} /><span className="hidden text-fg-subtle sm:inline"> · {Math.ceil(remaining / 60000)} min left</span></span>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <main className={cn("relative flex min-w-0 flex-1 flex-col transition-opacity duration-700", stage === "entering" ? "opacity-0" : "opacity-100")}>
              {/* The interviewer */}
              <div className="relative min-h-0 flex-1">
                {voiceOnly ? <VoiceFace provider={provider} name={active.name} /> : (
                  <AvatarBoundary fallback={<VoiceFace provider={provider} name={active.name} />} onError={() => setVoiceOnly(true)}>
                    <BotAvatar store={provider.store} seats={props.seats} className="absolute inset-0"
                      labels={props.seats.length > 1 ? (s, isActive) => (
                        <span className={cn("block whitespace-nowrap text-meta font-medium transition-colors duration-500", isActive ? "text-fg" : "text-fg-subtle")}>
                          {callName(s.name, s.style)} · {props.seats.find((x) => x.seat === s.seat)?.title}
                        </span>
                      ) : undefined} />
                  </AvatarBoundary>
                )}
                {/* Your camera */}
                {devices?.cam && (
                  <div className="absolute bottom-3 right-3 z-10 aspect-video w-[min(28vw,240px)] min-w-[112px] overflow-hidden rounded-control border border-control bg-surface sm:bottom-4 sm:right-4">
                    <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
                    <span className="absolute bottom-1.5 left-2 text-meta font-medium text-fg">You</span>
                    {phase === "listening" && ui?.inputMode === "voice" && <MicRing controller={controller.current} />}
                  </div>
                )}
              </div>

              {/* The conversation: who is talking, and the question you're answering. */}
              <div className="shrink-0 px-5 pb-5 pt-2 sm:px-10">
                <div className="mx-auto max-w-[44rem]">
                  <p className="flex items-center gap-2 text-meta">
                    <span className={cn("size-1.5 shrink-0 rounded-full transition-colors duration-300", phase === "interviewer" ? "bg-fg" : phase === "listening" ? "bg-accent" : "bg-fg-subtle")} aria-hidden />
                    <span className="font-medium text-fg">{active.name} · {active.title}</span>
                    <span className="text-fg-subtle">AI</span>
                  </p>
                  {/* The hand-off between questions: once you finish, your question settles back while the
                      interviewer thinks; the next one rises in as it is said (or when it has been said,
                      with captions off), and grows sentence by sentence with the voice. */}
                  <div className="mt-2 min-h-[4.25rem]">
                    {showQuestion && (
                      <p key={ui?.questionKey ?? question} className={cn("text-display-m transition-[color,opacity] duration-[var(--dur-panel)] ease-[var(--ease-state)] motion-safe:animate-[enter_var(--dur-panel)_var(--ease-enter)]",
                        phase === "processing" ? "text-fg-muted opacity-60" : "text-fg")}>{question}</p>
                    )}
                  </div>
                  {stage === "live" && ui?.phase === "listening" && ui.inputMode === "text" && (
                    <form onSubmit={(e) => { e.preventDefault(); controller.current?.submitText(typed); setTyped(""); }} className="mt-3 flex items-end gap-2">
                      <textarea autoFocus value={typed} onChange={(e) => { controller.current?.noteKeystroke(); setTyped(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); controller.current?.submitText(typed); setTyped(""); } }}
                        rows={2} placeholder="Type your answer. Enter sends it." aria-label="Your answer" className="flex-1 resize-none rounded-control border border-control bg-surface px-3.5 py-2.5 text-body leading-relaxed transition-colors duration-[var(--dur-press)] hover:border-fg-subtle" />
                      <Button type="submit" disabled={!typed.trim()}>Send</Button>
                    </form>
                  )}
                  {stage === "live" && ui?.hint && <p className="mt-3 text-ui text-fg-muted">{ui.hint}</p>}
                </div>
              </div>
            </main>

            {/* The rail: context you can glance at without leaving the conversation. */}
            <aside aria-label="Questions so far" className="hidden w-[300px] shrink-0 flex-col border-l border-line xl:flex">
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <p className="text-ui font-medium text-fg">Questions so far</p>
                {asked.length ? (
                  <ol className="mt-4 space-y-5">
                    {asked.map((q, i) => (
                      <li key={i} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2">
                        <span className="text-meta text-fg-subtle">{Math.floor(q.t / 60000)}:{String(Math.floor((q.t % 60000) / 1000)).padStart(2, "0")}</span>
                        <span>
                          <span className="block text-meta text-fg-subtle">{q.who}</span>
                          <span className={cn("mt-0.5 block font-display text-body leading-snug", i === asked.length - 1 ? "text-fg" : "text-fg-muted")}>{q.text}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="mt-3 text-ui text-fg-subtle">Each question collects here once it has been asked. Nothing is scored on screen while you talk.</p>}
              </div>
            </aside>
          </div>

          {/* Controls */}
          <footer className="shrink-0 border-t border-line px-3 py-3 sm:px-6">
            {stage === "live" ? (
              <nav aria-label="Interview controls" className="flex items-center gap-1.5 sm:gap-2">
                <button type="button" onClick={toggleMute} disabled={!devices?.mic} aria-keyshortcuts="M"
                  className={cn("flex h-10 items-center gap-2 rounded-control px-3 text-ui font-medium transition-colors duration-[var(--dur-press)] disabled:opacity-40 pointer-coarse:h-11", muted ? "bg-danger/10 text-danger" : "text-fg hover:bg-surface")}>
                  {muted ? "Unmute" : <><MicMeter controller={controller.current} live={phase === "listening" && ui?.inputMode === "voice"} />Mute</>}
                  <Kbd className="hidden md:inline-grid">M</Kbd>
                </button>
                <Ctl on={captions} onClick={() => setCaptions(!captions)} shortcut="C">Captions</Ctl>
                {ui?.inputMode === "voice"
                  ? <Ctl onClick={() => controller.current?.switchToText()} shortcut="T">Type<span className="sr-only"> instead</span></Ctl>
                  : devices?.mic ? <Ctl onClick={() => controller.current?.switchToVoice()} shortcut="T">Speak<span className="sr-only"> instead</span></Ctl> : null}
                <p aria-live="polite" className="min-w-0 flex-1 truncate text-center text-meta text-fg-muted">{status}</p>
                {ui?.inputMode === "voice" && (
                  <Button variant="secondary" size="md" disabled={ui?.phase !== "listening"} onClick={() => void controller.current?.finishAnswer(false)} aria-keyshortcuts="Space" className="px-3.5">
                    <span className="hidden sm:inline">Done answering</span><span className="sm:hidden">Done</span><Kbd className="hidden md:inline-grid">Space</Kbd>
                  </Button>
                )}
                <Button variant="danger" size="md" className="px-4" onClick={() => setConfirmEnd(true)}>End</Button>
              </nav>
            ) : <div className="h-10" />}
          </footer>
        </div>
      )}

      {/* Consent */}
      <ConsentDialog open={stage === "consent"} recordingAllowed={props.privacy.recordVideo}
        defaults={{ microphone: true, camera: true, recording: props.privacy.recordVideo, cameraMetrics: props.privacy.cameraMetrics }}
        onConfirm={onConsent} onCancel={() => router.push("/practice")} />

      {/* Device check */}
      {stage === "check" && devices && (
        <main className="relative z-10 mx-auto grid min-h-dvh max-w-5xl items-center gap-10 px-5 py-20 lg:grid-cols-[1.2fr_1fr]">
          {devices.cam ? (
            <div className="relative aspect-video overflow-hidden rounded-panel bg-surface">
              <video ref={checkVideoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
              {calib === "running" && <div className="absolute inset-0 grid place-items-center bg-page/50"><p className="rounded-control bg-page px-4 py-2 text-ui">Look straight into your camera lens…</p></div>}
            </div>
          ) : (
            <figure>
              <InterviewerStage personaIds={props.seats.map((s) => s.personaId)} styles={Object.fromEntries(props.seats.map((s) => [s.personaId, s.style ?? null]))} className="mx-auto h-[clamp(14rem,10rem+14vw,24rem)] w-full" />
              <figcaption className="-mt-1 text-center text-ui text-fg-muted">
                {props.seats.length > 1 ? `Your panel of ${props.seats.length} is ready.` : <><span className="text-fg">{callName(props.seats[0].name, props.seats[0].style)}</span> is ready{devices.camError ? `. ${devices.camError}` : "."}</>}
              </figcaption>
            </figure>
          )}
          <div>
            <h1 className="text-display-l text-fg">{props.resuming ? "Pick up where you left off." : "Check your setup."}</h1>
            <ul className="mt-8 border-t border-line text-ui">
              <Check ok={!!devices.mic} label={devices.mic ? "Microphone" : devices.micError ?? "Microphone off"}>
                {devices.mic && <div className="mt-2 h-0.5 w-40 overflow-hidden bg-line-strong"><div className="h-full origin-left bg-accent transition-transform duration-100" style={{ transform: `scaleX(${micLevel})` }} /></div>}
                {devices.mic && <p className="mt-1.5 text-meta text-fg-subtle">Say something; the line should move.</p>}
              </Check>
              <Check ok={!!devices.cam} label={devices.cam ? "Camera" : devices.camError ?? "Camera off"} />
              <Check ok={!devices.mic ? false : LiveTranscriber.supported() || props.serverStt} label={!devices.mic ? "Text mode: you'll type your answers" : LiveTranscriber.supported() ? "Live speech recognition" : props.serverStt ? "Server transcription (answers are transcribed after you finish)" : "No speech recognition, so you'll type"} />
              {consent?.cameraMetrics && devices.cam && (
                <Check ok={calib === "done"} label={calib === "done" ? "Camera lens calibrated" : calib === "unavailable" ? "On-device tracking unavailable, so camera signals will be skipped" : "Calibrate to measure camera engagement and posture (skip it and we won't measure gaze, slouch or lean)"}>
                  {calib !== "done" && calib !== "unavailable" && <Button size="sm" variant="secondary" className="mt-2" onClick={calibrate} loading={calib === "running"} disabled={!visionReady}>{visionReady ? "Sit as you normally would and look at the lens for 2 seconds" : "Loading on-device model…"}</Button>}
                  {calib === "failed" && <p className="mt-1.5 text-meta text-warning">We couldn&apos;t see your face clearly. Check your lighting and try again.</p>}
                </Check>
              )}
              {consent?.cameraMetrics && props.privacy.posture && devices.cam && calib === "done" && (
                <Check ok={postureReady} label={postureReady ? "Posture" : "Posture: shoulders not in view"}>
                  {postureReady ? (
                    <p className="mt-1.5 text-meta text-fg-subtle" aria-live="polite">Right now: <span className="text-fg">{livePosture ?? "…"}</span>. Try sitting back or leaning in. Nothing here is saved.</p>
                  ) : (
                    <>
                      <p className="mt-1.5 text-meta text-warning">Sit back a little or tilt your camera down so your shoulders are in view, then recalibrate. Without that we can measure sway, but not slouch.</p>
                      <Button size="sm" variant="secondary" className="mt-2" onClick={calibrate}>Recalibrate</Button>
                    </>
                  )}
                </Check>
              )}
            </ul>
            {(devices.micError || devices.camError) && <p className="mt-6 text-meta text-fg-subtle">To allow access later, use the camera icon in your browser&apos;s address bar, then reload.</p>}
            <div className="mt-10 flex gap-3">
              <Button size="lg" onClick={enter}>{props.resuming ? "Rejoin the Room" : "Enter the Room"}</Button>
              <Button variant="ghost" size="lg" onClick={() => router.push("/practice")}>Back</Button>
            </div>
          </div>
        </main>
      )}

      {stage === "entering" && (
        <div className="absolute inset-0 z-10 grid place-items-center"><Thinking label="Entering the room" className="text-body" /></div>
      )}

      {(stage === "ending" || phase === "ending" || phase === "ended") && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-page/90">
          <div className="text-center">
            <p className="text-display-l text-fg">{ui?.complete ? "That's the interview." : "Wrapping up."}</p>
            <p className="mt-4"><Thinking label="Saving your session and preparing your Read" /></p>
          </div>
        </div>
      )}

      {/* Recovery */}
      <Modal open={stage === "live" && phase === "error"} onClose={() => {}} title="Connection problem" dismissible={false}>
        <div className="p-8">
          <h2 className="text-display-m text-fg">{ui?.error?.message ?? "We lost the interviewer connection."}</h2>
          <p className="mt-3 text-ui text-fg-muted">Everything you&apos;ve said so far is saved.</p>
          <div className="mt-7 flex flex-wrap gap-2">
            <Button onClick={() => void controller.current?.retry()}>Reconnect</Button>
            {!voiceOnly && <Button variant="secondary" onClick={() => { setVoiceOnly(true); void controller.current?.retry(); }}>Continue with voice</Button>}
            <Button variant="danger" onClick={endNow}>End session</Button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End the interview?">
        <div className="p-8">
          <h2 className="text-display-m text-fg">End the interview?</h2>
          <p className="mt-3 text-ui text-fg-muted">You&apos;ll still get a Read and Playback for everything you said so far.</p>
          <div className="mt-7 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Keep going</Button>
            <Button variant="danger" onClick={endNow}>End and see my Read</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** The running clock: digits at one width so the time never jitters, the colon at its own. */
function Clock({ text }: { text: string }) {
  const [m, sec] = text.split(":");
  return <span className="tabular-nums">{m}<span className="[font-variant-numeric:normal]">:</span>{sec}</span>;
}

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd aria-hidden className={cn("inline-grid h-5 min-w-5 place-items-center rounded-sm border border-control px-1 text-meta leading-none text-fg-muted", className)}>{children}</kbd>;
}

/** A control in the Room's toolbar. Its name is what it shows (plus any words only a screen reader needs). */
function Ctl({ children, on, onClick, disabled, shortcut }: { children: ReactNode; on?: boolean; onClick: () => void; disabled?: boolean; shortcut?: string }) {
  return (
    <button type="button" aria-pressed={on} aria-keyshortcuts={shortcut} onClick={onClick} disabled={disabled}
      className={cn("flex h-10 items-center gap-2 rounded-control px-3 text-ui font-medium transition-colors duration-[var(--dur-press)] disabled:opacity-40 pointer-coarse:h-11", on ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--color-control)]" : "text-fg hover:bg-surface")}>
      {children}
      {shortcut && <Kbd className="hidden md:inline-grid">{shortcut}</Kbd>}
    </button>
  );
}

function Check({ ok, label, children }: { ok: boolean; label: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 border-b border-line py-3">
      <span className={cn("w-4 shrink-0 pt-px text-meta", ok ? "text-success" : "text-fg-subtle")} aria-hidden>{ok ? "✓" : "–"}</span>
      <div><p className={ok ? "text-fg" : "text-fg-muted"}>{label}</p>{children}</div>
    </li>
  );
}

/** Four bars that follow your voice while you answer; still when you're not being heard. */
function MicMeter({ controller, live }: { controller: RoomController | null; live: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const bars = ref.current?.children;
      const l = live && controller ? controller.micLevel : 0;
      if (bars) for (let i = 0; i < bars.length; i++) (bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.2, Math.min(1, l * (1.6 - i * 0.25) + 0.12))})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [controller, live]);
  return (
    <span ref={ref} className="flex h-3.5 items-center gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-full w-[2px] origin-center rounded-full", live ? "bg-accent" : "bg-fg-subtle")} />)}
    </span>
  );
}

function MicRing({ controller }: { controller: RoomController | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (ref.current && controller) ref.current.style.boxShadow = `inset 0 0 0 ${1 + controller.micLevel * 3}px rgb(${PALETTE.accentRgb} / ${0.3 + controller.micLevel * 0.6})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [controller]);
  return <div ref={ref} className="pointer-events-none absolute inset-0 rounded-control" />;
}

/** Voice-only interviewer: Oriel's own face, breathing with the same voice level. */
function VoiceFace({ provider, name }: { provider: LocalAvatarProvider; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const l = provider.store.level();
      const t = performance.now() / 1000;
      if (ref.current) ref.current.style.transform = `scale(${1 + Math.sin(t * 1.4) * 0.015 + l * 0.12})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [provider]);
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="text-center">
        <div ref={ref} className="mx-auto w-40"><Interviewer size={160} className="w-full" /></div>
        <p className="mt-6 text-meta text-fg-subtle">{name}, voice only</p>
      </div>
    </div>
  );
}
