import { z } from "zod";
import {
  ProviderError,
  type GenerateJsonRequest, type GenerateTextRequest, type LanguageModelProvider, type LlmUsage,
  type SpeechChunk, type SpeechToTextProvider, type TextToSpeechProvider, type TranscriptionResult,
} from "./types";

/**
 * Google Gemini adapters (REST, v1beta). Server-side only — the key never reaches the browser.
 * Model choices were measured on 2026-09-29 from this machine:
 *   realtime text  gemini-3.1-flash-lite     ~470 ms full reply (non-streaming, short output)
 *   analysis       gemini-3.8-flash          thinking disabled for JSON extraction
 *   TTS            gemini-3.8-flash-lite-tts ~460 ms to first streamed PCM chunk
 *   transcription  gemini-3.5-transcribe     keeps disfluencies ("um", "uh")
 */
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export const GEMINI_MODELS = {
  realtime: process.env.GEMINI_REALTIME_MODEL ?? "gemini-3.1-flash-lite",
  analysis: process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-3.8-flash",
  tts: process.env.GEMINI_TTS_MODEL ?? "gemini-3.8-flash-lite-tts",
  /** Quotas are per model: on 429 the primary TTS model falls back to this sibling (same voices). */
  ttsFallback: process.env.GEMINI_TTS_FALLBACK_MODEL ?? "gemini-3.8-flash-tts",
  realtimeFallback: process.env.GEMINI_REALTIME_FALLBACK_MODEL ?? "gemini-3.5-flash-lite",
  transcribe: process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-3.5-transcribe",
};

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string }; audioTranscription?: { text: string }; thought?: boolean };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message: string; code?: number };
  promptFeedback?: { blockReason?: string };
};

function thinkingConfig(model: string) {
  // 3.x flash-lite models accept thinkingLevel; flash accepts a zero budget.
  return model.includes("lite") ? { thinkingLevel: "minimal" } : { thinkingBudget: 0 };
}

async function call(model: string, body: unknown, key: string, timeoutMs: number, stream = false): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ProviderError("gemini", timeout ? `timeout after ${timeoutMs}ms (${model})` : `network error: ${String(err)}`, true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text.slice(0, 300);
    try { msg = (JSON.parse(text) as GeminiResponse).error?.message ?? msg; } catch { /* keep raw */ }
    throw new ProviderError("gemini", `${res.status} ${msg}`, res.status === 429 || res.status >= 500, res.status);
  }
  return res;
}

function usageOf(model: string, j: GeminiResponse): LlmUsage {
  const u = j.usageMetadata ?? {};
  return { model, inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
}

function textOf(j: GeminiResponse): string {
  if (j.promptFeedback?.blockReason) throw new ProviderError("gemini", `blocked: ${j.promptFeedback.blockReason}`);
  return (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
}

export class GeminiLanguageModel implements LanguageModelProvider {
  readonly id = "gemini";
  readonly isMock = false;
  constructor(private key: string) {}

  async generateText(req: GenerateTextRequest) {
    const model = GEMINI_MODELS[req.tier];
    const t0 = performance.now();
    const res = await call(model, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: req.maxTokens ?? 300, temperature: req.temperature ?? 0.8, thinkingConfig: thinkingConfig(model) },
    }, this.key, req.timeoutMs ?? 8000);
    const j = (await res.json()) as GeminiResponse;
    const text = textOf(j);
    if (!text) throw new ProviderError("gemini", "empty response", true);
    return { text, usage: usageOf(model, j), latencyMs: performance.now() - t0 };
  }

  async *streamText(req: GenerateTextRequest): AsyncGenerator<string, { usage: LlmUsage; firstTokenMs: number | null }> {
    let model = GEMINI_MODELS[req.tier];
    const t0 = performance.now();
    const body = (m: string) => ({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((x) => ({ role: x.role === "assistant" ? "model" : "user", parts: [{ text: x.content }] })),
      generationConfig: { maxOutputTokens: req.maxTokens ?? 300, temperature: req.temperature ?? 0.8, thinkingConfig: thinkingConfig(m) },
    });
    let res: Response;
    try {
      res = await call(model, body(model), this.key, req.timeoutMs ?? 8000, true);
    } catch (err) {
      if (!(err instanceof ProviderError && err.status === 429) || req.tier !== "realtime") throw err;
      model = GEMINI_MODELS.realtimeFallback;
      res = await call(model, body(model), this.key, req.timeoutMs ?? 8000, true);
    }
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let usage: LlmUsage = { model, inputTokens: 0, outputTokens: 0 };
    let first: number | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const j = JSON.parse(line.slice(5)) as GeminiResponse;
        if (j.error) throw new ProviderError("gemini", j.error.message, true);
        if (j.usageMetadata) usage = usageOf(model, j);
        const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
        if (text) {
          if (first === null) first = performance.now() - t0;
          yield text;
        }
      }
    }
    return { usage, firstTokenMs: first };
  }

  async generateJson<T>(req: GenerateJsonRequest<T>) {
    const model = GEMINI_MODELS[req.tier];
    const t0 = performance.now();
    const jsonSchema = z.toJSONSchema(req.schema, { target: "draft-7" }) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const res = await call(model, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 4000, temperature: 0.2,
        responseMimeType: "application/json", responseJsonSchema: jsonSchema, thinkingConfig: thinkingConfig(model),
      },
    }, this.key, req.timeoutMs ?? 30000);
    const j = (await res.json()) as GeminiResponse;
    const raw = textOf(j);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProviderError("gemini", `invalid JSON output: ${raw.slice(0, 200)}`, true);
    }
    const result = req.schema.safeParse(parsed);
    if (!result.success) throw new ProviderError("gemini", `schema validation failed: ${result.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, true);
    return { data: result.data, usage: usageOf(model, j), latencyMs: performance.now() - t0 };
  }
}

/** How long to wait before retrying speech after a 429, or null if Gemini's wait is too long to sit through. */
export function ttsRetryWaitMs(message: string, longest = 6000): number | null {
  const m = /retry in ([\d.]+)\s*s/i.exec(message);
  const ms = m ? Math.ceil(Number(m[1]) * 1000) + 100 : 2000;
  return ms <= longest ? ms : null;
}

export class GeminiTextToSpeech implements TextToSpeechProvider {
  readonly id = "gemini-tts";
  readonly isMock = false;
  constructor(private key: string) {}

  async *streamSpeech(req: { text: string; voice: string; style?: string; timeoutMs?: number }): AsyncGenerator<SpeechChunk, { usage: LlmUsage | null }> {
    let model = GEMINI_MODELS.tts;
    // Plain text only: the lite TTS model reads style directions ("Say warmly: …") aloud
    // (found by the speech validation harness), so no prefixes are added here.
    const prompt = req.text;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice } } } },
    };
    let res: Response;
    try {
      res = await call(model, body, this.key, req.timeoutMs ?? 15000, true);
    } catch (err) {
      if (!(err instanceof ProviderError && err.status === 429) || GEMINI_MODELS.ttsFallback === model) throw err;
      model = GEMINI_MODELS.ttsFallback;
      try {
        res = await call(model, body, this.key, req.timeoutMs ?? 15000, true);
      } catch (second) {
        // Both models are at their per-minute limit. A short silence beats the browser's robot voice.
        const wait = second instanceof ProviderError && second.status === 429 ? ttsRetryWaitMs(second.message) : null;
        if (wait === null) throw second;
        await new Promise((r) => setTimeout(r, wait));
        res = await call(model, body, this.key, req.timeoutMs ?? 15000, true);
      }
    }
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let usage: LlmUsage | null = null;
    let rate = 24000;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const j = JSON.parse(line.slice(5)) as GeminiResponse;
        if (j.error) throw new ProviderError("gemini-tts", j.error.message, true);
        if (j.usageMetadata) usage = usageOf(model, j);
        for (const p of j.candidates?.[0]?.content?.parts ?? []) {
          if (!p.inlineData?.data) continue;
          const m = /rate=(\d+)/.exec(p.inlineData.mimeType);
          if (m) rate = Number(m[1]);
          yield { pcm: Buffer.from(p.inlineData.data, "base64"), sampleRate: rate };
        }
      }
    }
    return { usage };
  }
}

export class GeminiSpeechToText implements SpeechToTextProvider {
  readonly id = "gemini-transcribe";
  readonly isMock = false;
  constructor(private key: string) {}

  async transcribe(req: { audio: Buffer; mimeType: string; timeoutMs?: number }): Promise<TranscriptionResult> {
    const model = GEMINI_MODELS.transcribe;
    const t0 = performance.now();
    const mimeType = req.mimeType.split(";")[0] || "audio/webm";
    const res = await call(model, {
      contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: req.audio.toString("base64") } }] }],
    }, this.key, req.timeoutMs ?? 30000);
    const j = (await res.json()) as GeminiResponse;
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.audioTranscription?.text ?? p.text ?? "").join(" ").replace(/\s+/g, " ").trim();
    return { text, words: null, usage: usageOf(model, j), latencyMs: performance.now() - t0 };
  }
}
