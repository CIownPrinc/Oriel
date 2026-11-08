import { describe, expect, it } from "vitest";
import { pickBrowserVoice, type VoiceLike } from "@/lib/avatar/browser-voice";

const v = (name: string, lang = "en-US", localService = true): VoiceLike => ({ name, lang, localService });

describe("browser voice choice", () => {
  it("prefers Edge's neural voices over the old Windows desktop ones", () => {
    const voices = [v("Microsoft David - English (United States)"), v("Microsoft Zira - English (United States)"), v("Microsoft Aria Online (Natural) - English (United States)", "en-US", false)];
    expect(pickBrowserVoice(voices)?.name).toMatch(/Aria Online \(Natural\)/);
  });

  it("prefers Chrome's Google voices over Windows desktop voices", () => {
    const voices = [v("Microsoft David - English (United States)"), v("Google US English", "en-US", false)];
    expect(pickBrowserVoice(voices)?.name).toBe("Google US English");
  });

  it("prefers macOS premium voices and never picks novelty voices", () => {
    const voices = [v("Zarvox"), v("Bells"), v("Fred"), v("Samantha"), v("Ava (Premium)")];
    expect(pickBrowserVoice(voices)?.name).toBe("Ava (Premium)");
    expect(pickBrowserVoice([v("Zarvox"), v("Bells")])).toBeNull();
  });

  it("only picks English voices, and still picks a plain one when that's all there is", () => {
    expect(pickBrowserVoice([v("Microsoft Hortense", "fr-FR"), v("Microsoft David - English (United States)")])?.name).toMatch(/David/);
    expect(pickBrowserVoice([v("Google français", "fr-FR")])).toBeNull();
    expect(pickBrowserVoice([])).toBeNull();
  });
});
