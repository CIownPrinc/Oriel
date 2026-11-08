# Oriel audit handoff

## Context

The audit is `Oriel_Final_Audit_and_Action_Plan.md` (audit date 2026-11-07), written against commit `c818fd7`. Every FIX item in it (FIX-01 to FIX-11) has been worked through on the branch described below. Items that need an outside account (Stripe, an email sender, real addresses) have their code paths in place and are listed under "Needs the owner".

Start with `README.md` and `docs/DESIGN.md`. The app is Next.js/React/TypeScript with Drizzle and SQLite/Turso.

## Verification (2026-11-07)

| Check | Result |
|---|---|
| `npm test` (unit + integration) | 267 passed, 28 files (baseline was 201 in 19) |
| `npm run typecheck`, `npm run lint` | pass |
| `npm run build` | pass |
| `npm run test:e2e` | 7 of 7 passed, including a new reload-mid-interview journey |
| Migration upgrade | A database at the released schema (migrations 0000-0004), filled with duplicate jobs, replaced resumes and an old recording, upgraded cleanly through 0010; data checks pass; re-running is a no-op |

Each fix's regression test was checked by breaking the fix on purpose and confirming the test fails. No original test was removed or loosened; the only edits to old tests are e2e selectors for renamed buttons and a fixture that silences browser speech.

## What changed, by audit item

| ID | Change | Tests |
|---|---|---|
| FIX-01 | Signup always creates a regular user. Admins via `npm run admin:grant -- email` (signs them out). | `privacy-retention.test.ts` |
| FIX-02 | Withdrawing camera consent turns it off on every session and deletes `vision` and `setup` timelines; late uploads are dropped. | `privacy-retention.test.ts` |
| FIX-03 | One deadline for recordings and signals (session created + retention days); shortening applies to existing data; expired sessions refuse uploads. | `privacy-retention.test.ts` |
| FIX-04 | Daily Vercel cron (`/api/cron/cleanup`, `CRON_SECRET`) runs one leased job; runs logged in `cleanup_runs`; failed storage deletes retried. | `privacy-retention.test.ts` |
| FIX-05 | `src/server/privacy/inventory.ts` classifies every table; export is built from it (training history included, secrets omitted); a test fails if a new table isn't classified. Replacing a resume/job description deletes the old one (migration 0006 cleans existing ones). Account deletion keeps consent proof in the audit log without name, signature or device. | `privacy-export.test.ts` |
| FIX-06 | Each Room page load records its own part (`part_key`, `start_offset_ms`); rejoining continues the session clock; Playback plays parts in order and seeks across them; a persistent warning shows if recording stops. | `recording-parts.test.ts`, `journey-reload.spec.ts` |
| FIX-07 | The model stream is no longer awaited before speaking, so the acknowledgement and first sentence go out while it's still writing. The model stream is closed if the client disconnects. | `turn-streaming.test.ts` |
| FIX-08 | Analysis jobs: one row per session, database lease claims, stale-job recovery in the daily cleanup (3 automatic attempts), "stuck" detection with a retry button. Ladder credit once per session. Turn retries carry a `turnKey` and aren't stored twice. Concurrent completes record usage once. A late transcript triggers reanalysis. | `analysis-durability.test.ts` |
| FIX-09 | Beta wording everywhere payments appear (`ORIEL_PAYMENTS=stripe` removes it). Database-backed rate limits for AI routes and sign-in (`shared: true`). Daily AI cost ceiling per person (`ORIEL_DAILY_COST_LIMIT_USD`, default $5). | `shared-limits.test.ts` |
| FIX-10 | Password reset (hashed single-use 30-minute links, non-enumerating, signs out everywhere) via Resend. `/terms` page, linked from signup. All `.example` addresses replaced by `ORIEL_CONTACT_EMAIL` (links hidden until set). Validation reports readable at `/trust/reports/speech` and `/trust/reports/camera`. | `password-reset.test.ts` |
| FIX-11 | "actually"/"literally" counted as fillers and "just" as a hedge only in filler/softening uses. Story structure judged only on story questions (not technical or case answers). Hedging reported at medium confidence. | `feedback-rubric.test.ts` |

Also done at the owner's request: plainer wording across the site (feedback instead of "the Read", interview instead of "the Room", levels instead of rungs, eye contact instead of camera engagement); consent wording updated with it (version `2026-11-07.1`); plan bullets no longer advertise "avatar minutes" for an avatar vendor that isn't connected; the browser fallback voice picks the most natural voice available; e2e runs make no sound.

## Needs the owner (can't be done in code)

Set in Vercel, then redeploy:

| Variable | Why |
|---|---|
| `CRON_SECRET` | Without it no cleanup runs (retention deletes, stuck analysis recovery). Any long random string. |
| `ORIEL_CONTACT_EMAIL` | Contact links stay hidden until set. |
| `RESEND_API_KEY`, `ORIEL_EMAIL_FROM` | Password reset by email. Without them the reset page says it isn't set up. |
| `GEMINI_API_KEY` | The real AI interviewer and natural voices (free key from Google AI Studio). |

Also: review existing production admin accounts; Stripe checkout and webhooks (FIX-09) need a Stripe account; the privacy policy and terms need a lawyer's review; the camera and speech accuracy claims still need testing with real people (audit section 6).

## Remaining limitations

- On Vercel Hobby the cron runs daily, so stuck analysis and idle sessions are picked up within a day. A Pro plan can run it more often.
- Shared rate limits add one database write to each expensive request; cheap routes keep the per-instance limiter.
- FIX-11 is a targeted improvement, not a full per-question-type rubric; there is no human-reviewed answer set yet.
- Env vars are still read directly in many places; the house rules ask for one validated env module. Not started.
- The project uses npm; the house rules prefer pnpm. Not migrated.
