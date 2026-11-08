/** The recording part playing at `ms` on the session clock: the last one that started at or before it. */
export function partAt(parts: readonly { startMs: number }[], ms: number): number {
  let index = 0;
  for (let i = 0; i < parts.length; i++) if (parts[i].startMs <= ms) index = i;
  return index;
}
