"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Toggle } from "@/components/ui/Field";
import { CONSENT_COPY, CONSENT_VERSION } from "@/lib/privacy/consent";

export interface ConsentChoices { microphone: boolean; camera: boolean; recording: boolean; cameraMetrics: boolean }

/**
 * Standalone consent before any device turns on: names what is measured, why, how
 * long it is kept and how to delete it. The version shown is logged with the choices.
 */
export function ConsentDialog({ open, defaults, recordingAllowed, onConfirm, onCancel }: {
  open: boolean; defaults: ConsentChoices; recordingAllowed: boolean;
  onConfirm: (c: ConsentChoices, version: string, signature: string | null) => void; onCancel: () => void;
}) {
  const [c, setC] = useState<ConsentChoices>(defaults);
  const [signature, setSignature] = useState("");
  const needsSignature = c.cameraMetrics && signature.trim().length < 2;
  const set = (k: keyof ConsentChoices, v: boolean) => setC((x) => {
    const n = { ...x, [k]: v };
    if (!n.camera) n.cameraMetrics = false;
    return n;
  });
  return (
    <Modal open={open} onClose={onCancel} title="Before you enter the room" dismissible={false} className="w-[min(620px,calc(100vw-32px))]">
      <div className="max-h-[calc(100dvh-48px)] overflow-y-auto p-7 sm:p-9">
        <h2 className="text-display-l text-fg">Your interviewer is an AI.</h2>
        <p className="mt-3 text-ui leading-relaxed text-fg-muted">The face and voice are simulated for practice. It will remember what you say during this session and may push back. Nothing is scored on screen while you talk.</p>
        <div className="mt-6 divide-y divide-line border-y border-line">
          <Toggle checked={c.microphone} onChange={(v) => set("microphone", v)} label="Microphone" description={`${CONSENT_COPY.microphone} In Chrome, live captions are processed by the browser's speech service.`} />
          <Toggle checked={c.camera} onChange={(v) => set("camera", v)} label="Camera" description={CONSENT_COPY.camera} />
          <Toggle checked={c.recording && recordingAllowed} disabled={!recordingAllowed} onChange={(v) => set("recording", v)} label="Record this session" description={recordingAllowed ? CONSENT_COPY.recording : "Recording is turned off in your privacy settings."} />
          <Toggle checked={c.cameraMetrics} disabled={!c.camera} onChange={(v) => set("cameraMetrics", v)} label="Camera-based signals (on-device)" description={CONSENT_COPY.camera_metrics} />
        </div>
        {c.cameraMetrics && (
          <div className="mt-5 rounded-control bg-accent-tint p-4">
            <p className="text-meta leading-relaxed text-fg">{CONSENT_COPY.camera_metrics_release}</p>
            <label className="mt-3 block text-meta text-fg-subtle" htmlFor="consent-signature">Type your full name to sign</label>
            <Input id="consent-signature" className="mt-1.5" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Full name" autoComplete="name" />
          </div>
        )}
        <p className="mt-5 text-meta leading-relaxed text-fg-subtle">Never measured: attractiveness, age, race, emotion, personality or accent. You can delete this session and its recording at any time from Playback or your profile. <a href="/privacy#biometric" target="_blank" className="underline decoration-1 underline-offset-text hover:text-fg">Biometric &amp; retention policy</a>. Consent version {CONSENT_VERSION}.</p>
        <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>Not now</Button>
          <Button disabled={needsSignature} title={needsSignature ? "Sign to enable camera-based signals, or turn them off" : undefined}
            onClick={() => onConfirm({ ...c, recording: c.recording && recordingAllowed }, CONSENT_VERSION, c.cameraMetrics ? signature.trim() : null)}>
            {c.microphone ? "Agree and continue" : "Continue in text mode"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
