import Link from "next/link";
import { CONSENT_COPY, CONSENT_VERSION } from "@/lib/privacy/consent";

export const metadata = { title: "Privacy and biometric policy" };

const RETENTION: [string, string, string][] = [
  ["Raw session recording (your video and audio, plus the interviewer's voice)", "Your setting: 1, 7, 30 (default) or 90 days", "Deleted automatically at the end of the period, or immediately when you delete the session"],
  ["Frame-level derived signals (camera engagement estimates, posture numbers, loudness/pitch timelines)", "Same as the raw recording", "Deleted with the raw recording; deleted at once if you withdraw camera consent"],
  ["Face and body landmarks", "Never stored", "Computed in your browser, reduced to a few numbers, and discarded frame by frame"],
  ["Answer audio sent for transcription", "Not stored by Oriel", "Transcribed by our speech provider and discarded"],
  ["Transcript, the Read (aggregate metrics), Playback coaching", "Until you delete the session or your account", "Session delete or account delete"],
  ["Resume and job description", "Until you replace or delete them, or delete your account", "Account delete"],
  ["Account", "While active; deleted after 3 years without sign-in", "One-click account deletion in Profile"],
  ["Consent records and security audit log", "As required to demonstrate consent (no interview content)", "Kept after account deletion without personal content"],
];

const PROCESSORS: [string, string, string][] = [
  ["Google (Gemini API)", "Interviewer language, voice synthesis, answer transcription, document parsing, coaching", "Your answers' text and answer audio (for transcription); resume and job description text"],
  ["Your browser's speech service (Chrome)", "Live captions during the interview, when your browser provides them", "Microphone audio, processed by the browser vendor"],
  ["Google (MediaPipe model files)", "Download of the on-device face and pose models", "None: no user data is sent"],
];

const CONTENTS: [string, string][] = [
  ["short", "The short version"], ["collect", "What we collect"], ["biometric", "Biometric notice"], ["retention", "Retention"],
  ["processors", "Processors"], ["security", "Security"], ["rights", "Your rights"], ["campus", "Campus programs"],
];

export default function PrivacyPage() {
  return (
    <main id="content" tabIndex={-1} className="frame pb-section pt-[calc(var(--header-h)+var(--spacing-hero))] focus:outline-none">
      <header className="max-w-column">
        <h1 className="text-display-l text-fg">Privacy and biometric policy</h1>
        <p className="mt-5 text-body-l text-fg-muted">Oriel is a practice tool. It is not used by employers to screen candidates, and it never feeds you answers during a real interview.</p>
        <p className="mt-4 text-ui text-fg-subtle">Draft, pending review by privacy counsel. Consent version {CONSENT_VERSION}.</p>
      </header>
      {/* A long document reads with its contents in the margin, as the profile does. */}
      <div className="page-grid mt-group gap-y-10">
        <nav aria-label="On this page" className="hidden lg:col-span-3 lg:block">
          <ul className="sticky top-24 space-y-1 text-ui">
            {CONTENTS.map(([id, label]) => <li key={id}><a href={`#${id}`} className="-mx-2 block rounded-control px-2 py-1.5 text-fg-muted transition-colors duration-press hover:bg-surface hover:text-fg">{label}</a></li>)}
          </ul>
        </nav>
        <article className="col-span-4 sm:col-span-8 lg:col-span-7 lg:col-start-4">

      <Section title="The short version" id="short">
        <ul className="list-disc space-y-2 pl-5">
          <li>Your interviewer is an AI. Every session says so at the start.</li>
          <li>Camera and microphone turn on only after a separate consent screen for each session.</li>
          <li>Face and body landmarks are processed on your device and never leave it. We keep only derived numbers.</li>
          <li>We never sell biometric data or any other data, and never share your results with an employer or school without your explicit consent.</li>
          <li>You can delete any session, or your whole account, at any time.</li>
        </ul>
      </Section>

      <Section title="What we collect and why" id="collect">
        <ul className="list-disc space-y-2 pl-5">
          <li><b>Account:</b> email, a salted scrypt hash of your password, and your profile (name, target role, preferences).</li>
          <li><b>Documents:</b> the resume and job description you provide, so the interviewer asks relevant questions. We extract only what is written.</li>
          <li><b>Interview:</b> what you say (transcribed), the interviewer&apos;s questions, timing, and (if you allow recording) an encrypted recording for Playback.</li>
          <li><b>Delivery signals:</b> from audio, loudness and pitch timelines (for pace, pauses and vocal variety); from the camera, if you allow it, estimates of where your head and eyes point and how your upper body moves.</li>
          <li><b>Operational:</b> usage, costs, latency and errors, used to run and improve the service.</li>
        </ul>
      </Section>

      <Section title="Biometric information notice" id="biometric">
        <p>Some laws (for example Illinois&apos; Biometric Information Privacy Act, Texas&apos; CUBI, and Washington&apos;s biometric law) regulate face geometry and voiceprints. We designed Oriel to avoid collecting them:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li><b>Face geometry:</b> the face and pose models run in your browser. Landmarks are reduced each frame to a handful of numbers (such as &ldquo;facing the lens: 0.8&rdquo;) and discarded. We do not create or store face templates and cannot identify you from what we keep.</li>
          <li><b>Voice:</b> we analyze loudness, pitch movement and timing, and transcribe your words. We do not create or store voiceprints and do not identify speakers.</li>
          <li><b>Written release:</b> before any camera-derived signal is computed, we ask for your electronic signature on this release, and record the exact wording, its version and the time:</li>
        </ul>
        <blockquote className="mt-3 font-display text-body-l text-fg">{CONSENT_COPY.camera_metrics} {CONSENT_COPY.camera_metrics_release}</blockquote>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li><b>Purpose:</b> only to give you feedback on your own practice. Never to identify you, never for hiring decisions, never for advertising.</li>
          <li><b>No sale, no disclosure:</b> we never sell, lease, trade or otherwise profit from this data, and never disclose it except to you, or where legally required.</li>
          <li><b>Opt out any time:</b> switch off camera-based signals, gaze, or posture in Privacy settings. Withdrawing deletes the stored camera-derived timelines. You can still practice.</li>
          <li><b>Never measured:</b> attractiveness, age, race, emotion, personality, accent.</li>
        </ul>
      </Section>

      <Section title="Retention schedule" id="retention">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Retention schedule">
          <table className="w-full min-w-[560px] text-ui">
            <thead className="text-left text-meta text-fg-subtle"><tr><th className="py-2 pr-4 font-normal">Data</th><th className="pr-4 font-normal">Kept for</th><th className="font-normal">How it is destroyed</th></tr></thead>
            <tbody>{RETENTION.map(([a, b, c]) => <tr key={a} className="border-t border-line align-top"><td className="py-3 pr-4 text-fg">{a}</td><td className="pr-4">{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>

      <Section title="Who processes data for us" id="processors">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Who processes data for us">
          <table className="w-full min-w-[560px] text-ui">
            <thead className="text-left text-meta text-fg-subtle"><tr><th className="py-2 pr-4 font-normal">Processor</th><th className="pr-4 font-normal">Purpose</th><th className="font-normal">Data involved</th></tr></thead>
            <tbody>{PROCESSORS.map(([a, b, c]) => <tr key={a} className="border-t border-line align-top"><td className="py-3 pr-4 text-fg">{a}</td><td className="pr-4">{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>

      <Section title="Security" id="security">
        <p>Recordings are encrypted at rest with AES-256-GCM under per-user keys and are streamed only to their owner through short-lived signed links. Provider keys stay on our servers. Access is rate-limited and audit-logged.</p>
      </Section>

      <Section title="Your choices and rights" id="rights">
        <ul className="list-disc space-y-2 pl-5">
          <li>Download everything we store about you (Profile → Your data → Download).</li>
          <li>Delete a session (Playback) or your account (Profile). Deletion is immediate and permanent.</li>
          <li>Change retention, recording, and camera-signal settings at any time (Profile → Privacy). Changes are logged as consent records.</li>
        </ul>
      </Section>

      <Section title="Campus and employer programs" id="campus">
        <p>Where a school or organization provides Oriel seats, they see aggregate reporting only. Individual results are never shared without your explicit, separate consent.</p>
      </Section>

      <p className="mt-16 text-ui text-fg-subtle">Questions: privacy@oriel.example. This policy is a working draft prepared for review by privacy counsel and is not legal advice.</p>
        </article>
      </div>
    </main>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-16 text-body text-fg-muted first:mt-0">
      <h2 className="mb-4 text-display-m text-fg">{title}</h2>
      {children}
    </section>
  );
}
