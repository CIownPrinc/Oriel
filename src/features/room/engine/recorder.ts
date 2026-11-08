/**
 * Session recording: MediaRecorder chunks are uploaded as they are produced, so a
 * crash or closed tab never loses what was already said. Uploads are sequential,
 * idempotent (by sequence number) and retried with backoff.
 *
 * Each recorder uploads its own part of the session recording, keyed by a random id and
 * placed at `offsetMs` on the session clock. After a reload the Room starts a new recorder,
 * so the new footage becomes a new part instead of colliding with the old sequence numbers.
 */
export function pickMime(video: boolean): string {
  const opts = video
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return opts.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export class SessionRecorder {
  private rec: MediaRecorder | null = null;
  private queue: { seq: number; blob: Blob }[] = [];
  private seq = 0;
  private uploading = false;
  private stopped: Promise<void> | null = null;
  private abandoned = false;
  failures = 0;
  mime = "";

  private readonly partKey = crypto.randomUUID();

  constructor(
    private sessionId: string,
    private stream: MediaStream,
    private video: boolean,
    private offsetMs: number,
    /** Called once if recording can't continue (turned off, deleted or rejected by the server). */
    private onAbandoned: (status: number) => void = () => {},
  ) {}

  start() {
    this.mime = pickMime(this.video);
    if (!this.mime) return false;
    this.rec = new MediaRecorder(this.stream, { mimeType: this.mime, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.queue.push({ seq: this.seq++, blob: e.data });
        void this.pump();
      }
    };
    this.rec.start(4000);
    return true;
  }

  private async pump() {
    if (this.uploading) return;
    this.uploading = true;
    let attempt = 0;
    while (this.queue.length && !this.abandoned) {
      const item = this.queue[0];
      let status = 0;
      try {
        const res = await fetch(`/api/sessions/${this.sessionId}/media?part=${this.partKey}&offset=${Math.round(this.offsetMs)}&seq=${item.seq}`, { method: "POST", headers: { "x-media-type": this.mime }, body: item.blob });
        status = res.status;
      } catch { /* network: retry */ }
      if (status >= 200 && status < 300) {
        this.queue.shift();
        attempt = 0;
        continue;
      }
      if (status === 403 || status === 410 || status === 413 || status === 415) {
        // Recording disabled, deleted or rejected: stop uploading rather than loop.
        this.abandoned = true;
        this.queue = [];
        this.onAbandoned(status);
        break;
      }
      // Transient (network, 5xx, 409, 429): never drop a chunk — a WebM without its
      // earlier chunks is unplayable. Back off and retry the same chunk.
      this.failures++;
      await new Promise((r) => setTimeout(r, Math.min(8000, 400 * 2 ** attempt++)));
    }
    this.uploading = false;
  }

  /** Stop recording and wait (bounded) for pending uploads. */
  stop(timeoutMs = 8000): Promise<void> {
    if (this.stopped) return this.stopped;
    this.stopped = new Promise((resolve) => {
      const finish = async () => {
        const end = Date.now() + timeoutMs;
        while ((this.queue.length || this.uploading) && Date.now() < end) await new Promise((r) => setTimeout(r, 150));
        resolve();
      };
      if (!this.rec || this.rec.state === "inactive") return void finish();
      this.rec.onstop = () => void finish();
      try { this.rec.stop(); } catch { void finish(); }
    });
    return this.stopped;
  }
}

/** Records one answer's microphone audio for server transcription. */
export class AnswerRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  mime = "";

  start(stream: MediaStream) {
    this.mime = pickMime(false);
    if (!this.mime) return;
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: this.mime, audioBitsPerSecond: 48_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === "inactive") return resolve(null);
      this.rec.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: this.mime }) : null);
      try { this.rec.stop(); } catch { resolve(null); }
    });
  }
}
