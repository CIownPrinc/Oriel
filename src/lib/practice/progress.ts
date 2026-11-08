/**
 * Progress is measured against the user's own history, never against other people.
 * Baseline = median of the user's earlier sessions for each metric.
 */

export type MetricMap = Record<string, number | null>;

export const PROGRESS_METRICS: { key: string; label: string; unit: string; better: "lower" | "higher" | "target"; target?: number; format: (v: number) => string }[] = [
  { key: "filler_per_min", label: "Filler", unit: "/min", better: "lower", format: (v) => `${v.toFixed(1)}/min` },
  { key: "recovery_ms", label: "Recovery", unit: "s", better: "lower", format: (v) => `${(v / 1000).toFixed(1)} s` },
  { key: "pace_wpm", label: "Pace", unit: "wpm", better: "target", target: 140, format: (v) => `${Math.round(v)} wpm` },
  { key: "structure_score", label: "Structure", unit: "%", better: "higher", format: (v) => `${Math.round(v)}%` },
  { key: "specificity", label: "Specificity", unit: "%", better: "higher", format: (v) => `${Math.round(v)}%` },
  { key: "hedges_per_min", label: "Hedging", unit: "/min", better: "lower", format: (v) => `${v.toFixed(1)}/min` },
  { key: "camera_engagement", label: "Eye contact (est.)", unit: "%", better: "higher", format: (v) => `${Math.round(v)}%` },
];

export function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Baseline from prior sessions (oldest first). Uses up to the last 5 prior sessions. */
export function computeBaseline(prior: MetricMap[]): MetricMap {
  const recent = prior.slice(-5);
  const out: MetricMap = {};
  for (const m of PROGRESS_METRICS) {
    out[m.key] = medianOf(recent.map((p) => p[m.key]).filter((v): v is number => typeof v === "number"));
  }
  return out;
}

export interface Comparison { key: string; label: string; current: number | null; baseline: number | null; improved: boolean | null; changePct: number | null }

/** Relative tolerance so noise doesn't count as improvement. */
const TOLERANCE = 0.05;

export function compare(current: MetricMap, baseline: MetricMap): Comparison[] {
  return PROGRESS_METRICS.map((m) => {
    const c = current[m.key];
    const b = baseline[m.key];
    if (c === null || c === undefined || b === null || b === undefined) {
      return { key: m.key, label: m.label, current: c ?? null, baseline: b ?? null, improved: null, changePct: null };
    }
    let improved: boolean;
    if (m.better === "lower") improved = c < b * (1 - TOLERANCE) || (b === 0 && c === 0);
    else if (m.better === "higher") improved = c > b * (1 + TOLERANCE);
    else improved = Math.abs(c - m.target!) < Math.abs(b - m.target!) * (1 - TOLERANCE);
    const changePct = b === 0 ? null : ((c - b) / Math.abs(b)) * 100;
    return { key: m.key, label: m.label, current: c, baseline: b, improved, changePct };
  });
}

/** A session is "above baseline" when it improves on most comparable measures. */
export function aboveBaseline(comparisons: Comparison[]): { above: boolean; improved: number; comparable: number } {
  const comparable = comparisons.filter((c) => c.improved !== null);
  const improved = comparable.filter((c) => c.improved).length;
  return { above: comparable.length >= 3 && improved / comparable.length >= 0.5, improved, comparable: comparable.length };
}

/** Recommend the drill that targets the user's weakest measure relative to good ranges. */
export function recommendDrill(latest: MetricMap): { drillId: string; reason: string } {
  const checks: [boolean, string, string][] = [
    [(latest.recovery_ms ?? 0) > 3000, "hard_recovery", "Your time to first word after hard questions was over 3 seconds."],
    [(latest.filler_per_min ?? 0) > 4, "replace_filler", "Filler words were above 4 per minute."],
    [(latest.specificity ?? 100) < 55, "quantify_results", "Many answers lacked a number, name or timeframe."],
    [(latest.structure_score ?? 100) < 60, "star_structure", "Answers often stopped before the result."],
    [(latest.camera_engagement ?? 100) < 45, "hold_the_lens", "Estimated eye contact was low."],
  ];
  const hit = checks.find(([c]) => c);
  return hit ? { drillId: hit[1], reason: hit[2] } : { drillId: "opener_30s", reason: "Sharpen your opener. It sets the tone for everything after." };
}
