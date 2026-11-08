import { expect, test } from "./fixtures";

/**
 * The landing page, signed out: one headline, a call to action that leads to sign-up, no sideways
 * scrolling on a small phone, and a console with nothing in it.
 */
test.describe("landing page", () => {
  test("states the promise once and leads to sign-up", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`); });

    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Practice for the room before you’re in it.");
    await expect(page.getByText(/^Sample interview with Daniel/).first()).toBeVisible();

    const cta = page.getByRole("main").getByRole("link", { name: "Start practicing free" }).first();
    await expect(cta).toHaveAttribute("href", "/signup");
    await cta.click();
    await expect(page).toHaveURL(/\/signup$/);
    expect(problems).toEqual([]);
  });

  test("fits a 320px screen with the call to action in view", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole("main").getByRole("link", { name: "Start practicing free" }).first()).toBeInViewport();
  });
});
