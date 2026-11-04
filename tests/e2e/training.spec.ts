import { test, expect } from "@playwright/test";
import { onboard, signUp } from "./helpers";

/**
 * The practice loop's shell, without spending a model call: start a practice, answer too
 * briefly, and get asked for a full answer rather than a judgment.
 */
test("training: an answer too short to judge is asked for again, not scored", async ({ page }) => {
  await signUp(page, `train-${Date.now()}@oriel.test`);
  await onboard(page, { resume: false });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Practice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Practice one skill until it holds." })).toBeVisible();
  await expect(page.getByText("Nothing assessed yet.")).toBeVisible();
  await page.getByRole("radio", { name: /^Explaining your own contribution/ }).click();
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/train\/trn_/);
  // While answering, the skill being practised is not named.
  await expect(page.getByText("Explaining your own contribution")).toHaveCount(0);
  await page.getByLabel("Your answer").fill("We shipped it.");
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText(/too short to assess/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/isn.t counted against you/)).toBeVisible();
  await expect(page.getByText("Same question. Give it a full answer.")).toBeVisible();
});
