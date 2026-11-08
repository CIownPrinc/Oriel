import { test, expect } from "./fixtures";
import { onboard, signUp } from "./helpers";

const SOL: Record<string, string> = {
  dedupe: "function dedupe(items) { return [...new Set(items)]; }",
  secondLargest: "function secondLargest(nums) { const u = [...new Set(nums)].sort((a, b) => b - a); return u.length > 1 ? u[1] : null; }",
  chunk: "function chunk(items, size) { const out = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }",
};

/** Coding practice under the production CSP: the sandbox runs, stops an endless loop, and passes real code. */
test("training: code runs in the browser sandbox and is judged by its tests", async ({ page }) => {
  await signUp(page, `code-${Date.now()}@oriel.test`);
  await onboard(page, { resume: false });
  await page.goto("/train");
  await page.getByRole("radio", { name: "Technical" }).click();
  await page.getByRole("radio", { name: /^Writing working code/ }).click();
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/train\/trn_/);
  const fn = (await page.locator("#code").inputValue()).match(/function (\w+)/)![1];
  expect(Object.keys(SOL)).toContain(fn); // first attempts are the easiest problems
  await page.locator("#code").fill(`function ${fn}() { while (true) {} }`);
  await page.getByRole("button", { name: "Run examples" }).click();
  await expect(page.getByText(/didn't finish within/).first()).toBeVisible({ timeout: 10_000 });
  await page.locator("#code").fill(SOL[fn]);
  await page.getByRole("button", { name: "Run examples" }).click();
  await expect(page.getByText("passes").first()).toBeAttached();
  await expect(page.getByText("fails")).toHaveCount(0);
});
