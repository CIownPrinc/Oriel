import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb, schema } from "@/db/client";

/**
 * Every table in the database, and what happens to it for one person's export and deletion.
 * The privacy-inventory test fails when a table is added to the schema without an entry here,
 * so nothing new can be stored without deciding whether it's exported.
 *
 *  - user:      rows carry the person's user_id
 *  - session:   rows belong to one of their interview sessions
 *  - interview: rows belong to one of their interviews
 *  - catalog:   shared product data, not about anyone
 *  - excluded:  about the person, but deliberately left out of the export (reason given)
 */
export type Scope = "user" | "session" | "interview" | "catalog" | "excluded";
export type InventoryEntry = {
  table: SQLiteTable;
  scope: Scope;
  /** Columns left out of the export (secrets). */
  omit?: string[];
  /** What happens on account deletion. */
  onAccountDelete: "cascade" | "explicit" | "kept-without-content" | "not-personal";
  note: string;
};

export const DATA_INVENTORY: Record<string, InventoryEntry> = {
  users: { table: schema.users, scope: "user", omit: ["passwordHash"], onAccountDelete: "explicit", note: "Your account (the password hash is never exported)." },
  authSessions: { table: schema.authSessions, scope: "user", omit: ["id"], onAccountDelete: "cascade", note: "Devices signed in (session token hashes are not exported)." },
  passwordResets: { table: schema.passwordResets, scope: "user", omit: ["id"], onAccountDelete: "cascade", note: "Password reset requests (the link codes are not exported)." },
  profiles: { table: schema.profiles, scope: "user", onAccountDelete: "cascade", note: "Profile and privacy settings." },
  resumes: { table: schema.resumes, scope: "user", onAccountDelete: "cascade", note: "Your current resume. Older versions are deleted when you replace it." },
  jobDescriptions: { table: schema.jobDescriptions, scope: "user", onAccountDelete: "cascade", note: "Your current job description. Older versions are deleted when you replace it." },
  personas: { table: schema.personas, scope: "catalog", onAccountDelete: "not-personal", note: "The built-in interviewer characters." },
  interviews: { table: schema.interviews, scope: "user", onAccountDelete: "cascade", note: "Interview setups." },
  panels: { table: schema.panels, scope: "interview", onAccountDelete: "cascade", note: "Panel interview settings." },
  interviewSessions: { table: schema.interviewSessions, scope: "user", onAccountDelete: "cascade", note: "Sessions, their summaries and retention dates." },
  interviewers: { table: schema.interviewers, scope: "session", onAccountDelete: "cascade", note: "Who interviewed you in each session." },
  questions: { table: schema.questions, scope: "session", onAccountDelete: "cascade", note: "Questions you were asked." },
  answers: { table: schema.answers, scope: "session", onAccountDelete: "cascade", note: "Your answers and their analysis." },
  claims: { table: schema.claims, scope: "session", onAccountDelete: "cascade", note: "Claims quoted from your answers, which the interviewer could follow up on." },
  transcriptSegments: { table: schema.transcriptSegments, scope: "session", onAccountDelete: "cascade", note: "Transcripts." },
  signalTimelines: { table: schema.signalTimelines, scope: "session", onAccountDelete: "cascade", note: "Derived audio and camera numbers over time (no images or landmarks)." },
  metrics: { table: schema.metrics, scope: "user", onAccountDelete: "cascade", note: "Feedback measurements." },
  playbackClips: { table: schema.playbackClips, scope: "session", onAccountDelete: "cascade", note: "Key moments and coaching." },
  mediaObjects: { table: schema.mediaObjects, scope: "user", omit: ["storageKey"], onAccountDelete: "explicit", note: "Recording records. The encrypted video itself plays in Playback and isn't in this file." },
  drills: { table: schema.drills, scope: "catalog", onAccountDelete: "not-personal", note: "The built-in drills." },
  drillAttempts: { table: schema.drillAttempts, scope: "user", onAccountDelete: "cascade", note: "Drill results." },
  lessons: { table: schema.lessons, scope: "user", onAccountDelete: "cascade", note: "Your lesson plan." },
  trainingLoops: { table: schema.trainingLoops, scope: "user", onAccountDelete: "cascade", note: "Skill practice sessions." },
  trainingAttempts: { table: schema.trainingAttempts, scope: "user", onAccountDelete: "cascade", note: "Your skill practice answers." },
  trainingEvaluations: { table: schema.trainingEvaluations, scope: "user", onAccountDelete: "cascade", note: "Feedback on skill practice answers." },
  trainingReviews: { table: schema.trainingReviews, scope: "user", onAccountDelete: "cascade", note: "Scheduled skill reviews." },
  ladderLevels: { table: schema.ladderLevels, scope: "catalog", onAccountDelete: "not-personal", note: "The Ladder's levels." },
  ladderProgress: { table: schema.ladderProgress, scope: "user", onAccountDelete: "cascade", note: "Your Ladder progress." },
  progressSnapshots: { table: schema.progressSnapshots, scope: "user", onAccountDelete: "cascade", note: "Progress over time." },
  consentRecords: { table: schema.consentRecords, scope: "user", onAccountDelete: "kept-without-content", note: "Every consent you gave or withdrew. On account deletion a copy without your name, signature or device is kept in the audit log." },
  subscriptions: { table: schema.subscriptions, scope: "user", onAccountDelete: "cascade", note: "Your plan." },
  usageRecords: { table: schema.usageRecords, scope: "user", onAccountDelete: "cascade", note: "Minutes and sessions used." },
  costRecords: { table: schema.costRecords, scope: "user", onAccountDelete: "explicit", note: "What your sessions cost us in AI usage." },
  providerEvents: { table: schema.providerEvents, scope: "user", onAccountDelete: "explicit", note: "Timing and error events from AI providers for your sessions." },
  processingJobs: { table: schema.processingJobs, scope: "session", onAccountDelete: "cascade", note: "Analysis job status." },
  auditLogs: { table: schema.auditLogs, scope: "excluded", onAccountDelete: "kept-without-content", note: "Security log of actions (sign-in, settings, deletion). Kept for security without interview content; available on request." },
  cleanupRuns: { table: schema.cleanupRuns, scope: "catalog", onAccountDelete: "not-personal", note: "System record of retention cleanup runs." },
  rateLimits: { table: schema.rateLimits, scope: "excluded", onAccountDelete: "kept-without-content", note: "Request counters (keyed by account or network) that limit abuse. Deleted a day after their window ends." },
};

type Row = Record<string, unknown>;
const column = (table: SQLiteTable, key: string) => (table as unknown as Record<string, SQLiteColumn | undefined>)[key];

/** Everything stored about one person, grouped by table, with secrets omitted. */
export async function exportUserData(userId: string) {
  const db = getDb();
  const sessionIds = (await db.select({ id: schema.interviewSessions.id }).from(schema.interviewSessions).where(eq(schema.interviewSessions.userId, userId)).all()).map((s) => s.id);
  const interviewIds = (await db.select({ id: schema.interviews.id }).from(schema.interviews).where(eq(schema.interviews.userId, userId)).all()).map((i) => i.id);

  const tables: Record<string, Row[]> = {};
  for (const [name, entry] of Object.entries(DATA_INVENTORY)) {
    const rows = await rowsFor(entry, userId, sessionIds, interviewIds);
    if (rows === null) continue;
    tables[name] = rows.map((r) => withoutColumns(r, entry.omit ?? []));
  }
  return {
    exportedAt: new Date().toISOString(),
    about: "Everything Oriel stores about you. Each key is one kind of data; `inventory` says what it is and what happens to it if you delete your account.",
    inventory: Object.fromEntries(Object.entries(DATA_INVENTORY).map(([name, e]) => [name, { included: e.scope !== "catalog" && e.scope !== "excluded", note: e.note, onAccountDelete: e.onAccountDelete }])),
    data: tables,
  };
}

async function rowsFor(entry: InventoryEntry, userId: string, sessionIds: string[], interviewIds: string[]): Promise<Row[] | null> {
  const db = getDb();
  const { table, scope } = entry;
  if (scope === "catalog" || scope === "excluded") return null;
  if (table === schema.users) return db.select().from(schema.users).where(eq(schema.users.id, userId)).all();
  const key = scope === "user" ? "userId" : scope === "session" ? "sessionId" : "interviewId";
  const col = column(table, key);
  if (!col) throw new Error(`data inventory: ${key} missing on a ${scope}-scoped table`);
  const ids = scope === "user" ? [userId] : scope === "session" ? sessionIds : interviewIds;
  if (!ids.length) return [];
  return db.select().from(table).where(inArray(col, ids)).all() as Promise<Row[]>;
}

function withoutColumns(row: Row, omit: string[]): Row {
  if (!omit.length) return row;
  return Object.fromEntries(Object.entries(row).filter(([k]) => !omit.includes(k)));
}
