"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import type { CodeResult, CodeSpec, CodeSubmission } from "@/lib/training/code";
import { runTests } from "./runner";

/* Code is the one place Oriel uses a monospaced face: the system's, so nothing extra loads. */
const MONO = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" } as const;

/**
 * A coding answer: the function, a short explanation, a way to run the examples, and a submit
 * that runs every test (edge cases included) in the browser before anything is sent.
 */
export function CodeAnswer({ spec, busy, onSubmit }: { spec: CodeSpec; busy: boolean; onSubmit: (s: CodeSubmission) => void }) {
  const [source, setSource] = useState(spec.starter);
  const [explanation, setExplanation] = useState("");
  const [examples, setExamples] = useState<CodeResult[] | null>(null);
  const [running, setRunning] = useState(false);
  /** After Escape, the next Tab leaves the editor (so it is never a keyboard trap). */
  const released = useRef(false);

  async function runExamples() {
    setRunning(true);
    setExamples(await runTests(spec, source, "examples"));
    setRunning(false);
  }

  async function submit() {
    setRunning(true);
    const results = await runTests(spec, source, "all");
    setRunning(false);
    onSubmit({ source, explanation, results, ranIn: "browser" });
  }

  const tests = spec.tests.filter((t) => !t.edge);
  return (
    <form className="mt-8" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label htmlFor="code" className="text-ui font-medium text-fg">Your code <span className="font-normal text-fg-subtle">JavaScript</span></label>
      <textarea id="code" value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        onKeyDown={(e) => {
          // Tab indents instead of leaving the editor; Escape, then Tab, leaves it.
          if (e.key === "Escape") { released.current = true; return; }
          if (e.key === "Tab" && released.current) { released.current = false; return; }
          released.current = false;
          if (e.key === "Tab" && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd;
            setSource(source.slice(0, a) + "  " + source.slice(b));
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
          }
        }}
        style={MONO} className="mt-2 min-h-56 w-full resize-y rounded-control border border-control bg-surface px-4 py-3.5 text-[0.9375rem] leading-relaxed text-fg transition-colors duration-[var(--dur-press)] hover:border-fg-subtle" />
      <p className="mt-2 text-meta text-fg-subtle">Tab indents. Press Escape, then Tab, to move on.</p>

      <div className="mt-4">
        <p className="text-ui text-fg-muted">Examples</p>
        <ul className="mt-2 space-y-1.5 text-ui">
          {tests.map((t, i) => {
            const r = examples?.[i];
            return (
              <li key={t.name} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
                <span aria-hidden className={cn(r ? (r.pass ? "text-success" : "text-danger") : "text-fg-subtle")}>{r ? (r.pass ? "✓" : "×") : "·"}</span>
                <span style={MONO} className="break-words text-[0.875rem] text-fg-muted">
                  {spec.fn}({t.args.map((a) => JSON.stringify(a)).join(", ")}) → {JSON.stringify(t.expected)}
                  {r && !r.pass && <span className="block text-danger">got {r.got}</span>}
                  {r && <span className="sr-only">{r.pass ? "passes" : "fails"}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-meta text-fg-subtle">More cases, including edge cases, run when you submit.</p>
      </div>

      <label htmlFor="explain" className="mt-6 block text-ui font-medium text-fg">Your approach</label>
      <textarea id="explain" value={explanation} onChange={(e) => setExplanation(e.target.value)} disabled={busy}
        placeholder="How it works, and what it costs, as you'd say it to the interviewer."
        className="mt-2 min-h-24 w-full resize-y rounded-control border border-control bg-surface px-4 py-3 text-body leading-relaxed text-fg placeholder:text-fg-subtle transition-colors duration-[var(--dur-press)] hover:border-fg-subtle" />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="lg" onClick={runExamples} loading={running && !busy} disabled={busy}>Run examples</Button>
        <Button type="submit" size="lg" loading={busy} disabled={busy || running || !source.trim()}>Submit</Button>
      </div>
      <p className="mt-3 text-meta text-fg-subtle">Your code runs only in this browser, in a sandbox with a two-second limit. Whether it works comes from the tests, never from the AI.</p>
    </form>
  );
}
