/** Bump when the wording of any consent screen changes; every record stores the version shown. */
// 2026-11-07.1: plainer wording ("feedback" for "the Read", "the interview" for "the Room", "eye contact").
export const CONSENT_VERSION = "2026-11-07.1";

export const CONSENT_KINDS = ["camera", "microphone", "recording", "camera_metrics", "ai_disclosure"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number] | "terms";

export const CONSENT_COPY = {
  ai_disclosure: "Your interviewer is an AI. The face and voice are simulated for practice.",
  microphone: "We use your microphone to hear your answers. Your speech is transcribed to run the interview and give you feedback.",
  camera: "We use your camera so the interview feels real and so you can watch yourself back afterwards.",
  recording: "We record this session (your video and audio, plus the interviewer's voice) and store it encrypted. Raw video is deleted automatically after your retention period (default 30 days). You can delete it any time.",
  camera_metrics: "On your device, we estimate where your head and eyes point and how your upper body moves. Only derived numbers (for example, 'facing the lens: yes') leave your browser, never images of your face or face geometry. Webcam estimates can be wrong. You can turn this off and still practice.",
  camera_metrics_release: "I agree that Oriel may compute the camera-derived signals described above during this session, store the derived numbers with my session, keep them no longer than my raw-video retention period (then delete them), and never sell or share them. I can withdraw this at any time in Privacy settings. Typing my name is my electronic signature.",
  gaze_metric: "Estimate eye contact (where your head and eyes point) on your device.",
  posture_metric: "Estimate posture and movement (lean, sway, fidgeting) on your device.",
  terms: "Oriel is a practice tool with an AI interviewer. Camera and microphone are only used after you agree at the start of an interview.",
} as const;

export type ConsentCopyKey = keyof typeof CONSENT_COPY;
