import { test as base, expect } from "@playwright/test";

/**
 * Every e2e page gets a silent speechSynthesis. Without a server voice the interviewer
 * talks through the browser's speech engine, which on Windows plays through the OS speech
 * service, so Chrome's --mute-audio doesn't reach it. The stub still fires start and end,
 * so the interview moves on exactly as it would after real speech.
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.addInitScript(() => {
      if (!("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      synth.speak = (u: SpeechSynthesisUtterance) => {
        // dispatchEvent also runs the onstart/onend handlers the app sets.
        setTimeout(() => {
          u.dispatchEvent(new Event("start"));
          setTimeout(() => u.dispatchEvent(new Event("end")), 50);
        }, 0);
      };
    });
    await provide(context);
  },
});

export { expect };
