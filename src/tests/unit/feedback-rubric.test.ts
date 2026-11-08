import { describe, expect, it } from "vitest";
import { countFillers, countHedges } from "@/lib/analysis/text";
import { computeRead, isStoryQuestion, interviewTypeOf, type AnswerInputRow } from "@/lib/analysis/read";

/*
 * FIX-11: feedback judges what an answer is for. Words count as fillers or hedges only in
 * the uses where they are, and story structure is applied only to story questions.
 */

const row = (id: string, text: string, questionText: string, kind = "primary"): AnswerInputRow => ({
  id, questionId: `q${id}`, questionText, questionKind: kind, questionDifficulty: 2, questionEndMs: null,
  text, startMs: 0, endMs: 60000, firstWordLatencyMs: null, interrupted: false, inputMode: "text",
});
const metric = (rows: AnswerInputRow[], key: string, type?: Parameters<typeof interviewTypeOf>[0]) =>
  computeRead(rows, [], [], null, { cameraMetrics: false, gaze: false, posture: false, interviewType: type ? interviewTypeOf(type) : undefined }).metrics.find((m) => m.key === key)!;

describe("filler-like words in context", () => {
  it("doesn't count 'actually' or 'literally' when they carry meaning", () => {
    expect(countFillers("We checked what actually happened in the logs.").total).toBe(0);
    expect(countFillers("The page literally didn't render for Safari users.").total).toBe(0);
  });

  it("still counts them as fillers when used as filler", () => {
    expect(countFillers("Actually, like, we tried a few things.").byType.actually).toBe(1);
    expect(countFillers("So, actually, um, it went fine.").byType.actually).toBe(1);
    expect(countFillers("It was basically a rewrite.").byType.basically).toBe(1);
    expect(countFillers("Um, uh, you know, it worked.").total).toBe(3);
  });

  it("counts softening 'just', not 'just' meaning only or exactly", () => {
    expect(countHedges("It took just two weeks and shipped just in time.").byType.just ?? 0).toBe(0);
    expect(countHedges("I just helped a bit with the launch.").byType.just).toBe(1);
    expect(countHedges("We just kind of tried it.").byType.just).toBe(1);
  });

  it("reports hedging at medium confidence, since it's an interpretation", () => {
    const m = metric([row("1", "I think we maybe shipped it.", "Tell me about a time you shipped something.")], "hedges_per_min");
    expect(m.confidence).toBe("medium");
  });
});

describe("structure follows the question", () => {
  const technical = row("1",
    "I would put a cache in front of the database keyed by user and region. Reads go to the cache first, writes go to the database and invalidate the key. For consistency I'd accept a few seconds of staleness, and I'd add a queue so spikes don't hit the database directly. The trade-off is memory cost against latency.",
    "How would you design a read-heavy profile service?");

  it("doesn't mark a technical explanation down for having no story", () => {
    const m = metric([technical], "structure_score", "technical");
    expect(m.value).toBeNull();
    expect(m.note).toMatch(/doesn't apply/);
  });

  it("judges a story question by story structure, in any interview type", () => {
    const story = row("2",
      "In 2024 our activation was flat at 31 percent, so I led a relaunch of onboarding. I ran twelve customer interviews, proposed cutting two steps, and convinced engineering to ship it in six weeks. As a result activation rose to 44 percent, which meant sales stopped discounting.",
      "Tell me about a time you improved a key metric.");
    const m = metric([technical, story], "structure_score", "technical");
    expect(m.value).not.toBeNull();
    expect(m.note).toMatch(/1 story answer/);
  });

  it("knows which questions ask for a story", () => {
    expect(isStoryQuestion({ questionText: "Tell me about a time you disagreed with your manager.", questionKind: "primary" }, "case")).toBe(true);
    expect(isStoryQuestion({ questionText: "Walk me through your resume.", questionKind: "intro" }, "behavioral")).toBe(false);
    expect(isStoryQuestion({ questionText: "Why this role?", questionKind: "closing" }, "behavioral")).toBe(false);
    expect(isStoryQuestion({ questionText: "Estimate the market for electric bikes.", questionKind: "primary" }, "case")).toBe(false);
    expect(isStoryQuestion({ questionText: "How did you handle the pushback?", questionKind: "follow_up" }, "behavioral")).toBe(true);
  });

  it("treats an unknown stored type as mixed", () => {
    expect(interviewTypeOf("something-else")).toBe("mixed");
    expect(interviewTypeOf("technical")).toBe("technical");
  });
});
