import { afterEach, describe, expect, it } from "vitest";
import { canPrewarm, wholeTurnWaitMs } from "@/server/interview/speech";
import { ttsRetryWaitMs } from "@/lib/ai/providers/gemini";

describe("speech on serverless hosts", () => {
  afterEach(() => { delete process.env.VERCEL; });
  it("prepares speech ahead only on a long-lived server", () => {
    expect(canPrewarm()).toBe(true);
    expect(wholeTurnWaitMs(false)).toBe(150);
    process.env.VERCEL = "1";
    expect(canPrewarm()).toBe(false);
    expect(wholeTurnWaitMs(false)).toBe(1200);
  });
});

describe("retrying speech after a 429", () => {
  it("waits as long as Gemini asks when that is short", () => {
    expect(ttsRetryWaitMs("429 Quota exceeded. Please retry in 3.2s.")).toBe(3300);
  });
  it("gives up when the wait is too long to sit through", () => {
    expect(ttsRetryWaitMs("429 Quota exceeded. Please retry in 41.7s.")).toBeNull();
  });
  it("tries once more shortly when Gemini doesn't say", () => {
    expect(ttsRetryWaitMs("429 Too many requests")).toBe(2000);
  });
});
