import { test, expect } from "@playwright/test";
import { onboard, signUp } from "./helpers";

/**
 * Voice path with a fake microphone playing a recorded spoken answer and a fake
 * camera: VAD endpointing → transcription → interviewer voice → recording upload →
 * Read with audio-derived metrics → Playback with video.
 */
test("voice interview with recording and audio-derived Read", async ({ page }) => {
  await signUp(page, `voice-${Date.now()}@oriel.test`);
  await onboard(page, { resume: false });
  await page.getByRole("button", { name: "Start interview" }).click();
  const consent = page.getByRole("dialog");
  await consent.getByLabel("Type your full name to sign").fill("Jamie Park");
  await consent.getByRole("button", { name: "Agree and continue" }).click();
  await expect(page.getByText("Microphone", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enter the Room" }).click();

  // Wait for at least two full answer cycles (question → listen → endpoint → next question).
  const whisper = page.locator("p[aria-live=polite]");
  await expect(whisper).toHaveText(/Listening/, { timeout: 90_000 });
  let cycles = 0;
  const deadline = Date.now() + 150_000;
  let wasListening = true;
  while (cycles < 2 && Date.now() < deadline) {
    const listening = /Listening/.test((await whisper.textContent()) ?? "");
    if (wasListening && !listening) cycles++;
    wasListening = listening;
    await page.waitForTimeout(500);
  }
  expect(cycles).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByRole("button", { name: "End and see my Read" }).click();
  await expect(page).toHaveURL(/playback\//, { timeout: 60_000 });
  await expect(page.getByText("What we measured")).toBeVisible({ timeout: 120_000 });

  // Audio-derived measurements exist (not "Not measured").
  await expect(page.getByText(/pauses over 0\.7s/)).toBeVisible();
  // The encrypted recording streams back through a signed URL.
  const video = page.locator("video");
  await expect(video).toHaveCount(1);
  const src = await video.getAttribute("src");
  expect(src).toMatch(/\/api\/media\/.+sig=/);
  const res = await page.request.get(src!, { headers: { range: "bytes=0-1023" } });
  expect(res.status()).toBe(206);
  // A tampered signature is refused.
  const bad = await page.request.get(src!.replace(/sig=[^&]+/, "sig=tampered"));
  expect(bad.status()).toBe(403);
});
