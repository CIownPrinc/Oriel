import { analyzeAnswer, words } from "@/lib/analysis/text";
import type { LocalAvatarProvider } from "@/lib/avatar/local-provider";
import type { AvatarSession } from "@/lib/avatar/types";
import { speakWithBrowser } from "@/lib/avatar/audio";
import type { RoomEvent } from "@/server/interview/service";
import { MicAnalyzer } from "./mic";
import { LiveTranscriber } from "./speech";
import { AnswerRecorder, SessionRecorder } from "./recorder";
import { readNdjson } from "./stream";
import type { VisionTracker } from "./vision";

/**
 * The Room's turn loop (client side).
 *
 *   interviewer speaks → LISTENING (VAD + live transcript) → endpoint or interrupt
 *   → turn request (server decides + phrases + streams voice) → intentional silence
 *   → interviewer speaks → …
 *
 * Every timestamp is on one session clock that starts with the recording, so the
 * transcript, the signal timelines and the video line up exactly for Playback.
 */
export type RoomPhase = "starting" | "interviewer" | "listening" | "processing" | "ending" | "ended" | "error";

export interface RoomUiState {
  phase: RoomPhase;
  activeSeat: number;
  caption: string | null;
  /** Changes once per interviewer utterance, so the caption can animate in once and then grow in place. */
  questionKey: number;
  transcript: string;
  inputMode: "voice" | "text";
  sttMode: "browser" | "server" | "none";
  voice: "server" | "browser";
  error: { kind: "connection" | "server" | "mic"; message: string } | null;
  complete: boolean;
  recording: boolean;
  hint: string | null;
}

type Listening = Extract<RoomEvent, { type: "done" }>["listening"];

export interface RoomControllerOptions {
  sessionId: string;
  provider: LocalAvatarProvider;
  avatarSession: AvatarSession;
  micStream: MediaStream | null;
  cameraStream: MediaStream | null;
  record: boolean;
  vision: VisionTracker | null;
  videoEl: HTMLVideoElement | null;
  sttMode: "browser" | "server" | "none";
  onState: (s: RoomUiState) => void;
  onEnded: () => void;
}

export class RoomController {
  private t0 = 0;
  private mic: MicAnalyzer | null = null;
  private transcriber = new LiveTranscriber();
  private recorder: SessionRecorder | null = null;
  private answerRec = new AnswerRecorder();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private listenTimer: ReturnType<typeof setInterval> | null = null;
  private listening: Listening | null = null;
  private questionId: string | null = null;
  private questionStart = 0;
  private questionEnd = 0;
  private answerStart: number | null = null;
  private firstKeyAt: number | null = null;
  private finishing = false;
  private lastVagueCheck = 0;
  private uploads: Promise<unknown>[] = [];
  private pendingAnswerAudio: Blob | null = null;
  private latencies: number[] = [];
  private lastClientTimings: Record<string, number> = {};
  private ended = false;
  private state: RoomUiState;

  constructor(private o: RoomControllerOptions) {
    this.state = {
      phase: "starting", activeSeat: 0, caption: null, questionKey: 0, transcript: "", inputMode: o.micStream ? "voice" : "text",
      sttMode: o.sttMode, voice: "server", error: null, complete: false, recording: false, hint: null,
    };
  }

  get clock() {
    return performance.now() - this.t0;
  }

  private set(patch: Partial<RoomUiState>) {
    this.state = { ...this.state, ...patch };
    this.o.onState(this.state);
  }

  private get audio() {
    return this.o.provider.audio!;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  async start() {
    this.t0 = performance.now();
    const ctx = this.audio.ctx;
    if (this.o.micStream) {
      this.mic = new MicAnalyzer(ctx, this.o.micStream, () => this.clock);
      this.mic.start();
    }
    // Recording mix: candidate mic + interviewer voice, plus the camera track.
    if (this.o.record) {
      const mix = ctx.createMediaStreamDestination();
      if (this.o.micStream) ctx.createMediaStreamSource(this.o.micStream).connect(mix);
      this.audio.out.connect(mix);
      const video = this.o.cameraStream?.getVideoTracks()[0];
      const stream = new MediaStream([...(video ? [video] : []), ...mix.stream.getAudioTracks()]);
      this.recorder = new SessionRecorder(this.o.sessionId, stream, !!video);
      this.set({ recording: this.recorder.start() });
    }
    if (this.o.vision && this.o.videoEl) {
      this.o.vision.start(this.o.videoEl, () => this.clock);
      void this.post("signals", { kind: "setup", startMs: 0, samples: [this.o.vision.setupSample(this.mic ? Math.round(this.mic.peakDb) : null, this.mic?.noiseFloorDb ?? null)] });
    }
    this.flushTimer = setInterval(() => this.flushSignals(), 8000);
    await this.request(`/api/sessions/${this.o.sessionId}/start`, undefined, null);
  }

  /** End the interview (completed, user ended, or disconnected). Idempotent. */
  async end(reason: "completed" | "ended_early" | "disconnected") {
    if (this.ended) return;
    this.ended = true;
    this.stopListening();
    this.transcriber.abort();
    this.audio.stop();
    window.speechSynthesis?.cancel();
    this.set({ phase: "ending", caption: null });
    this.o.vision?.stop();
    if (this.flushTimer) clearInterval(this.flushTimer);
    await Promise.race([Promise.allSettled([this.recorder?.stop(), this.flushSignals(), ...this.uploads]), new Promise((r) => setTimeout(r, 12000))]);
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
    try {
      await fetch(`/api/sessions/${this.o.sessionId}/complete`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason, durationMs: Math.round(this.clock), avatarProvider: this.o.provider.id,
          degradedMode: this.state.inputMode === "text" ? "text" : null,
          clientLatency: { turns: sorted.length, medianMs: q(0.5), p90Ms: q(0.9) },
        }),
      });
    } catch { /* the pipeline also finalises sessions that never call complete */ }
    this.mic?.close();
    this.set({ phase: "ended" });
    this.o.onEnded();
  }

  // ─── Server round-trips ─────────────────────────────────────────────────

  /**
   * Reconnect after a dropped connection. The start endpoint is idempotent: it
   * repeats the last question the server recorded, so a turn that was (or wasn't)
   * processed before the drop can never be applied twice.
   */
  async retry() {
    this.audio.stop();
    this.set({ error: null, phase: "processing" });
    await this.request(`/api/sessions/${this.o.sessionId}/start`, undefined, null);
  }

  private async request(url: string, body: unknown, answerEnd: number | null): Promise<void> {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    } catch {
      return this.set({ phase: "error", error: { kind: "connection", message: "We lost the interviewer connection." } });
    }
    if (res.status === 409) {
      await new Promise((r) => setTimeout(r, 800));
      return this.request(url, body, answerEnd);
    }
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The interviewer couldn't continue.";
      return this.set({ phase: "error", error: { kind: res.status >= 500 ? "connection" : "server", message: msg } });
    }
    const t0 = this.clock;
    let seat = this.state.activeSeat;
    let preSilence = 0;
    let firstAudio = false;
    let browserVoice: Promise<void> | null = null;
    let done: Extract<RoomEvent, { type: "done" }> | null = null;
    let text = "";
    try {
      await readNdjson<RoomEvent>(res, async (ev) => {
        switch (ev.type) {
          case "decision": {
            seat = ev.seat;
            preSilence = ev.preSilenceMs;
            this.o.provider.store.pressure = ev.pressure;
            // High pressure: hold a still, direct gaze through the silence. Otherwise a brief "thinking" beat.
            if (this.o.provider.store.mode !== "interrupting") await this.o.provider.setState(this.o.avatarSession, ev.pressure >= 4 ? "listening" : "thinking", { seat });
            if (ev.avatarCue === "brow_raise" || ev.avatarCue === "nod" || ev.avatarCue === "gaze_shift") this.o.provider.store.fireCue(ev.avatarCue, seat);
            this.set({ activeSeat: seat });
            if (ev.answerId) this.uploadAnswerAudio(ev.answerId);
            break;
          }
          case "text":
            text = ev.text;
            this.questionId = ev.questionId;
            // Once the interviewer is speaking, the caption grows with each sentence sent to the voice.
            if (firstAudio && this.state.phase === "interviewer") this.set({ caption: text });
            break;
          case "audio": {
            if (!firstAudio) {
              firstAudio = true;
              const hold = answerEnd === null ? 0 : Math.max(0, preSilence - (this.clock - answerEnd));
              this.audio.beginUtterance(hold);
              void this.audio.waitForStart().then(() => this.onInterviewerStarts(seat, text, answerEnd, preSilence, t0));
            }
            await this.o.provider.sendAudio(this.o.avatarSession, { pcmBase64: ev.pcm, sampleRate: ev.sampleRate });
            break;
          }
          case "audio_end":
            this.audio.endUtterance();
            break;
          case "tts_fallback": {
            this.set({ voice: "browser" });
            if (firstAudio) {
              // The acknowledgement was voiced by the server; the rest follows in the local voice, after it.
              const rest = ev.text ?? text;
              browserVoice = this.audio.waitForEnd().then(() => speakWithBrowser(rest, { audio: this.audio, onStart: () => this.set({ caption: text }) }));
              break;
            }
            const hold = answerEnd === null ? 0 : Math.max(0, preSilence - (this.clock - answerEnd));
            browserVoice = new Promise<void>((r) => setTimeout(r, hold)).then(() =>
              speakWithBrowser(text, { audio: this.audio, onStart: () => this.onInterviewerStarts(seat, text, answerEnd, preSilence, t0) }));
            break;
          }
          case "done":
            done = ev;
            this.lastClientTimings = { serverToFirstAudioMs: ev.timings.serverToFirstAudioMs ?? -1, llmMs: ev.timings.llmMs ?? -1 };
            break;
          case "error":
            throw new Error(ev.message);
        }
      });
    } catch (err) {
      this.audio.stop();
      return this.set({ phase: "error", error: { kind: "connection", message: err instanceof Error && err.message ? err.message : "We lost the interviewer connection." } });
    }
    if (!firstAudio && !browserVoice && text) {
      // No audio at all (e.g. TTS failed mid-stream before any chunk): speak locally.
      this.set({ voice: "browser" });
      browserVoice = speakWithBrowser(text, { audio: this.audio, onStart: () => this.onInterviewerStarts(seat, text, answerEnd, preSilence, t0) });
    }
    if (browserVoice) await browserVoice;
    else {
      await this.audio.waitForEnd();
      // The audio clock stalled, so the question went unheard: the browser's voice doesn't depend on it.
      if (this.audio.stalled && text) {
        this.set({ voice: "browser" });
        await speakWithBrowser(text, { audio: this.audio });
      }
    }
    this.questionEnd = this.clock;
    const d = done as Extract<RoomEvent, { type: "done" }> | null;
    if (!d) return this.set({ phase: "error", error: { kind: "connection", message: "The interviewer stopped mid-sentence." } });
    this.listening = d.listening;
    if (d.complete || this.ended) {
      this.set({ complete: true, caption: null });
      await new Promise((r) => setTimeout(r, 900));
      return this.end("completed");
    }
    this.beginListening();
  }

  private onInterviewerStarts(seat: number, text: string, answerEnd: number | null, preSilence: number, t0: number) {
    this.questionStart = this.clock;
    if (answerEnd !== null) {
      // Perceived latency = end of the candidate's speech → first interviewer sound, minus deliberate silence.
      const perceived = this.questionStart - answerEnd - preSilence;
      this.latencies.push(Math.round(perceived));
      this.lastClientTimings = { ...this.lastClientTimings, prevPerceivedMs: Math.round(perceived), prevRequestToAudioMs: Math.round(this.questionStart - t0) };
    }
    void this.o.provider.setState(this.o.avatarSession, "speaking", { seat });
    this.set({ phase: "interviewer", caption: text, questionKey: this.state.questionKey + 1, activeSeat: seat, transcript: "", hint: null });
  }

  // ─── Listening ───────────────────────────────────────────────────────────

  private beginListening() {
    this.answerStart = null;
    this.firstKeyAt = null;
    this.finishing = false;
    this.lastVagueCheck = 0;
    void this.o.provider.setState(this.o.avatarSession, "listening");
    this.o.provider.store.candidateSpeaking = false;
    this.set({ phase: "listening", transcript: "", hint: null });
    if (this.state.inputMode === "text") return;
    if (this.o.micStream) this.answerRec.start(this.o.micStream);
    if (this.state.sttMode === "browser") {
      this.transcriber.onUpdate = (t) => this.set({ transcript: t });
      this.transcriber.onFatal = () => this.set({ sttMode: this.o.sttMode === "browser" ? "server" : "none", hint: "Live captions stopped; we'll transcribe your answer after you finish." });
      this.transcriber.start();
    }
    this.listenTimer = setInterval(() => this.listenTick(), 100);
  }

  private listenTick() {
    const mic = this.mic;
    if (!mic || this.finishing) return;
    const now = this.clock;
    if (this.answerStart === null && mic.voiced && mic.voiceStartedAt >= this.questionEnd - 300) {
      this.answerStart = Math.max(this.questionEnd, mic.voiceStartedAt);
      this.o.provider.store.candidateSpeaking = true;
    }
    if (this.answerStart === null) {
      if (now - this.questionEnd > 25000 && !this.state.hint) this.set({ hint: "Take your time. Start whenever you're ready, or press Done to move on." });
      return;
    }
    this.o.provider.store.candidateSpeaking = mic.voiced;
    const dur = now - this.answerStart;
    const text = this.transcriber.text;
    const pol = this.listening;
    // Pressure-driven interruptions.
    if (pol?.interruptAfterSec && dur > pol.interruptAfterSec * 1000) return void this.interrupt();
    if (pol?.vagueInterruptAfterSec && dur > pol.vagueInterruptAfterSec * 1000 && now - this.lastVagueCheck > 3000) {
      this.lastVagueCheck = now;
      if (words(text).length > 40 && analyzeAnswer(text, dur / 1000).vagueness >= pol.vagueThreshold) return void this.interrupt();
    }
    // Endpointing: silence after speech, about as long as a person waits before taking the
    // turn. Short when the recogniser has closed the sentence, longer while words are still
    // arriving, and longest for a very short answer (which is often a pause to think).
    if (!mic.voiced) {
      const silence = now - mic.lastVoicedAt;
      const wc = words(text).length;
      const settled = this.state.sttMode === "browser" && this.transcriber.settled;
      const need = wc < 6 ? 1800 : settled ? 700 : 1050;
      const captionsSettling = this.state.sttMode === "browser" && !settled && performance.now() - this.transcriber.lastResultAt < 300;
      if (silence >= need && !captionsSettling) void this.finishAnswer(false);
    }
  }

  private stopListening() {
    if (this.listenTimer) clearInterval(this.listenTimer);
    this.listenTimer = null;
  }

  /** The interviewer cuts in: lean in, then take the turn. */
  private interrupt() {
    void this.o.provider.setState(this.o.avatarSession, "interrupting", { seat: this.state.activeSeat, cue: "lean_in" });
    void this.finishAnswer(true);
  }

  /** Candidate is done (endpoint, interruption, or the Done button). */
  async finishAnswer(interrupted: boolean) {
    if (this.finishing || this.state.phase !== "listening") return;
    this.finishing = true;
    this.stopListening();
    const answerEnd = this.mic && this.answerStart !== null ? Math.max(this.answerStart + 500, this.mic.lastVoicedAt) : this.clock;
    this.set({ phase: "processing", hint: null });
    this.o.provider.store.candidateSpeaking = false;
    if (!interrupted) {
      // The interviewer reacts the moment you stop, as a person would: a small nod (except
      // under high pressure, where the gaze stays level), then a thinking beat while it replies.
      const pressure = this.listening?.pressure ?? 2;
      if (pressure < 4) this.o.provider.store.fireCue("nod", this.state.activeSeat);
      void this.o.provider.setState(this.o.avatarSession, pressure >= 4 ? "listening" : "thinking");
    }
    let text = this.state.sttMode === "browser" ? await this.transcriber.stop() : "";
    const blob = await this.answerRec.stop();
    if (!text && blob && this.state.sttMode !== "none") {
      text = await this.serverTranscribe(blob);
    }
    if (!text.trim()) {
      if (this.answerStart === null && !interrupted) {
        // Nothing was said: keep listening rather than sending an empty answer.
        this.finishing = false;
        this.set({ phase: "listening", hint: "We didn't hear anything. Check your microphone, or switch to typing." });
        this.beginListening();
        return;
      }
      text = "(inaudible)";
    }
    this.pendingAnswerAudio = this.state.sttMode === "browser" ? blob : null;
    const start = this.answerStart ?? this.questionEnd;
    await this.sendTurn({ text, start, end: answerEnd, firstWord: this.answerStart === null ? null : this.answerStart - this.questionEnd, interrupted, mode: "voice" });
  }

  submitText(text: string) {
    if (this.state.phase !== "listening" || !text.trim()) return;
    this.finishing = true;
    this.stopListening();
    this.transcriber.abort();
    const end = this.clock;
    const start = this.firstKeyAt ?? this.questionEnd;
    this.set({ phase: "processing", transcript: text });
    void this.o.provider.setState(this.o.avatarSession, "thinking");
    // Typing speed is not speech: no first-word latency for typed answers.
    void this.sendTurn({ text, start, end, firstWord: null, interrupted: false, mode: "text" });
  }

  noteKeystroke() {
    if (this.firstKeyAt === null) this.firstKeyAt = this.clock;
  }

  private async sendTurn(a: { text: string; start: number; end: number; firstWord: number | null; interrupted: boolean; mode: "voice" | "text" }) {
    this.set({ transcript: a.text });
    const body = {
      answerText: a.text, startMs: Math.round(a.start), endMs: Math.round(Math.max(a.end, a.start + 1)),
      firstWordLatencyMs: a.firstWord === null ? null : Math.max(0, Math.round(a.firstWord)), interrupted: a.interrupted, inputMode: a.mode,
      prevQuestion: this.questionId ? { questionId: this.questionId, startMs: Math.round(this.questionStart), endMs: Math.round(this.questionEnd) } : null,
      clientTimings: this.lastClientTimings,
    };
    await this.request(`/api/sessions/${this.o.sessionId}/turn`, body, a.mode === "voice" ? a.end : this.clock);
  }

  private async serverTranscribe(blob: Blob): Promise<string> {
    try {
      const res = await fetch(`/api/sessions/${this.o.sessionId}/transcribe`, { method: "POST", headers: { "content-type": blob.type.split(";")[0] || "audio/webm" }, body: blob });
      if (!res.ok) {
        if (res.status === 501) this.set({ sttMode: "none" });
        return "";
      }
      return ((await res.json()) as { text: string }).text ?? "";
    } catch {
      return "";
    }
  }

  private uploadAnswerAudio(answerId: string) {
    const blob = this.pendingAnswerAudio;
    this.pendingAnswerAudio = null;
    if (!blob || blob.size < 1000) return;
    this.uploads.push(fetch(`/api/sessions/${this.o.sessionId}/answers/${answerId}/audio`, { method: "POST", headers: { "content-type": blob.type.split(";")[0] || "audio/webm" }, body: blob }).catch(() => null));
  }

  // ─── Controls ────────────────────────────────────────────────────────────

  setMuted(muted: boolean) {
    this.o.micStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    if (this.mic) this.mic.muted = muted;
  }

  switchToText() {
    this.transcriber.abort();
    this.stopListening();
    void this.answerRec.stop();
    this.set({ inputMode: "text", hint: null });
    if (this.state.phase === "listening") this.finishing = false;
  }

  switchToVoice() {
    if (!this.o.micStream) return;
    this.set({ inputMode: "voice" });
    if (this.state.phase === "listening") this.beginListening();
  }

  get micLevel() {
    return this.mic?.level ?? 0;
  }

  private async flushSignals() {
    const audio = this.mic?.drain() ?? [];
    const vision = this.o.vision?.drain() ?? [];
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < audio.length; i += 1500) jobs.push(this.post("signals", { kind: "audio", startMs: audio[i].t, samples: audio.slice(i, i + 1500) }));
    for (let i = 0; i < vision.length; i += 1500) jobs.push(this.post("signals", { kind: "vision", startMs: vision[i].t, samples: vision.slice(i, i + 1500) }));
    await Promise.allSettled(jobs);
  }

  private post(path: string, body: unknown) {
    return fetch(`/api/sessions/${this.o.sessionId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  }
}
