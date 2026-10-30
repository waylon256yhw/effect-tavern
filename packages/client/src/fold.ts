// The fold (#117, docs/sidebar-brief-1.md), the shell's arithmetic: what the sidebar's width does under the hand on
// the stage's left edge, and what the device remembers of it. Pure over pixels, so test/fold.ts can walk the edge
// without a DOM.
//
// The sidebar has one default width and a band around it the hand may set. Pulled inward past the band's floor the
// track compresses with friction (a detent: the hand feels the stop before the fold), and past the close threshold it
// folds shut; pulled outward past the ceiling it gives a little and springs back. While folded, a pull past the open
// threshold docks it again. Every fold forgets the band: the next open is at the default, wherever the hand had it.

/** Pixels: the default and the band the hand may set; the fold and unfold thresholds under the pointer. */
export const SIDE = { default: 260, min: 200, max: 320, close: 96, open: 136 } as const
const DETENT = 0.17 // how far the track follows the hand under the floor: a fifth of the pull
const GIVE = 0.12 // the spring past the ceiling
const GIVE_MAX = 14 // the most the track passes the ceiling, in pixels

export type Drag =
  | { kind: "none" } // folded, and the pull has not reached the unfold threshold
  | { kind: "close" } // pulled past the close threshold: fold, and forget the width
  | { kind: "open"; width: number } // folded and pulled past the unfold threshold: dock at this width
  | { kind: "width"; shown: number; keep: number } // the width the track shows now, and the one to remember on release

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** What the pointer at `x` (from the canvas's left edge) does to a sidebar that is docked or folded. */
export const drag = (x: number, folded: boolean): Drag => {
  if (folded)
    return x >= SIDE.open ? { kind: "open", width: Math.round(clamp(x, SIDE.default, SIDE.max)) } : { kind: "none" }
  if (x < SIDE.close) return { kind: "close" }
  if (x < SIDE.min) return { kind: "width", shown: SIDE.min - (SIDE.min - x) * DETENT, keep: SIDE.min }
  if (x > SIDE.max)
    return { kind: "width", shown: SIDE.max + Math.min(GIVE_MAX, (x - SIDE.max) * GIVE), keep: SIDE.max }
  return { kind: "width", shown: x, keep: Math.round(x) }
}

/** A remembered width as the device hands it back: a number inside the band, else the default. */
export const remembered = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) && n >= SIDE.min && n <= SIDE.max ? Math.round(n) : SIDE.default
}

/** The sidebar's layer on arriving at a story: the workspace of its card; with no story at all, the shelf. */
export const layerOf = (current: number | null | undefined): "shelf" | "workspace" =>
  current == null ? "shelf" : "workspace"
