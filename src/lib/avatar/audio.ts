/**
 * Interviewer audio engine: plays streamed 16-bit PCM gap-free through WebAudio,
 * exposes a smoothed level for lip-sync, and taps the output into the recording mix
 * so Playback contains both voices.
 */
import { loadBrowserVoices, pickBrowserVoice } from "./browser-voice";

export class InterviewerAudio {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  readonly out: GainNode;
  readonly recordTap: MediaStreamAudioDestinationNode;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private buf: Float32Array<ArrayBuffer>;
  private smoothed = 0;
  private streamOpen = false;
  private endWaiters: (() => void)[] = [];
  private startWaiters: (() => void)[] = [];
  private started = false;
  /** Wall-clock (performance.now) when the first chunk of the current utterance started playing. */
  startedAt: number | null = null;
  synthetic: (() => number) | null = null;
  /** The audio clock stopped during the last utterance, so it wasn't heard. */
  stalled = false;
  private stallTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: "interactive" });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.2;
    this.out = this.ctx.createGain();
    this.recordTap = this.ctx.createMediaStreamDestination();
    this.out.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.out.connect(this.recordTap);
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /** Begin a new utterance. `holdMs` delays the first sound (intentional interviewer silence). */
  beginUtterance(holdMs = 0) {
    this.streamOpen = true;
    this.started = false;
    this.startedAt = null;
    this.stalled = false;
    this.nextTime = Math.max(this.ctx.currentTime + 0.04 + holdMs / 1000, this.nextTime);
  }

  enqueuePcm(base64: string, sampleRate: number) {
    const bin = atob(base64);
    const n = bin.length >> 1;
    if (!n) return;
    const buffer = this.ctx.createBuffer(1, n, sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      ch[i] = v / 32768;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    const at = Math.max(this.nextTime, this.ctx.currentTime + 0.02);
    src.start(at);
    this.nextTime = at + buffer.duration;
    this.sources.add(src);
    if (!this.started) {
      this.started = true;
      const delayMs = Math.max(0, (at - this.ctx.currentTime) * 1000);
      setTimeout(() => {
        this.startedAt = performance.now();
        this.startWaiters.splice(0).forEach((f) => f());
      }, delayMs);
    }
    src.onended = () => {
      this.sources.delete(src);
      this.checkEnd();
    };
  }

  /** No more chunks will arrive for this utterance. */
  endUtterance() {
    this.streamOpen = false;
    if (!this.started) this.startWaiters.splice(0).forEach((f) => f());
    this.checkEnd();
  }

  private checkEnd() {
    if (!this.streamOpen && this.sources.size === 0) this.endWaiters.splice(0).forEach((f) => f());
  }

  waitForStart(): Promise<void> {
    if (this.started || !this.streamOpen) return Promise.resolve();
    return new Promise((r) => this.startWaiters.push(r));
  }

  waitForEnd(): Promise<void> {
    if (!this.streamOpen && this.sources.size === 0) return Promise.resolve();
    this.watchForStall();
    return new Promise((r) => this.endWaiters.push(r));
  }

  /**
   * "Ended" comes from the audio clock, and a browser can report a running context whose clock
   * never moves (an audio device asleep or taken away). Without this the interview would wait
   * forever, so a clock stopped for 4s ends the utterance and marks it as unheard.
   */
  private watchForStall() {
    if (this.stallTimer) return;
    let last = this.ctx.currentTime;
    let movedAt = performance.now();
    const clear = () => { if (this.stallTimer) clearInterval(this.stallTimer); this.stallTimer = null; };
    this.stallTimer = setInterval(() => {
      if (!this.streamOpen && this.sources.size === 0) return clear();
      if (this.ctx.currentTime > last + 0.01) { last = this.ctx.currentTime; movedAt = performance.now(); return; }
      void this.ctx.resume().catch(() => {});
      if (performance.now() - movedAt > 4000) {
        clear();
        this.stalled = true;
        this.stop();
      }
    }, 500);
  }

  /** Cut the interviewer off immediately (e.g. session ended). */
  stop() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.streamOpen = false;
    this.nextTime = this.ctx.currentTime;
    this.checkEnd();
  }

  get playing() {
    return this.sources.size > 0;
  }

  /** Smoothed 0..1 loudness for the mouth. Fast attack, slower release. */
  level(): number {
    if (this.synthetic) return this.synthetic();
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    const target = Math.min(1, rms * 5.5);
    this.smoothed += (target - this.smoothed) * (target > this.smoothed ? 0.55 : 0.18);
    return this.smoothed;
  }

  close() {
    if (this.stallTimer) clearInterval(this.stallTimer);
    this.stallTimer = null;
    this.stop();
    void this.ctx.close();
  }
}

/**
 * Last-resort voice: the browser's own speech synthesis (used when server TTS fails
 * or is not configured). Drives a synthetic mouth level from word boundaries.
 */
export function speakWithBrowser(text: string, opts: { rateBias?: number; onStart?: () => void; audio?: InterviewerAudio | null }): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  return loadBrowserVoices().then((voices) => new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0 + (opts.rateBias ?? 0);
    // Pitch shifts make neural voices sound processed; leave them at their natural pitch.
    const preferred = pickBrowserVoice(voices);
    if (preferred) { u.voice = preferred; u.lang = preferred.lang; }
    let pulse = 0;
    let speaking = false;
    const t0 = performance.now();
    if (opts.audio) opts.audio.synthetic = () => (speaking ? Math.max(0, 0.35 + 0.35 * Math.sin((performance.now() - t0) / 70) * Math.max(0, 1 - (performance.now() - pulse) / 260)) : 0);
    u.onstart = () => { speaking = true; pulse = performance.now(); opts.onStart?.(); };
    u.onboundary = () => { pulse = performance.now(); };
    let finished = false;
    const done = () => { if (finished) return; finished = true; speaking = false; if (opts.audio) opts.audio.synthetic = null; resolve(); };
    u.onend = done;
    u.onerror = done;
    // Some environments never fire onend (no audio device, headless) — never hang the interview.
    setTimeout(done, 3000 + (text.split(/\s+/).length / 2.3) * 1000);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }));
}
