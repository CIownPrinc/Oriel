import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { onboard, signUp } from "./helpers";

/**
 * FIX-06 in a real browser: record, reload mid-interview, rejoin, record more, finish.
 * Both stretches of footage are kept as ordered recording parts, and the session clock keeps
 * counting across the reload, so the second answer comes after the first on the timeline.
 */

async function enterRoom(page: Page, button: string) {
  const consent = page.getByRole("dialog");
  await consent.getByLabel("Type your full name to sign").fill("Jamie Park");
  await consent.getByRole("button", { name: "Agree and continue" }).click();
  await expect(page.getByText("Microphone", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: button }).click();
}

/**
 * Give one answer: let the looping fake microphone speak for a few seconds, then press Done, so the
 * test doesn't depend on where the loop is when the question ends.
 */
async function oneAnswer(page: Page) {
  const whisper = page.locator("p[aria-live=polite]");
  await expect(whisper).toHaveText(/Listening/, { timeout: 90_000 });
  await page.waitForTimeout(8000);
  if (/Listening/.test((await whisper.textContent()) ?? "")) await page.getByRole("button", { name: /Done/ }).click();
  await expect(whisper).not.toHaveText(/Listening/, { timeout: 30_000 });
  // Let the turn land and a recording chunk or two upload.
  await page.waitForTimeout(6000);
}

test("a reload mid-interview keeps both parts of the recording, in order", async ({ page }) => {
  test.setTimeout(360_000);
  await signUp(page, `reload-${Date.now()}@oriel.test`);
  await onboard(page, { resume: false });
  await page.getByRole("button", { name: "Start interview" }).click();
  await enterRoom(page, "Start the interview");
  await oneAnswer(page);

  await page.reload();
  await enterRoom(page, "Rejoin the interview");
  await oneAnswer(page);

  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByRole("button", { name: "End and see my feedback" }).click();
  await expect(page).toHaveURL(/playback\//, { timeout: 60_000 });
  await expect(page.getByText("What we measured")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("video")).toHaveCount(1);

  const exported = await (await page.request.get("/api/privacy/export")).json();
  const parts = (exported.data.mediaObjects as { startOffsetMs: number; bytes: number }[]).sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  expect(parts).toHaveLength(2);
  expect(parts.every((p) => p.bytes > 0)).toBe(true);
  expect(parts[0].startOffsetMs).toBeLessThan(1000); // starts with the session clock
  expect(parts[1].startOffsetMs).toBeGreaterThan(0);

  const answers = (exported.data.answers as { seq: number; startMs: number; endMs: number }[]).sort((a, b) => a.seq - b.seq);
  expect(answers.length).toBeGreaterThanOrEqual(2);
  // The clock didn't restart at the reload: answers stay in time order, and the last one (given
  // after the reload) sits after the second part began, not back near zero.
  for (let i = 1; i < answers.length; i++) expect(answers[i].startMs).toBeGreaterThan(answers[i - 1].endMs);
  expect(answers.at(-1)!.startMs).toBeGreaterThanOrEqual(parts[1].startOffsetMs);
});
