import fs from "node:fs";
import path from "node:path";
import Link from "next/link";

export const metadata = { title: "How accurate is the feedback?" };

type SpeechRow = { accentLabel: string; script: string; truth: Record<string, number>; measured: Record<string, number | string | null>; error: Record<string, number | null> };
type CameraRow = { file: string; skinTone: string; eyewear: string; headCovering: string; lighting: string; ageBand: string; gaze: string; faceDetected: boolean; engagement: number | null; classifiedAs: string };
type PostureRow = { file: string; postureReady: boolean; scale: number; expected: string; lean: number | null; slouch: number | null; kind: string };

function load<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "validation", file), "utf8")) as T;
  } catch {
    return null;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Published validation results (the plan: "test the Read … and publish what you find"). */
export default function TrustPage() {
  const speech = load<{ generatedAt: string; results: SpeechRow[] }>("speech-results.json");
  const camera = load<{ generatedAt: string; rows: CameraRow[] }>("camera-results.json");
  const s = speech?.results ?? [];
  const byAccent = new Map<string, SpeechRow[]>();
  for (const r of s) byAccent.set(r.accentLabel, [...(byAccent.get(r.accentLabel) ?? []), r]);
  const abs = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null).map(Math.abs);
  const c = camera?.rows ?? [];
  const postureRun = load<{ generatedAt: string; rows: PostureRow[]; stillness?: { frames: number; restless: number }[] }>("posture-results.json");
  const p = postureRun?.rows ?? [];
  const still = postureRun?.stillness ?? [];
  const portraits = [...new Set(p.map((r) => r.file))];
  return (
    <main id="content" tabIndex={-1} className="frame pb-section pt-[calc(var(--header-h)+var(--spacing-hero))] focus:outline-none">
      <h1 className="text-display-l text-fg">How accurate is the feedback?</h1>
      <p className="mt-6 max-w-2xl text-body-l text-fg-muted">We test every measurement against known ground truth and across accents, skin tones, eyewear, head coverings and lighting, and publish the results, including what failed and what we changed. These are early, synthetic tests; testing with real people is still owed and will be published here.</p>

      <section className="mt-20">
        <h2 className="text-display-m text-fg">Speech measurements</h2>
        <p className="mt-2 max-w-column text-ui text-fg-muted">{s.length} labelled clips across {byAccent.size} accents (synthetic voices with known silences, pauses and scripts), run through the product&apos;s own code. {speech ? `Run ${speech.generatedAt.slice(0, 10)}.` : "Not run yet."}</p>
        {s.length > 0 && (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              {[
                ["Pace error", `${mean(abs(s.map((r) => r.error.pacePct))).toFixed(1)}%`],
                ["Filler count error", mean(abs(s.map((r) => r.error.fillers))).toFixed(2)],
                ["First-word timing error", `${Math.round(mean(abs(s.map((r) => r.error.recoveryMs))))} ms`],
                ["Pause length error", `${Math.round(mean(abs(s.map((r) => r.error.pauseMs))))} ms`],
              ].map(([k, v]) => <div key={k} className="border-t border-line pt-3 pb-1"><p className="text-meta text-fg-subtle">{k}</p><p className="mt-1 text-body-l text-fg">{v}</p><p className="text-meta text-fg-subtle">mean absolute</p></div>)}
            </div>
            <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label="Speech measurement errors by accent">
              <table className="w-full min-w-[560px] text-ui">
                <thead className="text-left text-meta text-fg-subtle"><tr><th className="py-2 font-normal">Accent</th><th className="font-normal">Pace error</th><th className="font-normal">Filler error</th><th className="font-normal">First-word error</th></tr></thead>
                <tbody>{[...byAccent].map(([label, rs]) => (
                  <tr key={label} className="border-t border-line"><td className="py-2 text-fg">{label}</td><td>{mean(abs(rs.map((r) => r.error.pacePct))).toFixed(1)}%</td><td>{mean(abs(rs.map((r) => r.error.fillers))).toFixed(1)}</td><td>{Math.round(mean(abs(rs.map((r) => r.error.recoveryMs))))} ms</td></tr>
                ))}</tbody>
              </table>
            </div>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-ui text-fg-muted">
              <li><span className="text-fg">Pace</span> read ~20% slow in the first run (speaking time was estimated as voiced time × 1.25). It is now the answer span minus pauses of 0.7 s or more.</li>
              <li><span className="text-fg">Pauses</span> were measured ~170 ms short because of the voice detector&apos;s on/off delay; the measurement now corrects for it.</li>
              <li><span className="text-fg">Fillers</span>: for Indian, Spanish- and Mandarin-accented speech, transcription dropped short &ldquo;uh&rdquo;/&ldquo;um&rdquo; sounds (4 of 6 found). Feedback now shows filler counts as a minimum, and progress compares you only with yourself, so a consistent undercount does not distort improvement. An acoustic filler detector is next.</li>
              <li>Pitch is no longer computed on the quiet frames at the end of speech.</li>
            </ul>
          </>
        )}
      </section>

      <section className="mt-20">
        <h2 className="text-display-m text-fg">Camera signals</h2>
        <p className="mt-2 max-w-column text-ui text-fg-muted">{c.length} synthetic webcam portraits, labelled &ldquo;looking at the lens&rdquo; or &ldquo;looking away&rdquo;, run through the interview&apos;s on-device face tracker without calibration. {camera ? `Run ${camera.generatedAt.slice(0, 10)}.` : "Not run yet."}</p>
        {c.length > 0 && (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Face detected", `${Math.round((c.filter((r) => r.faceDetected).length / c.length) * 100)}%`],
                ["Lens gaze recognized", `${Math.round((c.filter((r) => r.gaze === "camera" && r.classifiedAs === "camera").length / Math.max(1, c.filter((r) => r.gaze === "camera").length)) * 100)}%`],
                ["Looking away recognized", `${Math.round((c.filter((r) => r.gaze === "away" && r.classifiedAs === "away").length / Math.max(1, c.filter((r) => r.gaze === "away").length)) * 100)}%`],
              ].map(([k, v]) => <div key={k} className="border-t border-line pt-3 pb-1"><p className="text-meta text-fg-subtle">{k}</p><p className="mt-1 text-body-l text-fg">{v}</p></div>)}
            </div>
            <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label="Camera signal results">
              <table className="w-full min-w-[560px] text-ui">
                <thead className="text-left text-meta text-fg-subtle"><tr><th className="py-2 font-normal">Image</th><th className="font-normal">Skin tone · eyewear · covering · light</th><th className="font-normal">Truth</th><th className="font-normal">Estimate</th><th className="font-normal">Result</th></tr></thead>
                <tbody>{c.map((r) => (
                  <tr key={r.file} className="border-t border-line"><td className="py-2 text-meta">{r.file}</td><td>{r.skinTone} · {r.eyewear} · {r.headCovering} · {r.lighting}</td><td>{r.gaze}</td><td>{r.engagement ?? "n/a"}</td><td className={r.classifiedAs === r.gaze ? "text-success" : "text-danger"}>{r.classifiedAs === r.gaze ? "correct" : `missed (${r.classifiedAs})`}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="mt-4 text-ui text-fg-muted"><span className="text-fg">What we changed:</span> a forward-facing person wearing a hijab was read as &ldquo;looking away&rdquo;: the head-pose estimate carried a baseline offset. Camera engagement now requires each person&apos;s own 2-second lens calibration and is simply not reported without it. The setup check also called most normally framed people &ldquo;too far from the camera&rdquo;, including three of the four portraits with a head covering, because the face tracker measures the face, not the covering, so that threshold was recalibrated (now 0 of 12). We don&apos;t collect skin tone, coverings or similar attributes, so fixes must work for everyone.</p>
          </>
        )}
        {p.length > 0 && (
          <>
            <h3 className="mt-12 text-display-m text-fg">Posture</h3>
            <p className="mt-2 max-w-column text-ui text-fg-muted">Each lens-facing portrait calibrated as its own baseline, then zoomed out and in to mimic sitting back and leaning in ({p.length} runs). Moving nearer or farther must never read as a slouch.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Shoulders found at calibration", `${portraits.filter((f) => p.find((r) => r.file === f)?.postureReady).length}/${portraits.length}`],
                ["Sitting back or leaning in, recognized", `${p.filter((r) => r.kind === r.expected).length}/${p.length}`],
                ["Slouches from distance alone", `${p.filter((r) => r.kind === "slouch").length}`],
                ["Still frames read as restless", `${still.reduce((a, r) => a + r.restless, 0)}/${still.reduce((a, r) => a + r.frames, 0)}`],
              ].map(([k, v]) => <div key={k} className="border-t border-line pt-3 pb-1"><p className="text-meta text-fg-subtle">{k}</p><p className="mt-1 text-body-l text-fg">{v}</p></div>)}
            </div>
            <p className="mt-4 text-ui text-fg-muted"><span className="text-fg">What we changed:</span> slouch used to be measured as a raw head-to-shoulder height, which shrinks as you sit back, so sitting back could read as slouching. It is now a proportion of your shoulder width, which distance doesn&apos;t change; frames where you&apos;re looking down at notes are ignored; and the Read says when posture wasn&apos;t measured instead of reporting zero. Restlessness used to include your wrists, which are usually off-screen and guessed; a perfectly still person flickered as &ldquo;moving&rdquo;. It now uses your head and shoulders only, so talking with your hands doesn&apos;t count. Real slouching hasn&apos;t been tested yet: that needs recordings of people.</p>
          </>
        )}
      </section>

      <section className="mt-20 text-ui leading-relaxed text-fg-muted">
        <h2 className="text-display-m text-fg">Limits of these tests</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5">
          <li>Voices and faces are synthetic. Accents were directed to a speech model and not verified by native listeners.</li>
          <li>One or two images per condition: enough to catch gross failures, not to certify fairness.</li>
          <li>Still owed: validation against human-coded recordings of real sessions, and testing with real people across skin tones, lighting, glasses, head coverings, accents and disabilities.</li>
        </ul>
        <p className="mt-6">Full reports: <Link href="/trust/reports/speech" className="underline underline-offset-2">speech measurements</Link> and <Link href="/trust/reports/camera" className="underline underline-offset-2">camera signals</Link>. See also the <Link href="/privacy" className="underline underline-offset-2">privacy &amp; biometric policy</Link>.</p>
      </section>
    </main>
  );
}
