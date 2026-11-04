import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { PERSONAS } from "@/lib/interview/personas";
import { LADDER, DRILLS } from "@/lib/practice/catalog";
import { PALETTE } from "@/lib/palette";

/**
 * Catalog content (personas, drills, ladder) lives in code and is upserted into the
 * database on boot so relational rows (interviewers, drill attempts) can reference it.
 */
export async function seedCatalog(db: LibSQLDatabase<typeof schema>) {
  for (const p of Object.values(PERSONAS)) {
    const row = {
      id: p.id, name: p.name, title: p.title, description: p.description,
      warmth: p.warmth, skepticism: p.skepticism, pace: p.pace,
      interruptionRate: p.interruptionRate, silenceTolerance: p.silenceTolerance,
      specificityDemand: p.specificityDemand, expressiveness: p.expressiveness,
      voice: p.voice, accent: PALETTE.accent,
    };
    await db.insert(schema.personas).values(row).onConflictDoUpdate({ target: schema.personas.id, set: row }).run();
  }
  for (const d of DRILLS) {
    const row = {
      id: d.id, title: d.title, objective: d.objective, instructions: d.instructions,
      prompt: d.prompt, targetMetric: d.targetMetric, durationSec: d.durationSec, requiresCamera: d.requiresCamera,
    };
    await db.insert(schema.drills).values(row).onConflictDoUpdate({ target: schema.drills.id, set: row }).run();
  }
  for (const l of LADDER) {
    const row = {
      level: l.level, name: l.name, description: l.description, personaIds: l.personaIds,
      mode: l.mode, pressure: l.pressure, curveballs: l.curveballs,
    };
    await db.insert(schema.ladderLevels).values(row).onConflictDoUpdate({ target: schema.ladderLevels.level, set: row }).run();
  }
}
