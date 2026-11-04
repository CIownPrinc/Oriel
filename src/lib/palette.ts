/**
 * The palette for places CSS can't reach (canvas drawing, the browser theme colour). Mirrors the
 * :root tokens in globals.css; change both together.
 */
export const PALETTE = {
  bg: "#141412",
  accent: "#c8ff3d",
  /** The accent as "r g b", for alpha in inline styles. */
  accentRgb: "200 255 61",
} as const;
