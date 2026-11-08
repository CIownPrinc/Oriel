import { test, expect } from "./fixtures";
import { onboard, signUp } from "./helpers";

/**
 * MVP journey in text mode (mic and camera declined): signup → onboarding with resume
 * and job description → interview → Read → Playback → drill → progress → privacy → delete.
 */
test("text-mode journey from signup to deletion", async ({ page }) => {
  await signUp(page, `text-${Date.now()}@oriel.test`);
  await onboard(page, { resume: true });

  await expect(page.getByText("2 roles")).toBeVisible();

  // Make the interviewer yours: a new shape, colour and name.
  await page.getByRole("button", { name: "Customize Daniel" }).click();
  const studio = page.getByRole("dialog", { name: "Make it yours" });
  await studio.getByRole("radio", { name: "Prism" }).click();
  await studio.getByRole("radio", { name: "Sky" }).click();
  await studio.getByRole("radio", { name: /^Puck/ }).click();
  await expect(studio.getByRole("radio", { name: /^Puck/ })).toHaveAttribute("aria-checked", "true");
  await studio.getByLabel("Name").fill("Captain Byte");
  await studio.getByRole("button", { name: "Save" }).click();
  await expect(studio).toBeHidden();
  await expect(page.getByRole("radio", { name: /^Captain Byte, Hiring manager/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Start interview" }).click();
  await expect(page).toHaveURL(/room\//);

  // Consent: decline microphone and camera → text mode.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Your interviewer is an AI.")).toBeVisible();
  await dialog.getByRole("switch").nth(0).click(); // microphone off
  await dialog.getByRole("switch").nth(1).click(); // camera off
  await dialog.getByRole("button", { name: "Continue in text mode" }).click();
  await expect(page.getByText("Text mode: you'll type your answers")).toBeVisible();
  await page.getByRole("button", { name: "Start the interview" }).click();
  await expect(page.getByText(/^Captain Byte · /)).toBeVisible({ timeout: 30_000 });

  const answers = [
    "At Fabrikam I led the patient onboarding redesign. I ran fourteen user interviews, cut three steps, and activation rose from 31 percent to 44 percent in one quarter.",
    "We did a lot of things and helped with various stuff, it went pretty well I think.",
    "I managed a team of 9. I set weekly goals, I paired design with research, and we shipped the scheduling app to 120 clinics in five months.",
  ];
  for (const a of answers) {
    const box = page.getByPlaceholder("Type your answer. Enter sends it.");
    await expect(box).toBeVisible({ timeout: 60_000 });
    await box.fill(a);
    await box.press("Enter");
    await expect(box).toBeHidden();
  }
  await expect(page.getByPlaceholder("Type your answer. Enter sends it.")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByRole("button", { name: "End and see my feedback" }).click();

  await expect(page).toHaveURL(/playback\//, { timeout: 60_000 });
  await expect(page.getByText("Key moments")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("What we measured")).toBeVisible();
  await expect(page.getByText("Not measured: recovery needs spoken answers.")).toBeVisible();
  const transcript = page.getByText("Transcript", { exact: true });
  await expect(transcript).toBeVisible();
  await expect(page.getByText(/I'm an AI interviewer|I am an AI interviewer|AI interviewer/).first()).toBeVisible();
  await expect(page.getByText("Captain Byte", { exact: true }).first()).toBeVisible(); // transcript speaker

  // Lessons built from this interview: evidence in their own words, then measured practice.
  await expect(page.getByRole("heading", { name: "What to work on next" })).toBeVisible();
  await page.goto("/lessons");
  await expect(page.getByRole("heading", { name: "Built from how you interviewed." })).toBeVisible();
  await page.getByRole("link", { name: /Start here/ }).click();
  await expect(page).toHaveURL(/lessons\//);
  await expect(page.getByText("What we saw in your interview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How to do it" })).toBeVisible();
  const lessonUrl = page.url();
  await page.getByRole("link", { name: "Start practice" }).click();
  await expect(page.getByRole("link", { name: /^← Lesson:/ })).toBeVisible();
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("button", { name: "Start drill" }).click();
  const practiceBox = page.getByPlaceholder("Type your answer");
  await expect(practiceBox).toBeVisible({ timeout: 60_000 });
  await practiceBox.fill("In 2023 I led a team of 9 to rebuild patient onboarding. I interviewed 14 clinics, I cut 3 steps, and I shipped it in 6 weeks. As a result activation rose from 31 percent to 44 percent, which meant 120 clinics went live a quarter early.");
  await page.getByRole("button", { name: "I'm done" }).click();
  await expect(page.getByText("Next try:")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Lesson practice/)).toBeVisible();
  await page.goto(lessonUrl);
  await expect(page.getByText(/of 2 passes|Practiced/).first()).toBeVisible();

  // Lesson practice is a drill: the free plan's one drill a day is now used.
  await page.goto("/playback");
  await page.getByRole("link").filter({ hasText: /Feedback ready/ }).first().click();
  await page.getByRole("link", { name: /^Drill:/ }).click();
  await expect(page).toHaveURL(/drills\//);
  await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByRole("button", { name: "Start drill" }).click();
  const drillBox = page.getByPlaceholder("Type your answer");
  await expect(drillBox).toBeVisible({ timeout: 60_000 });
  await drillBox.fill("I improved activation from 31 percent to 44 percent in 3 months by cutting 3 onboarding steps across 120 clinics.");
  await page.getByRole("button", { name: "I'm done" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /1 drill per day/ })).toBeVisible({ timeout: 30_000 });

  // Progress and dashboard.
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: /Baseline set|Compared with your own past sessions/ })).toBeVisible();
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: /Ready for your next interview/ })).toBeVisible();

  // Privacy: switch off camera signals.
  await page.goto("/profile#privacy");
  const camSwitch = page.getByRole("switch").first();
  await camSwitch.click();
  await expect(camSwitch).toHaveAttribute("aria-checked", "false");

  // Delete the session.
  await page.goto("/playback");
  await page.getByRole("link").filter({ hasText: /Feedback ready/ }).first().click();
  await page.getByRole("button", { name: "Delete this session" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page).toHaveURL(/\/playback$/);
  await expect(page.getByText("No sessions yet")).toBeVisible();
});
