import { expect, type Page } from "@playwright/test";

export const RESUME = `Jamie Park
Senior Product Manager

Experience
Senior Product Manager at Fabrikam Health, 2020 - Present
- Led the redesign of patient onboarding, raising activation from 31% to 44%
- Managed a team of 9 across design, research and engineering

Product Manager at Litware, 2016 - 2020
- Launched the mobile scheduling app used by 120 clinics

Education
B.A. Economics, University of Michigan, 2016`;

export const JD = `Group Product Manager - Growth

You will own activation and retention end to end, lead cross-functional squads with engineering and design, and define the metrics that matter. You will present strategy to executives.
- 6+ years of product management
- Track record of measurable impact on activation or retention
- Strong written and verbal communication`;

export async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-test-password-1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/onboarding/);
}

export async function onboard(page: Page, opts: { resume: boolean }) {
  await page.getByRole("button", { name: /Let.s begin/ }).click();
  await page.getByLabel("Your name").fill("Jamie");
  await page.getByLabel("Target role").fill("Senior Product Manager");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radiogroup", { name: "Field" }).getByRole("radio", { name: /^Product Management/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  if (opts.resume) {
    await page.getByPlaceholder("Paste your resume text").fill(RESUME);
    await page.getByRole("button", { name: "Use this resume" }).click();
    await expect(page.getByText("Roles found")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder("Paste the job description").fill(JD);
    await page.getByRole("button", { name: "Use this job description" }).click();
    await expect(page.getByText("What they'll ask about")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
  } else {
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
  }
  await page.getByRole("button", { name: "Set up my first interview" }).click();
  await expect(page).toHaveURL(/practice/);
}
