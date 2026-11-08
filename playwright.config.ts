import { defineConfig } from "@playwright/test";
import path from "node:path";

const PORT = 3200;
const wav = path.join(import.meta.dirname, "tests/e2e/fixtures/answer.wav");

/**
 * E2E runs against a production build with an isolated database and media store.
 * Chrome's fake devices provide a camera and a microphone that plays a recorded
 * spoken answer (tests/e2e/fixtures/answer.wav) on a loop.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    headless: true,
    permissions: ["camera", "microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${wav}`,
        "--autoplay-policy=no-user-gesture-required",
        // The interviewer speaks during the journeys; keep it off the developer's speakers.
        "--mute-audio",
      ],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `rm -rf data/e2e && npx next start --port ${PORT}`, // run `npm run build` first
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { DATABASE_PATH: "data/e2e/oriel.db", MEDIA_DIR: "data/e2e/media", ORIEL_PAYMENTS: "dev", ORIEL_ENFORCE_LIMITS: "1", ORIEL_SECRET: `e2e-${Date.now()}-0123456789abcdef0123456789abcdef` },
  },
});
