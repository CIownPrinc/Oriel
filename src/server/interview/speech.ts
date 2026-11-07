import "server-only";
import { getTextToSpeech } from "@/lib/ai/providers/registry";
import type { LlmUsage, SpeechChunk } from "@/lib/ai/providers/types";

/**
 * Speech synthesis with a small in-process PCM cache.
 *
 * Latency matters most in the Room, so fixed phrases (acknowledgements, the next
 * planned question) are synthesised ahead of time while the candidate is still
 * answering. A cache hit turns ~500 ms of TTS latency into ~0.
 */
const MAX_ENTRIES = 300;
const cache = new Map<string, SpeechChunk[]>();
const inflight = new Map<string, Promise<SpeechChunk[] | null>>();

const key = (voice: string, text: string) => `${voice}|${text.trim().toLowerCase()}`;

/**
 * Request budget for the TTS provider (requests per minute). Live turns always go
 * through; background prewarming only spends what is left above a reserve, so a
 * low quota (e.g. a free-tier key at 10 RPM) never starves the conversation.
 */
const TTS_RPM = Number(process.env.ORIEL_TTS_RPM ?? 10);
const RESERVE = Math.max(2, Math.ceil(TTS_RPM * 0.5));
const recent: number[] = [];

function spent() {
  const cutoff = Date.now() - 60_000;
  while (recent.length && recent[0] < cutoff) recent.shift();
  return recent.length;
}

function note() {
  recent.push(Date.now());
}

/**
 * On serverless hosts a function can freeze the moment its response ends and the next request may
 * land on another instance, so audio prepared ahead is often cut off or never found, yet still
 * spends quota. There, every request goes to the live turn.
 */
export function canPrewarm() {
  return !process.env.VERCEL;
}

/**
 * How long a turn waits for the model to finish before speaking its first sentence, to send the
 * whole utterance as one TTS request. Without prewarming, requests are the scarcer thing, so wait longer.
 */
export function wholeTurnWaitMs(hasBridge: boolean) {
  if (!canPrewarm()) return 1200;
  return hasBridge ? 400 : 150;
}

export function ttsBudgetRemaining() {
  return TTS_RPM - spent();
}

function remember(k: string, chunks: SpeechChunk[]) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(k, chunks);
}

export function isCached(voice: string, text: string) {
  return cache.has(key(voice, text));
}

export interface SynthResult { usage: LlmUsage | null; cached: boolean; firstChunkMs: number | null }

/** Stream PCM for one phrase: from cache, from an in-flight prewarm, or live TTS. */
export async function* synth(voice: string, text: string): AsyncGenerator<SpeechChunk, SynthResult> {
  const k = key(voice, text);
  const t0 = performance.now();
  const hit = cache.get(k);
  if (hit) {
    for (const c of hit) yield c;
    return { usage: null, cached: true, firstChunkMs: 0 };
  }
  const pending = inflight.get(k);
  if (pending) {
    const chunks = await pending;
    if (chunks) {
      for (const c of chunks) yield c;
      return { usage: null, cached: true, firstChunkMs: performance.now() - t0 };
    }
  }
  const tts = getTextToSpeech();
  note();
  const gen = tts.streamSpeech({ text, voice, timeoutMs: 15000 });
  const got: SpeechChunk[] = [];
  let first: number | null = null;
  let r = await gen.next();
  while (!r.done) {
    if (first === null) first = performance.now() - t0;
    got.push(r.value);
    yield r.value;
    r = await gen.next();
  }
  if (text.length <= 400) remember(k, got);
  return { usage: r.value.usage, cached: false, firstChunkMs: first };
}

/** Synthesise phrases in the background so the next turn can start instantly. */
export function prewarm(voice: string, texts: string[], onUsage?: (u: LlmUsage) => void, priority: "high" | "low" = "low") {
  const tts = getTextToSpeech();
  if (tts.isMock || !canPrewarm()) return;
  for (const text of texts) {
    const k = key(voice, text);
    if (!text.trim() || cache.has(k) || inflight.has(k)) continue;
    // Keep capacity for live turns; the next planned question may dip deeper into the budget.
    if (TTS_RPM - spent() <= (priority === "high" ? 2 : RESERVE)) return;
    note();
    const p = (async () => {
      try {
        const gen = tts.streamSpeech({ text, voice, timeoutMs: 20000 });
        const chunks: SpeechChunk[] = [];
        let r = await gen.next();
        while (!r.done) { chunks.push(r.value); r = await gen.next(); }
        if (r.value.usage) onUsage?.(r.value.usage);
        remember(k, chunks);
        return chunks;
      } catch {
        return null;
      } finally {
        inflight.delete(k);
      }
    })();
    inflight.set(k, p);
  }
}

/** Split streamed text into speakable sentences. Returns [complete sentences, remainder]. */
export function splitSentences(buf: string): [string[], string] {
  const out: string[] = [];
  let rest = buf;
  const re = /^(.+?[.!?])(\s+|$)/s;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) && m[2] !== "") {
    out.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  return [out, rest];
}
