/** Minimal SVG trend line with a dashed baseline. */
export function Sparkline({ values, baseline, better, className }: { values: number[]; baseline: number | null; better: "lower" | "higher" | "target"; className?: string }) {
  const w = 200, h = 56, pad = 4;
  const all = baseline !== null ? [...values, baseline] : values;
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => (values.length === 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2));
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.at(-1)!;
  const good = baseline === null ? null : better === "lower" ? last < baseline : better === "higher" ? last > baseline : null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" role="img" aria-label={`Trend over ${values.length} sessions`}>
      {baseline !== null && <line x1={0} x2={w} y1={y(baseline)} y2={y(baseline)} stroke="currentColor" className="text-fg-subtle/40" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke="currentColor" className={good ? "text-success" : "text-accent"} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 3 : 1.6} className={good ? "fill-success" : "fill-accent"} />)}
    </svg>
  );
}
