// The fold (#117, docs/sidebar-brief-1.md), the shell's arithmetic: what the sidebar's width does under the hand on
// the stage's left edge, where a release lands, and what the device remembers of it. Pure over pixels and speeds, so
// test/fold.ts can walk the edge without a DOM. edge.tsx is the hand; shell.tsx is what a fold and a dock mean.
//
// The sidebar has one default width and a band around it the hand may set. Pulled inward past the band's floor the
// track resists like a rubber band (the hand feels the stop before the fold), and past the close threshold it folds
// shut; pulled outward past the ceiling it gives the same way and springs back on release. While folded, a pull past
// the open threshold docks it again. A release carries the hand's speed: a flick toward the edge folds, a flick out of
// the fold docks. Every fold forgets the band: the next open is at the default, wherever the hand had it.
import { projectDistance, rubberBand } from "@ui-sdk/core/gesture"

/** Pixels: the default and the band the hand may set; the fold and unfold thresholds under the pointer. */
export const SIDE = { default: 248, min: 200, max: 320, close: 96, open: 136 } as const
const DETENT = 28 // the most the track gives under the floor: the band's resistance approaches it and never reaches it
const GIVE = 24 // the same past the ceiling
const STEP = 16 // one arrow key
const GLIDE = 0.994 // how a released speed decays per millisecond (the scroll view's rate): 1 px/ms carries ~166px

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
  if (x < SIDE.min) return { kind: "width", shown: SIDE.min - rubberBand(SIDE.min - x, DETENT), keep: SIDE.min }
  if (x > SIDE.max) return { kind: "width", shown: SIDE.max + rubberBand(x - SIDE.max, GIVE), keep: SIDE.max }
  return { kind: "width", shown: x, keep: Math.round(x) }
}

export type Release =
  | { kind: "fold" } // the speed carries a docked sidebar past the close threshold
  | { kind: "dock"; width: number } // the speed carries a folded one past the unfold threshold
  | { kind: "rest" } // it stays as the drag left it

/** Where a release at `x` lands, the pointer moving at `velocity` px/ms (negative toward the screen's edge). */
export const release = (x: number, velocity: number, folded: boolean): Release => {
  const to = x + projectDistance(velocity, GLIDE)
  if (folded) return velocity > 0 && to >= SIDE.open ? { kind: "dock", width: SIDE.default } : { kind: "rest" }
  return velocity < 0 && to < SIDE.close ? { kind: "fold" } : { kind: "rest" }
}

/** The width an arrow key, Home or End moves a docked sidebar to; any other key leaves it. */
export const step = (width: number, key: string): number | undefined => {
  const to = { ArrowLeft: width - STEP, ArrowRight: width + STEP, Home: SIDE.min, End: SIDE.max }[key]
  return to === undefined ? undefined : clamp(to, SIDE.min, SIDE.max)
}

/** A remembered width as the device hands it back: a number inside the band, else the default. */
export const remembered = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) && n >= SIDE.min && n <= SIDE.max ? Math.round(n) : SIDE.default
}
