/**
 * Choosing the browser's speech voice, used when no server voice is configured.
 *
 * Browsers ship a mix of voices. The neural ones (Edge's "… Online (Natural)", macOS
 * "Premium"/"Enhanced") sound close to a person; the old desktop ones (Windows David/Zira,
 * macOS Fred) sound like a robot; macOS also ships novelty voices (Bells, Zarvox) that
 * must never be picked. Ranking by name is the only signal the Web Speech API gives us.
 */
export type VoiceLike = Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">;

const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|fred|good news|hysterical|jester|junior|organ|pipe organ|ralph|superstar|trinoids|whisper|wobble|zarvox)\b/i;
const NEURAL = /\b(natural|neural)\b|\bonline\b/i;
const APPLE_HIGH_QUALITY = /\b(premium|enhanced|siri)\b/i;
const APPLE_GOOD = /^(samantha|ava|allison|susan|tom|daniel|karen|serena|kate|oliver)\b/i;
const GOOGLE = /^google\b/i;
const WINDOWS_DESKTOP = /^microsoft\b/i;

function score(v: VoiceLike): number {
  if (!/^en([-_]|$)/i.test(v.lang) || NOVELTY.test(v.name)) return -Infinity;
  let s = 0;
  if (NEURAL.test(v.name)) s += 100;
  else if (APPLE_HIGH_QUALITY.test(v.name)) s += 80;
  else if (GOOGLE.test(v.name)) s += 60;
  else if (APPLE_GOOD.test(v.name)) s += 40;
  else if (WINDOWS_DESKTOP.test(v.name)) s -= 20;
  if (/^en[-_]us$/i.test(v.lang)) s += 5;
  else if (/^en[-_](gb|au|ca|ie|nz)$/i.test(v.lang)) s += 3;
  return s;
}

/** The most natural-sounding English voice available, or null if there is none. */
export function pickBrowserVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  let best: V | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const s = score(v);
    if (s > bestScore) { best = v; bestScore = s; }
  }
  return best;
}

let loaded: Promise<SpeechSynthesisVoice[]> | null = null;

/**
 * Chrome fills the voice list asynchronously: the first `getVoices()` call often returns
 * nothing, and speaking then uses the default (most robotic) voice. Wait briefly for it.
 */
export function loadBrowserVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  loaded ??= new Promise((resolve) => {
    const finish = () => { synth.removeEventListener("voiceschanged", finish); clearTimeout(timer); resolve(synth.getVoices()); };
    const timer = setTimeout(finish, timeoutMs);
    synth.addEventListener("voiceschanged", finish);
  }).then((voices) => {
    if (!(voices as SpeechSynthesisVoice[]).length) loaded = null; // try again next time
    return voices as SpeechSynthesisVoice[];
  });
  return loaded;
}
