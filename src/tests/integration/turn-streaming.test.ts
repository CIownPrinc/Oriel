import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oriel-stream-"));

import { getDb, schema } from "@/db/client";
import { newId } from "@/lib/id";
import { setProvidersForTesting } from "@/lib/ai/providers/registry";
import type { LanguageModelProvider, TextToSpeechProvider } from "@/lib/ai/providers/types";
import { createInterview, runOpening, runTurn, type RoomEvent } from "@/server/interview/service";

/*
 * FIX-07: the interviewer starts speaking the first sentence while the model is still writing.
 * The fake model yields one sentence, then waits on a gate the test controls.
 */

type Gate = { open: () => void; wait: Promise<void> };
const gate = (): Gate => {
  let open = () => {};
  const wait = new Promise<void>((r) => { open = r; });
  return { open, wait };
};

const llmState = { gate: gate(), calls: 0, closed: 0, failAfterFirst: false };
const gatedLlm: LanguageModelProvider = {
  id: "gated-llm", isMock: false,
  async generateText() { return { text: "What changed as a result?", usage: { model: "fake", inputTokens: 1, outputTokens: 1 }, latencyMs: 1 }; },
  async *streamText() {
    llmState.calls++;
    try {
      yield "What did you change first? ";
      await llmState.gate.wait;
      if (llmState.failAfterFirst) throw new Error("model dropped the stream");
      yield "And how did you measure it?";
      return { usage: { model: "fake", inputTokens: 1, outputTokens: 1 }, firstTokenMs: 5 };
    } finally {
      llmState.closed++;
    }
  },
  async generateJson() { throw new Error("not used"); },
};
const spoken: string[] = [];
const fakeTts: TextToSpeechProvider = {
  id: "fake-tts", isMock: false,
  async *streamSpeech(req) {
    spoken.push(req.text);
    yield { pcm: Buffer.alloc(320), sampleRate: 24000 };
    return { usage: null };
  },
};

async function drain(gen: AsyncGenerator<RoomEvent>) {
  const out: RoomEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** Read events until `until` matches, failing if that takes longer than `ms` (i.e. it was blocked). */
async function readUntil(gen: AsyncGenerator<RoomEvent>, until: (e: RoomEvent) => boolean, ms = 3000) {
  const seen: RoomEvent[] = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = await Promise.race([gen.next(), new Promise<"timeout">((res) => setTimeout(() => res("timeout"), deadline - Date.now()))]);
    if (r === "timeout" || r.done) break;
    seen.push(r.value);
    if (until(r.value)) return seen;
  }
  throw new Error(`blocked: saw ${seen.map((e) => e.type).join(", ") || "nothing"}`);
}

let userId: string;
const answer = (i: number) => ({
  answerText: ["We did many things and it went fine overall I suppose.", "I helped the team a bit and people liked the result.", "Things improved and the project went well for us."][i % 3],
  startMs: 1000 + i * 20000, endMs: 10000 + i * 20000, firstWordLatencyMs: 800, interrupted: false, inputMode: "voice" as const, prevQuestion: null,
});

async function freshSession() {
  const { sessionId } = await createInterview(userId, { role: "Product Manager", domain: "product", level: "hiring_manager", type: "behavioral", pressure: 4, persona: "skeptic", mode: "single", panelSize: 3, ladderLevel: null, targetMinutes: 15, cameraMetrics: false });
  llmState.gate.open();
  await drain(runOpening(sessionId, userId));
  return sessionId;
}

/** Start turns until one asks the model to write (some turns use fixed wording). */
async function writtenTurn(sessionId: string) {
  for (let i = 0; i < 6; i++) {
    llmState.gate = gate();
    const before = llmState.calls;
    const gen = runTurn(sessionId, userId, answer(i));
    const seen: RoomEvent[] = [];
    for (;;) {
      const r = await Promise.race([gen.next(), new Promise<"slow">((res) => setTimeout(() => res("slow"), 3000))]);
      if (r === "slow") throw new Error(`blocked after ${seen.map((e) => e.type).join(", ")}`);
      if (r.done) break;
      seen.push(r.value);
      if (llmState.calls > before) return { gen, seen };
    }
    llmState.gate.open();
  }
  throw new Error("no turn asked the model to write");
}

beforeAll(async () => {
  setProvidersForTesting({ llm: gatedLlm, tts: fakeTts });
  const db = getDb();
  userId = newId("usr");
  await db.insert(schema.users).values({ id: userId, email: `${userId}@oriel.test`, passwordHash: "x", onboardedAt: new Date() }).run();
  await db.insert(schema.profiles).values({ userId, name: "Jordan Lee", targetRole: "Product Manager", domain: "product" }).run();
  await db.insert(schema.subscriptions).values({ id: newId("sub"), userId, plan: "pro", periodStart: new Date() }).run();
  await db.insert(schema.ladderProgress).values({ userId, level: 1, unlockedAt: new Date() }).run();
});

describe("FIX-07 · speech starts before the model finishes", () => {
  it("sends the first sentence's text and audio while the model is still writing", async () => {
    const sessionId = await freshSession();
    const { gen, seen } = await writtenTurn(sessionId);
    const events = seen.some((e) => e.type === "audio") ? seen : [...seen, ...(await readUntil(gen, (e) => e.type === "audio"))];
    expect(events.some((e) => e.type === "text" && e.text.includes("What did you change first?"))).toBe(true);
    expect(spoken.at(-1)).toContain("What did you change first?");
    llmState.gate.open();
    const rest = await drain(gen);
    const done = rest.find((e) => e.type === "done");
    expect(done).toBeDefined();
    const finalText = [...events, ...rest].filter((e) => e.type === "text").at(-1) as Extract<RoomEvent, { type: "text" }>;
    expect(finalText.text).toContain("And how did you measure it?");
  });

  it("finishes the turn when the model fails after the first sentence", async () => {
    const sessionId = await freshSession();
    llmState.failAfterFirst = true;
    try {
      const { gen, seen } = await writtenTurn(sessionId);
      if (!seen.some((e) => e.type === "audio")) await readUntil(gen, (e) => e.type === "audio");
      llmState.gate.open();
      const rest = await drain(gen);
      expect(rest.some((e) => e.type === "done")).toBe(true);
    } finally {
      llmState.failAfterFirst = false;
    }
  });

  it("stops reading the model when the client disconnects mid-turn", async () => {
    const sessionId = await freshSession();
    const { gen, seen } = await writtenTurn(sessionId);
    if (!seen.some((e) => e.type === "audio")) await readUntil(gen, (e) => e.type === "audio");
    const closedBefore = llmState.closed;
    await gen.return(undefined);
    llmState.gate.open();
    await new Promise((r) => setTimeout(r, 50));
    expect(llmState.closed).toBe(closedBefore + 1);
    // The session isn't left locked: the next turn runs.
    llmState.gate.open();
    const next = await drain(runTurn(sessionId, userId, answer(5)));
    expect(next.some((e) => e.type === "done" || e.type === "error")).toBe(true);
  });
});
