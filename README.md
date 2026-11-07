# Oriel

/ˈôrēəl/ — a bay window that juts out from a wall, so you can see and be seen.

A practice interview with a lifelike interviewer who pushes back, reads your delivery, and shows you your own footage with coaching attached.

**Enter the room → feel the pressure → get evidence → understand what happened → drill the weakness → try again.**

---

## Quick start

```bash
npm install
cp .env.example .env.local        # add GEMINI_API_KEY (and ORIEL_SECRET for production)
npm run dev                       # http://localhost:3000
npm run db:seed                   # optional: demo account with three analysed sessions
```

Requires Node 20.9+ and a Chromium-based browser for the best experience (live speech recognition). Safari and Firefox fall back to server transcription or typed answers.

Without any API key the app still runs end to end: the interviewer speaks with the browser's voice, phrases questions from deterministic templates, and the Read uses heuristic analysis. The UI shows a **mock AI** badge whenever that is the case.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit + integration tests (Vitest, a throwaway SQLite file, mock providers) |
| `npm run test:e2e` | Production build + Playwright journeys in Chrome with a fake camera and a microphone that plays a recorded spoken answer |
| `npm run db:seed` | Demo account (`src/db/seed.ts` documents the local-only login) |
| `npm run validate:speech` | Speech-metric accuracy + accent parity against labelled clips (needs `GEMINI_API_KEY`) → `docs/validation/speech-report.md` |
| `npm run validate:camera` | Camera-signal accuracy + bias audit on labelled portraits, run through the Room's on-device code (dev server running) → `docs/validation/camera-report.md` |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

## What's in the box

| Area | Where | Notes |
| --- | --- | --- |
| Landing page | `src/app/(marketing)` | Live bot interviewer in the hero and a live panel preview; the pressure demo reads the real pressure policy |
| Auth | `src/lib/auth`, `src/app/api/auth` | Email + password (scrypt), hashed session tokens in httpOnly cookies |
| Onboarding | `src/app/onboarding` | Resume (PDF/DOCX/paste) and job description parsed into structured data; nothing invented |
| Interview setup | `src/app/(app)/practice` | Role, round, type, interviewer, pressure dial, panel size, Ladder rung |
| **The Room** | `src/features/room` | Consent (with e-signature for camera signals) → device check (lens calibration) → live interview |
| **The interviewer** | `src/components/avatar`, `src/lib/avatar/style.ts` | A family of minimal bots with expressive capsule eyes (canvas 2D, spring physics) in eight shapes — Classic, Orb, Prism, Hex, Capsule, Gem, Window, Pebble — that morph into each other. Anyone can restyle, rename and re-voice any interviewer ("Customize" in Practice setup, or Profile → Your interviewers) — 18 Gemini voices, each previewable, with the bot speaking the sample; it introduces itself by that name and speaks with that voice in the Room and in drills, and its behaviour stays with the persona. Design explored with Higgsfield / Nano Banana Pro, then drawn procedurally. `/dev/avatar` shows every persona × expression and every shape × accessory |
| Interview engine | `src/lib/interview` | Deterministic state machine, pressure engine, personas, 8 domain packs |
| **The Read** | `src/lib/analysis` | Pace, pauses, fillers, hedging, structure, specificity, recovery, vocal variety, camera engagement, posture, setup — each with confidence |
| **Playback** | `src/features/playback` | 3–5 timestamped moments that jump the recording, coaching, rewritten weakest answer, first-vs-latest comparison, transcript |
| **Lessons** | `src/lib/lessons`, `src/server/lessons.ts`, `src/app/(app)/lessons` | After each analysed interview, a personal plan across three tracks — **Delivery** (fillers, pace, vocal variety), **Responses** (structure, specificity, hedging, recovery, concision, opener) and **Presence** (eye contact, posture, setup). The planner picks the skills furthest from the Read's own targets (at most 5 at once, 2 per track; unmeasured skills are never planned) and quotes the person's own words as evidence, linked to the moment in Playback. A human-written lesson library supplies the technique; the Lesson Writer adds a personal observation, a tip and one of their answers rewritten — checked so it can't introduce numbers, change what they said, or overclaim (fillers and hedging use their exact words with the softeners removed). Each lesson ends in a measured drill; it counts as practised after two passes and is only marked mastered when a later interview confirms it |
| Drills | `src/features/drills` | Eleven five-minute drills measured with the same code as the Read (pace and pitch from the voice, posture from the camera), each against your baseline |
| Ladder & Progress | `src/app/(app)/ladder`, `progress` | Professional progression; comparisons only against your own history |
| Privacy | `src/lib/privacy`, `src/server/privacy` | Consent logging (wording hash + e-signature), encrypted media, retention sweeper, deletion, export; public policy at `/privacy` |
| Trust | `src/app/(marketing)/trust`, `docs/validation` | Published accuracy and bias results for the Read, with what changed because of them |
| Billing | `src/lib/billing` | Plans + one entitlement module (`canUsePanelMode()`, `canUseAvatarMinutes()`, …) |
| Admin console | `src/app/(app)/admin` | Sessions, interviewer decisions, AI outputs, latency, costs, errors, pipeline, metric confidence |

## Deploying to Vercel

Serverless functions have no lasting disk, so a deployment keeps its data elsewhere. The code picks this up from environment variables, with nothing to change:

| Variable | What it does |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | The database (Turso speaks the same SQLite dialect). Migrations and the catalog seed run on the first query. |
| `BLOB_READ_WRITE_TOKEN` | Recordings go to a **private** Vercel Blob store (created from the Storage tab, which sets this for you). Segments are encrypted before upload. |
| `GEMINI_API_KEY` | Interviewer voice, speech-to-text and the language model. |
| `ORIEL_SECRET` | Long random string; signs sessions and derives the encryption keys. Keep it stable, or old recordings can't be read. |
| `ORIEL_SITE_URL` | The deployment's public URL. |

Plan limits are off for now, so everyone gets every feature. Set `ORIEL_ENFORCE_LIMITS=1` to enforce them.

Analysis runs after the response with `after()`, and the routes that start it allow up to 300 seconds. Rate limits are kept in memory per instance, so they're looser on a serverless host than on a single server.

Without the Turso and Blob variables the app falls back to `data/oriel.db` and `data/media/`, which is what local development uses.

## Architecture

```
Browser (the Room)                                   Server (Next.js route handlers)
───────────────────────────────                      ─────────────────────────────────────────────
mic ─▶ MicAnalyzer (VAD, pitch, 10 Hz) ─┐            POST /turn ─▶ heuristics ─▶ Interview Controller
     ─▶ SpeechRecognition (live text)   ├─ endpoint ─▶           (deterministic decision, seeded PRNG)
     ─▶ AnswerRecorder (per answer)     ┘                        ─▶ Interviewer (streams sentences)
camera ─▶ MediaPipe face+pose (on device) ─▶ derived numbers     ─▶ TTS (phrase cache + prewarm) ─▶ NDJSON
                                                                  ─▶ Answer Analyzer (background, memory ledger)
NDJSON ◀── decision · text · PCM audio · done
PCM ─▶ InterviewerAudio (WebAudio) ─▶ BotAvatar (voice light)      Session complete ─▶ async pipeline:
       └─▶ recording mix (both voices) ─▶ SessionRecorder         store → transcript alignment → audio →
           (chunked upload, AES-256-GCM at rest, per-user keys)   pose/gaze → segmentation → competencies →
                                                                  weak moments → Playback → coaching → progress
```

Key decisions:

- **The model never decides what happens next.** `src/lib/interview/controller.ts` chooses follow-ups, pressure events, memory callbacks, curveballs, handoffs and closing from the analysed answer and the pressure policy. The language model only phrases that decision in the persona's voice. Every decision is logged with its reason (admin console).
- **Pressure changes behaviour, not a colour.** `pressure.ts` turns a level (1–5) and a persona into interrupt timers, deliberate silence, follow-up depth, skepticism, numeric probing, vagueness tolerance, curveball rate, reassurance and avatar stillness. It adapts to performance. Tests assert the monotonic effect.
- **Memory is a ledger.** Claims are extracted verbatim from answers (regex + the model analyzer, which is only allowed to keep excerpts that literally appear in the answer). The interviewer can only reference claims from the ledger.
- **Providers are adapters.** `src/lib/ai/providers` (`LanguageModelProvider`, `TextToSpeechProvider`, `SpeechToTextProvider`) and `src/lib/avatar` (`AvatarProvider`). Gemini, an optional Claude adapter, and honest mocks that make callers fall back to deterministic paths.
- **Nothing is lost when a provider fails.** LLM timeout → template phrasing. TTS failure → browser voice. Avatar render failure → voice-only orb. No mic → text mode. Analysis failure → session preserved, retry button. Reload mid-interview → rejoin; sessions idle for 30 min are finalised and analysed.

### Providers used (measured 2026-09-29)

| Job | Model | Measured |
| --- | --- | --- |
| Interviewer phrasing | `gemini-3.1-flash-lite` (stream) | first token 410–860 ms |
| Voice | `gemini-3.8-flash-lite-tts` (stream, 24 kHz PCM) | first chunk 460–760 ms; cache hit ~0 ms |
| Answer transcription (keeps "um"/"uh") | `gemini-3.5-transcribe` | 1.2–2.7 s per answer, off the critical path |
| Parsing, answer analysis, coaching | `gemini-3.8-flash` (JSON schema, Zod-validated) | 2–3 s, async |
| Face + pose | MediaPipe Tasks (WASM, on device) | ~4 samples/s |

Turn latency, server side (request → first interviewer audio): **planned questions 6–30 ms** (pre-synthesised while you answer), **model-written follow-ups ~1.2–1.6 s**. Add endpointing (850 ms once the recogniser closes the sentence, 1.3 s otherwise). At pressure ≥ 3 the interviewer's deliberate silence (0.9–3 s) overlaps this processing. All of this is recorded per turn and shown in the admin console.

## Privacy & security

- Standalone consent before any device turns on; the version shown is logged with every choice.
- Face and pose landmarks never leave the browser — only derived numbers (engagement estimate, lean, sway…). The signal API's schema cannot carry images or landmarks.
- Recordings: uploaded in chunks as they are produced, sealed with AES-256-GCM under per-user HKDF keys, served only through short-lived HMAC-signed URLs *and* the owner's session, with range support. Default retention 30 days (1/7/30/90 configurable, applied retroactively), then deleted by a sweeper.
- One-click session deletion and account deletion; JSON export of everything stored.
- Never measured: attractiveness, age, race, emotion, personality, accent. Gaze and posture can be switched off.
- Server-side provider calls only; keys never reach the client. Per-user rate limits, same-origin check on mutations, CSP and security headers, audit log.

## Not yet wired (by design, with adapters in place)

- **Managed avatar vendor** (HeyGen LiveAvatar / Tavus / Anam): `ExternalAvatarProvider` + `/api/avatar/session` exist; without credentials the on-device bot interviewer is used. The business plan recommends measuring two vendors for latency, idle billing and concurrency first.
- **Payments**: `ORIEL_PAYMENTS=dev` applies plan changes instantly with no charge (clearly labelled). Stripe Checkout + webhook plugs into `/api/billing/checkout`.
- **Storage**: a local SQLite file and encrypted files on disk in development; Turso and a private Vercel Blob store when deployed (see below).
- **Quotas**: a free-tier Gemini key allows ~10 TTS requests/minute. Oriel budgets prewarming within `ORIEL_TTS_RPM` and falls back to a sibling model on 429, but sustained use needs a paid tier.

## Validation (from the plan)

**Done (synthetic, published at `/trust`):**

- *Speech metrics* — 16 labelled clips across 8 accents with known silences, pauses and scripts, run through the product's own frame analysis, transcription and Read. Found and fixed a ~20% pace under-read and spurious pitch on quiet frames; measured an accent-dependent filler undercount from transcription.
- *Camera signals* — 12 synthetic webcam portraits (Higgsfield Soul 2.0) spanning skin tone, age, eyewear, head coverings and lighting. Faces were found in all; a forward-facing person in a hijab was misread as "looking away" uncalibrated, so camera engagement now requires each person's own lens calibration.
- *Posture* — each lens-facing portrait calibrated as its own baseline, then zoomed out and in to mimic sitting back and leaning in: 35/35 runs read correctly and distance never registered as a slouch. A code review had found the old slouch measure shrank with distance (sitting back read as slouching); it is now a proportion of shoulder width, ignores frames where you look down at notes, and the Read says when posture wasn't measured. The Room's setup check shows posture live so people can see what will be measured.
- *Privacy* — public biometric notice and retention schedule (`/privacy`), written release by e-signature with the wording hash recorded, consent logging on every settings change, deletion of camera-derived data on withdrawal and at the raw-video retention date, 3-year inactive-account purge, and a review packet for counsel (`docs/privacy/counsel-review.md`).

**Still owed (needs people, not code):** validation against human-coded recordings of ~30 real sessions (including real slouching, which sets the slouch threshold); fairness testing with real participants across skin tones, lighting, glasses, head coverings, accents and disabilities; the privacy-counsel review itself (the packet lists ten specific questions); outcome tracking with the first cohort.
