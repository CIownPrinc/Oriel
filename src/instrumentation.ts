/**
 * Retention cleanup on a long-running server (`next start`, `next dev`).
 *
 * On Vercel, instances stop between requests, so a timer here can't promise anything; the
 * scheduled job in vercel.json calls /api/cron/cleanup instead. Both paths run the same
 * leased job, so overlapping runs are safe.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  const { runScheduledCleanup } = await import("./server/privacy/retention");
  const run = async () => {
    try {
      const result = await runScheduledCleanup("timer");
      if (result.status === "partial" || result.status === "failed") console.error("[cleanup]", JSON.stringify(result));
    } catch (err) {
      console.error("[cleanup]", err);
    }
  };
  setTimeout(run, 5_000);
  setInterval(run, 10 * 60_000).unref?.();
}
