import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { AvatarStyle } from "../lib/avatar/style";
import type { LessonContent, LessonEvidence } from "../lib/lessons/types";
import type { CriterionJudgment, LoopOutcome, Weakness } from "../lib/training/engine";
import type { Exercise } from "../lib/training/questions";

/**
 * Oriel relational model. SQLite in development (libsql), Turso when deployed, shaped so it maps
 * 1:1 onto Postgres for production. JSON columns are used only for genuinely
 * document-shaped payloads (e.g. a parsed resume), never for core relations.
 */

const id = () => text("id").primaryKey();
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

// ─── Identity ────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  onboardedAt: integer("onboarded_at", { mode: "timestamp_ms" }),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

export const authSessions = sqliteTable("auth_sessions", {
  id: id(), // sha256 of the cookie token — the raw token is never stored
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [index("auth_sessions_user_idx").on(t.userId)]);

/** Password reset links: the token's SHA-256 is the id (the token itself is only in the email). */
export const passwordResets = sqliteTable("password_resets", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [index("password_resets_user_idx").on(t.userId)]);

export type ExperienceLevel = "early" | "mid" | "senior" | "executive";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  targetRole: text("target_role").notNull(),
  domain: text("domain").notNull().default("software"),
  experienceLevel: text("experience_level").$type<ExperienceLevel>().notNull().default("mid"),
  preferredInterviewType: text("preferred_interview_type").notNull().default("behavioral"),
  preferredPersona: text("preferred_persona").notNull().default("hiring_manager"),
  // Privacy preferences
  cameraMetricsEnabled: integer("camera_metrics_enabled", { mode: "boolean" }).notNull().default(true),
  gazeMetricEnabled: integer("gaze_metric_enabled", { mode: "boolean" }).notNull().default(true),
  postureMetricEnabled: integer("posture_metric_enabled", { mode: "boolean" }).notNull().default(true),
  recordVideo: integer("record_video", { mode: "boolean" }).notNull().default(true),
  videoRetentionDays: integer("video_retention_days").notNull().default(30),
  // The person's own look and name for each interviewer, keyed by persona id.
  avatarStyles: json<Partial<Record<string, AvatarStyle>>>("avatar_styles"),
  updatedAt: createdAt(),
});

export type ParsedResume = {
  headline: string | null;
  summary: string | null;
  roles: { title: string; organization: string | null; start: string | null; end: string | null; highlights: string[] }[];
  skills: string[];
  education: { institution: string; credential: string | null; year: string | null }[];
  metrics: string[]; // quantified statements copied verbatim from the resume
  source: "llm" | "heuristic";
};

export const resumes = sqliteTable("resumes", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  rawText: text("raw_text").notNull(),
  parsed: json<ParsedResume>("parsed"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("resumes_user_idx").on(t.userId)]);

export type ParsedJobDescription = {
  title: string | null;
  company: string | null;
  seniority: string | null;
  competencies: { key: string; label: string; evidence: string }[];
  requirements: string[];
  source: "llm" | "heuristic";
};

export const jobDescriptions = sqliteTable("job_descriptions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rawText: text("raw_text").notNull(),
  parsed: json<ParsedJobDescription>("parsed"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("jds_user_idx").on(t.userId)]);

// ─── Interview configuration ────────────────────────────────────────────────

/** Catalog of interviewer archetypes (seeded from code, editable later). */
export const personas = sqliteTable("personas", {
  id: id(), // e.g. "warm_recruiter"
  name: text("name").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  warmth: real("warmth").notNull(),
  skepticism: real("skepticism").notNull(),
  pace: real("pace").notNull(),
  interruptionRate: real("interruption_rate").notNull(),
  silenceTolerance: real("silence_tolerance").notNull(),
  specificityDemand: real("specificity_demand").notNull(),
  expressiveness: real("expressiveness").notNull(),
  voice: text("voice").notNull(),
  accent: text("accent").notNull(), // avatar tint
});

/** A configured interview (what the user asked for). One interview → many sessions (retries). */
export const interviews = sqliteTable("interviews", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  domain: text("domain").notNull(),
  level: text("level").notNull(), // recruiter | hiring_manager | senior_manager | executive
  type: text("type").notNull(), // behavioral | technical | case | leadership | mixed
  pressure: integer("pressure").notNull(), // 1..5
  mode: text("mode", { enum: ["single", "panel"] }).notNull().default("single"),
  resumeId: text("resume_id").references(() => resumes.id, { onDelete: "set null" }),
  jobDescriptionId: text("job_description_id").references(() => jobDescriptions.id, { onDelete: "set null" }),
  ladderLevel: integer("ladder_level"),
  targetMinutes: integer("target_minutes").notNull().default(15),
  createdAt: createdAt(),
}, (t) => [index("interviews_user_idx").on(t.userId)]);

export const panels = sqliteTable("panels", {
  id: id(),
  interviewId: text("interview_id").notNull().references(() => interviews.id, { onDelete: "cascade" }),
  size: integer("size").notNull(),
});

export type SessionPhase =
  | "INTRO" | "QUESTION" | "LISTENING" | "ANALYZING" | "FOLLOW_UP"
  | "PRESSURE_EVENT" | "NEXT_QUESTION" | "CLOSING" | "COMPLETE";

export type AnalysisStatus = "not_started" | "queued" | "running" | "complete" | "failed";

export const interviewSessions = sqliteTable("interview_sessions", {
  id: id(),
  interviewId: text("interview_id").notNull().references(() => interviews.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["created", "live", "ended", "abandoned"] }).notNull().default("created"),
  phase: text("phase").$type<SessionPhase>().notNull().default("INTRO"),
  // Deterministic controller state (serialized InterviewState). Relations such as
  // questions, answers, claims are stored in their own tables; this holds cursors.
  controllerState: json<Record<string, unknown>>("controller_state"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  // Providers actually used (after fallbacks)
  llmProvider: text("llm_provider"),
  sttProvider: text("stt_provider"),
  ttsProvider: text("tts_provider"),
  avatarProvider: text("avatar_provider"),
  degradedMode: text("degraded_mode"), // null | "voice" | "text"
  cameraMetricsEnabled: integer("camera_metrics_enabled", { mode: "boolean" }).notNull().default(true),
  analysisStatus: text("analysis_status").$type<AnalysisStatus>().notNull().default("not_started"),
  analysisError: text("analysis_error"),
  summary: json<SessionSummary>("summary"),
  videoExpiresAt: integer("video_expires_at", { mode: "timestamp_ms" }),
  /** Set once when this session counted toward its Ladder level, so reanalysis can't count it again. */
  ladderCreditedAt: integer("ladder_credited_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId), index("sessions_interview_idx").on(t.interviewId)]);

export type SessionSummary = {
  headline: string;
  strengths: string[];
  focus: string[];
  rewrittenAnswer: { questionId: string; original: string; rewritten: string; note: string } | null;
  source: "llm" | "heuristic";
};

/** An interviewer instance seated in a session (single or panel). */
export const interviewers = sqliteTable("interviewers", {
  id: id(),
  sessionId: text("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  personaId: text("persona_id").notNull().references(() => personas.id),
  panelRole: text("panel_role"), // hiring_manager | peer | skeptic | executive
  displayName: text("display_name").notNull(),
  avatarStyle: json<AvatarStyle>("avatar_style"), // snapshot at creation, so later restyling doesn't rewrite past sessions
  seat: integer("seat").notNull().default(0),
  competencyFocus: json<string[]>("competency_focus"),
  memory: json<string[]>("memory"), // per-interviewer private notes (claims they intend to probe)
});

export const questions = sqliteTable("questions", {
  id: id(),
  sessionId: text("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  interviewerId: text("interviewer_id").references(() => interviewers.id, { onDelete: "set null" }),
  seq: integer("seq").notNull(),
  kind: text("kind").notNull(), // intro | primary | follow_up | pressure | memory_callback | curveball | closing | cross
  competency: text("competency"),
  text: text("text").notNull(),
  difficulty: integer("difficulty").notNull().default(2),
  parentQuestionId: text("parent_question_id"),
  decisionReason: text("decision_reason"),
  askedAtMs: integer("asked_at_ms").notNull(), // ms from session start
  speechEndMs: integer("speech_end_ms"),
}, (t) => [index("questions_session_idx").on(t.sessionId)]);

export type AnswerFlags = {
  vague: boolean;
  hasNumbers: boolean;
  star: { situation: boolean; action: boolean; result: boolean; outcome: boolean };
  hedges: number;
  fillers: number;
  wordCount: number;
  claims: string[];
};

export const answers = sqliteTable("answers", {
  id: id(),
  sessionId: text("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  text: text("text").notNull(),
  /** Server transcription of the answer audio (keeps disfluencies); preferred by the Read. */
  serverText: text("server_text"),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  firstWordLatencyMs: integer("first_word_latency_ms"),
  interrupted: integer("interrupted", { mode: "boolean" }).notNull().default(false),
  inputMode: text("input_mode", { enum: ["voice", "text"] }).notNull().default("voice"),
  flags: json<AnswerFlags>("flags"),
  analysis: json<Record<string, unknown>>("analysis"), // LLM answer-analyzer output (validated)
  /** Chosen by the Room for each answer it sends; a retried turn carries the same key and isn't stored twice. */
  turnKey: text("turn_key"),
}, (t) => [index("answers_session_idx").on(t.sessionId), uniqueIndex("answers_turn_key_idx").on(t.sessionId, t.turnKey)]);

/** Memory ledger: things the candidate said that the interviewer may return to. */
export const claims = sqliteTable("claims", {
  id: id(),
  sessionId: text("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  answerId: text("answer_id").notNull().references(() => answers.id, { onDelete: "cascade" }),
  answerSeq: integer("answer_seq").notNull(),
  kind: text("kind").notNull(), // number | team | project | responsibility | outcome | contradiction
  text: text("text").notNull(), // verbatim excerpt
  normalized: text("normalized"),
  status: text("status", { enum: ["open", "probed", "supported", "weak"] }).notNull().default("open"),
  createdAt: createdAt(),
}, (t) => [index("claims_session_idx").on(t.sessionId)]);

export const transcriptSegments = sqliteTable("transcript_segments", {
  id: id(),
  sessionId: text("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  speaker: text("speaker", { enum: ["candidate", "interviewer"] }).notNull(),
  interviewerId: text("interviewer_id"),
  questionId: text("question_id"),
  answerId: text("answer_id"),
  text: text("text").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  source: text("source").notNull(), // webspeech | gemini | typed | tts
  words: json<{ w: string; s: number; e: number }[]>("words"),
}, (t) => [index("segments_session_idx").on(t.sessionId)]);

/** Raw derived signal timelines uploaded by the client (never raw face geometry). */
export const signalTimelines = sqliteTable("signal_timelines", {
  id: id(),
  sessionId: text("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["audio", "vision", "setup"] }).notNull(),
  startMs: integer("start_ms").notNull(),
  samples: json<unknown[]>("samples").notNull(),
}, (t) => [index("signals_session_idx").on(t.sessionId)]);

export type Confidence = "high" | "medium" | "low";

export const metrics = sqliteTable("metrics", {
  id: id(),
  sessionId: text("session_id").references(() => interviewSessions.id, { onDelete: "cascade" }),
  drillAttemptId: text("drill_attempt_id"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // pace_wpm | filler_per_min | ...
  value: real("value"),
  low: real("low"),
  high: real("high"),
  unit: text("unit").notNull(),
  confidence: text("confidence").$type<Confidence>().notNull(),
  targetLow: real("target_low"),
  targetHigh: real("target_high"),
  detail: json<Record<string, unknown>>("detail"),
  createdAt: createdAt(),
}, (t) => [index("metrics_session_idx").on(t.sessionId), index("metrics_user_key_idx").on(t.userId, t.key)]);

export const playbackClips = sqliteTable("playback_clips", {
  id: id(),
  sessionId: text("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  questionId: text("question_id"),
  answerId: text("answer_id"),
  rank: integer("rank").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  title: text("title").notNull(),
  questionText: text("question_text").notNull(),
  transcript: text("transcript").notNull(),
  observed: text("observed").notNull(), // what happened (evidence)
  suggestion: text("suggestion").notNull(), // one specific change
  signal: text("signal").notNull(), // which metric triggered selection
  confidence: text("confidence").$type<Confidence>().notNull(),
  source: text("source").notNull(), // llm | heuristic
}, (t) => [index("clips_session_idx").on(t.sessionId)]);

export const mediaObjects = sqliteTable("media_objects", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => interviewSessions.id, { onDelete: "cascade" }),
  drillAttemptId: text("drill_attempt_id"),
  kind: text("kind", { enum: ["session_recording", "drill_recording"] }).notNull(),
  mimeType: text("mime_type").notNull(),
  storageKey: text("storage_key").notNull(),
  bytes: integer("bytes").notNull().default(0),
  segments: integer("segments").notNull().default(0),
  status: text("status", { enum: ["recording", "complete", "deleted"] }).notNull().default("recording"),
  durationMs: integer("duration_ms"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  /**
   * A session recording can come in parts: every time the Room (re)starts recording, say after a
   * reload, it opens a new part, because a fresh MediaRecorder stream can't be appended to the old
   * one. The part key is chosen by that recorder; the offset is when it started on the session clock.
   */
  partKey: text("part_key"),
  startOffsetMs: integer("start_offset_ms").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("media_user_idx").on(t.userId), index("media_session_idx").on(t.sessionId), uniqueIndex("media_session_part_idx").on(t.sessionId, t.partKey)]);

// ─── Practice ────────────────────────────────────────────────────────────────

export const drills = sqliteTable("drills", {
  id: id(), // e.g. "opener_30s"
  title: text("title").notNull(),
  objective: text("objective").notNull(),
  instructions: text("instructions").notNull(),
  prompt: text("prompt").notNull(),
  targetMetric: text("target_metric").notNull(),
  durationSec: integer("duration_sec").notNull(),
  requiresCamera: integer("requires_camera", { mode: "boolean" }).notNull().default(false),
});

export const drillAttempts = sqliteTable("drill_attempts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  drillId: text("drill_id").notNull().references(() => drills.id),
  sourceSessionId: text("source_session_id"),
  promptText: text("prompt_text").notNull(),
  transcript: text("transcript").notNull(),
  durationMs: integer("duration_ms").notNull(),
  result: json<Record<string, unknown>>("result"),
  feedback: text("feedback"),
  baselineValue: real("baseline_value"),
  value: real("value"),
  passed: integer("passed", { mode: "boolean" }),
  createdAt: createdAt(),
}, (t) => [index("drill_attempts_user_idx").on(t.userId)]);

// A personal lesson, planned from the person's own interviews (lib/lessons). One row per skill;
// it is refreshed after each analysed interview. Deleting the session it quotes deletes it.
export const lessons = sqliteTable("lessons", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lessonKey: text("lesson_key").notNull(),
  track: text("track").notNull(), // delivery | responses | presence
  status: text("status", { enum: ["active", "queued", "mastered"] }).notNull(),
  priority: real("priority").notNull().default(0),
  sourceSessionId: text("source_session_id").references(() => interviewSessions.id, { onDelete: "cascade" }),
  metricKey: text("metric_key").notNull(),
  startValue: real("start_value"),
  latestValue: real("latest_value"),
  evidence: json<LessonEvidence>("evidence").notNull(),
  content: json<LessonContent>("content").notNull(),
  practicePasses: integer("practice_passes").notNull().default(0),
  practiceAttempts: integer("practice_attempts").notNull().default(0),
  viewedAt: integer("viewed_at", { mode: "timestamp_ms" }),
  masteredAt: integer("mastered_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (t) => [uniqueIndex("lessons_user_key_idx").on(t.userId, t.lessonKey)]);

// ─── Deliberate practice (lib/training) ─────────────────────────────────────
// A loop trains one competency: an attempt, a retry on the same question, a transfer to a new
// one; a review loop revisits it later. Attempts keep the exact question they answered;
// evaluations keep the rubric version and the criteria as judged, so history stays readable
// when a rubric changes. Everything is owned by a user and goes when they do.

export const trainingLoops = sqliteTable("training_loops", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["practice", "review"] }).notNull(),
  category: text("category").notNull(),
  competencyId: text("competency_id").notNull(),
  rubricVersion: integer("rubric_version").notNull(),
  stage: text("stage", { enum: ["attempt", "retry", "transfer", "done"] }).notNull(),
  targetCriterion: text("target_criterion"),
  scaffold: integer("scaffold").notNull().default(0),
  retries: integer("retries").notNull().default(0),
  insufficientStreak: integer("insufficient_streak").notNull().default(0),
  /** The exercise being answered now (the retry reuses it; the transfer replaces it). */
  question: json<Exercise>("question").notNull(),
  reviewOfLoopId: text("review_of_loop_id"),
  outcome: json<LoopOutcome>("outcome"),
  createdAt: createdAt(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (t) => [index("training_loops_user_idx").on(t.userId)]);

export const trainingAttempts = sqliteTable("training_attempts", {
  id: id(),
  loopId: text("loop_id").notNull().references(() => trainingLoops.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["initial", "retry", "transfer", "review"] }).notNull(),
  questionId: text("question_id").notNull(),
  questionText: text("question_text").notNull(),
  questionSource: text("question_source", { enum: ["curated", "generated"] }).notNull(),
  response: text("response").notNull(),
  inputMode: text("input_mode", { enum: ["voice", "text"] }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  /** Set by the client per submission, so a resent request never makes a second attempt. */
  clientKey: text("client_key").notNull(),
  createdAt: createdAt(),
}, (t) => [index("training_attempts_loop_idx").on(t.loopId), uniqueIndex("training_attempts_key_idx").on(t.userId, t.clientKey)]);

export const trainingEvaluations = sqliteTable("training_evaluations", {
  id: id(),
  attemptId: text("attempt_id").notNull().references(() => trainingAttempts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  competencyId: text("competency_id").notNull(),
  rubricVersion: integer("rubric_version").notNull(),
  evaluator: text("evaluator", { enum: ["model", "pattern"] }).notNull(),
  criteria: json<CriterionJudgment[]>("criteria").notNull(),
  enoughEvidence: integer("enough_evidence", { mode: "boolean" }).notNull(),
  confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull(),
  primary: json<Weakness>("primary_weakness"),
  secondary: json<string[]>("secondary").notNull(),
  limitations: text("limitations"),
  insufficientReason: text("insufficient_reason"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("training_evaluations_attempt_idx").on(t.attemptId)]);

export const trainingReviews = sqliteTable("training_reviews", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  competencyId: text("competency_id").notNull(),
  category: text("category").notNull(),
  sourceLoopId: text("source_loop_id").notNull().references(() => trainingLoops.id, { onDelete: "cascade" }),
  targetCriterion: text("target_criterion"),
  dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
  startedLoopId: text("started_loop_id"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [index("training_reviews_user_due_idx").on(t.userId, t.dueAt)]);

export const ladderLevels = sqliteTable("ladder_levels", {
  level: integer("level").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  personaIds: json<string[]>("persona_ids").notNull(),
  mode: text("mode", { enum: ["single", "panel"] }).notNull(),
  pressure: integer("pressure").notNull(),
  curveballs: integer("curveballs", { mode: "boolean" }).notNull().default(false),
});

export const ladderProgress = sqliteTable("ladder_progress", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  level: integer("level").notNull(),
  qualifyingSessions: integer("qualifying_sessions").notNull().default(0),
  unlockedAt: integer("unlocked_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (t) => [uniqueIndex("ladder_progress_pk").on(t.userId, t.level)]);

export const progressSnapshots = sqliteTable("progress_snapshots", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => interviewSessions.id, { onDelete: "cascade" }),
  metrics: json<Record<string, number | null>>("metrics").notNull(),
  baseline: json<Record<string, number | null>>("baseline").notNull(),
  createdAt: createdAt(),
}, (t) => [index("progress_user_idx").on(t.userId)]);

// ─── Trust, billing, operations ─────────────────────────────────────────────

export const consentRecords = sqliteTable("consent_records", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // camera | microphone | recording | camera_metrics | gaze_metric | posture_metric | ai_disclosure | terms
  version: text("version").notNull(),
  granted: integer("granted", { mode: "boolean" }).notNull(),
  /** SHA-256 of the exact consent wording shown, so the record proves what was agreed to. */
  textHash: text("text_hash"),
  /** Electronic signature (typed full name) — the written release for camera-derived signals. */
  signature: text("signature"),
  source: text("source"), // room_consent | settings | signup
  sessionId: text("session_id"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [index("consent_user_idx").on(t.userId)]);

export const subscriptions = sqliteTable("subscriptions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["free", "sprint", "pro", "executive", "campus"] }).notNull(),
  status: text("status", { enum: ["active", "expired", "canceled"] }).notNull().default("active"),
  periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
  periodEnd: integer("period_end", { mode: "timestamp_ms" }),
  externalRef: text("external_ref"), // payment provider id
  createdAt: createdAt(),
}, (t) => [index("subs_user_idx").on(t.userId)]);

export const usageRecords = sqliteTable("usage_records", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  kind: text("kind").notNull(), // avatar_minutes | sessions | drills
  quantity: real("quantity").notNull(),
  createdAt: createdAt(),
}, (t) => [index("usage_user_idx").on(t.userId)]);

/** Every provider call is a cost line. Aggregated per session for the cost record. */
export const costRecords = sqliteTable("cost_records", {
  id: id(),
  userId: text("user_id"),
  sessionId: text("session_id"),
  provider: text("provider").notNull(),
  category: text("category").notNull(), // llm | stt | tts | avatar | analysis | storage
  operation: text("operation").notNull(),
  units: real("units").notNull(),
  unitName: text("unit_name").notNull(), // input_tokens | output_tokens | seconds | minutes | bytes
  usd: real("usd").notNull(),
  createdAt: createdAt(),
}, (t) => [index("cost_session_idx").on(t.sessionId), index("cost_user_time_idx").on(t.userId, t.createdAt)]);

/** Structured event log for the admin console: decisions, latency, errors, AI outputs. */
export const providerEvents = sqliteTable("provider_events", {
  id: id(),
  sessionId: text("session_id"),
  userId: text("user_id"),
  type: text("type").notNull(), // decision | latency | error | llm_output | fallback | pipeline
  name: text("name").notNull(),
  durationMs: integer("duration_ms"),
  data: json<Record<string, unknown>>("data"),
  createdAt: createdAt(),
}, (t) => [index("events_session_idx").on(t.sessionId), index("events_type_idx").on(t.type)]);

export const processingJobs = sqliteTable("processing_jobs", {
  id: id(),
  sessionId: text("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "running", "complete", "failed"] }).notNull().default("queued"),
  step: text("step"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  stepTimings: json<Record<string, number>>("step_timings"),
  /** While running, the worker holding the job; a lease that passes means the worker died. */
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
  /** New input (a late transcript) arrived while running: run once more when this run ends. */
  rerunRequested: integer("rerun_requested", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
}, (t) => [index("jobs_status_idx").on(t.status), uniqueIndex("jobs_session_idx").on(t.sessionId)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: id(),
  userId: text("user_id"), // kept after account deletion (no FK) for compliance
  action: text("action").notNull(),
  target: text("target"),
  ip: text("ip"),
  data: json<Record<string, unknown>>("data"),
  createdAt: createdAt(),
}, (t) => [index("audit_user_idx").on(t.userId)]);

export type CleanupCounts = { mediaDeleted: number; signalTimelinesDeleted: number; sessionsFinalized: number; accountsDeleted: number; analysisRestarted: number; analysisGaveUp: number };
export type CleanupFailure = { task: string; target?: string; error: string };

/**
 * One row per run of the scheduled cleanup job, so we can see when it last succeeded and what it
 * removed. At most one run holds the lease at a time (partial unique index on `running`).
 */
export const cleanupRuns = sqliteTable("cleanup_runs", {
  id: id(),
  trigger: text("trigger", { enum: ["cron", "timer", "manual"] }).notNull(),
  status: text("status", { enum: ["running", "succeeded", "partial", "failed"] }).notNull().default("running"),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  counts: json<CleanupCounts>("counts"),
  failures: json<CleanupFailure[]>("failures"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("cleanup_runs_one_running_idx").on(t.status).where(sql`${t.status} = 'running'`), index("cleanup_runs_created_idx").on(t.createdAt)]);

/** Fixed-window request counters shared by every server instance (expensive and sign-in routes). */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
}, (t) => [index("rate_limits_window_idx").on(t.windowStart)]);
