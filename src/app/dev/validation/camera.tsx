"use client";
import { useEffect, useState } from "react";
import { VisionTracker, type Frame } from "@/features/room/engine/vision";
import { postureKind, POSTURE_THRESHOLDS } from "@/lib/analysis/posture";

type Entry = { file: string; subject: string; skinTone: string; ageBand: string; eyewear: string; headCovering: string; lighting: string; gaze: "camera" | "away" };
export type CameraResult = Entry & { faceDetected: boolean; engagement: number | null; yaw: number | null; pitch: number | null; irisX: number | null; irisY: number | null; shoulders: boolean; brightness: number | null; faceX: number | null; faceY: number | null; faceSize: number | null; classifiedAs: "camera" | "away" | "no-face" };

export type StillnessResult = { file: string; frames: number; maxMotion: number | null; restless: number };
export type PostureResult = { file: string; skinTone: string; eyewear: string; headCovering: string; lighting: string; postureReady: boolean; scale: number; expected: string; lean: number | null; slouch: number | null; kind: string };

/** Zoom about the centre to mimic sitting back (<1) or leaning in (>1); the margin is the image's mean colour. */
function zoom(img: HTMLImageElement, scale: number): HTMLCanvasElement {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, (w * (1 - scale)) / 2, (h * (1 - scale)) / 2, w * scale, h * scale);
  return c;
}

const ZOOMS = [0.75, 0.92, 1, 1.08, 1.25];
const expectedAt = (z: number) => (z <= 0.8 ? "lean_back" : z >= 1.2 ? "lean_in" : "upright");

/**
 * Runs VisionTracker (the Room's exact on-device code) over each fixture: gaze with the default,
 * uncalibrated reference; posture calibrated on each lens-facing portrait, then zoomed.
 */
export function CameraValidation() {
  const [rows, setRows] = useState<CameraResult[]>([]);
  const [status, setStatus] = useState("loading models…");
  useEffect(() => {
    (async () => {
      const manifest = (await (await fetch("/api/dev/validation-image?name=manifest.json")).json()) as { images: Entry[] };
      const tracker = new VisionTracker();
      if (!(await tracker.init())) { setStatus(`model load failed: ${tracker.error}`); return; }
      const out: CameraResult[] = [];
      for (const e of manifest.images) {
        const img = new Image();
        img.src = `/api/dev/validation-image?name=${e.file}`;
        try { await img.decode(); } catch { continue; }
        // Several passes (VIDEO mode smooths across frames); keep the last.
        let f = null;
        for (let i = 0; i < 4; i++) f = tracker.analyzeImage(img);
        const eng = f ? tracker.engagement(f) : null;
        const s = f ? tracker.toSample(f, 0) : null;
        out.push({
          ...e, faceDetected: !!f?.face, engagement: eng === null ? null : Math.round(eng * 1000) / 1000,
          yaw: f?.yaw === null || f?.yaw === undefined ? null : Math.round(f.yaw * 10) / 10,
          pitch: f?.pitch === null || f?.pitch === undefined ? null : Math.round(f.pitch * 10) / 10,
          irisX: f?.irisX ?? null, irisY: f?.irisY ?? null, shoulders: f?.shoulderWidth != null, brightness: s?.brightness ?? null, faceX: f?.faceX ?? null, faceY: f?.faceY ?? null, faceSize: f?.faceSize ?? null,
          classifiedAs: !f?.face ? "no-face" : (eng ?? 0) >= 0.5 ? "camera" : "away",
        });
        setRows([...out]);
      }
      (window as unknown as { __cameraValidation: CameraResult[] }).__cameraValidation = out;

      // Posture: each lens-facing portrait is its own calibration. Distance alone must never read as a slouch.
      const posture: PostureResult[] = [];
      const stillness: StillnessResult[] = [];
      for (const e of manifest.images.filter((x) => x.gaze === "camera")) {
        setStatus(`posture: ${e.file}`);
        const img = new Image();
        img.src = `/api/dev/validation-image?name=${e.file}`;
        try { await img.decode(); } catch { continue; }
        // VIDEO mode smooths across frames, so let each new input settle before using it.
        const settle = (src: HTMLImageElement | HTMLCanvasElement, n: number) => {
          const frames: Frame[] = [];
          for (let i = 0; i < n; i++) { const f = tracker.analyzeImage(src); if (f) frames.push(f); }
          return frames;
        };
        const ready = tracker.calibrateFrom(settle(img, 12).slice(-6)) && tracker.postureReady;
        // A still person must never read as restless: movement on repeated identical frames is pure tracker jitter.
        const still = settle(img, 24).map((f) => tracker.toSample(f, 0).motion).slice(1).filter((m): m is number => m !== null);
        stillness.push({ file: e.file, frames: still.length, maxMotion: still.length ? Math.max(...still) : null, restless: still.filter((m) => m > POSTURE_THRESHOLDS.fidget).length });
        for (const z of ZOOMS) {
          const f = settle(zoom(img, z), 8).at(-1);
          const s = f ? tracker.toSample(f, 0) : null;
          posture.push({
            file: e.file, skinTone: e.skinTone, eyewear: e.eyewear, headCovering: e.headCovering, lighting: e.lighting, postureReady: ready,
            scale: z, expected: expectedAt(z), lean: s?.lean ?? null, slouch: s?.slouch ?? null,
            // Motion between unrelated stills is meaningless here.
            kind: s ? postureKind({ ...s, motion: null }) ?? "upright" : "no-face",
          });
        }
      }
      (window as unknown as { __postureValidation: PostureResult[] }).__postureValidation = posture;
      (window as unknown as { __stillnessValidation: StillnessResult[] }).__stillnessValidation = stillness;
      setStatus(`done: ${out.length} images, ${posture.length} posture runs`);
    })();
  }, []);
  return (
    <main className="p-8 text-ui">
      <h1 className="text-display-m text-fg">Camera signal validation</h1>
      <p className="mt-2 text-fg-subtle" data-testid="status">{status}</p>
      <table className="mt-6 w-full font-mono text-meta">
        <thead><tr className="text-left text-fg-subtle"><th>file</th><th>tone</th><th>eyewear</th><th>cover</th><th>light</th><th>gaze</th><th>face</th><th>engagement</th><th>yaw</th><th>pitch</th><th>result</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.file} className="border-t border-fg/10"><td>{r.file}</td><td>{r.skinTone}</td><td>{r.eyewear}</td><td>{r.headCovering}</td><td>{r.lighting}</td><td>{r.gaze}</td><td>{String(r.faceDetected)}</td><td>{r.engagement}</td><td>{r.yaw}</td><td>{r.pitch}</td><td className={r.classifiedAs === r.gaze ? "text-success" : "text-danger"}>{r.classifiedAs}</td></tr>)}</tbody>
      </table>
    </main>
  );
}
