// The player's block shrink-wrapped (docs/pretext-reading.md §4's one use so far): a line that fills the column and
// drops two characters onto a second row leaves the bubble wide and mostly empty at its right. pretext measures the
// text off the DOM (`prepare` once per bubble, `measureLineStats` per probe, pure arithmetic after the first), so the
// tightest width that keeps the line count the column gave can be found by bisection and set on the block, and the
// browser wraps the same text into the same number of rows, each about as full as the next. Nothing in the block's
// DOM changes: the width is one inline style on `.spoke`, cleared when the block leaves. The column's width is read
// once per resize (one ResizeObserver on the reader's `main`), every block refits from it; a font that lands late
// refits too. `tight` is the arithmetic, over any measurer, so test/shrinkwrap.ts can walk it without a canvas.
import { measureLineStats, prepare, type PreparedText } from "@chenglou/pretext"

/** What a width does to the text: how many lines, and how wide the widest. */
export interface Stats {
  lineCount: number
  maxLineWidth: number
}

/** The tightest whole-pixel width at which the text keeps the line count it has at `max`, as the widest line of that
 *  wrap plus one pixel of slack (the canvas and the layout engine can differ by a fraction, and the slack keeps the
 *  browser from wrapping a line the arithmetic kept whole), never more than `max`. One line is its own width. */
export const tight = (measure: (width: number) => Stats, max: number): number => {
  const cap = Math.floor(max)
  if (cap <= 0) return 0
  const at = measure(cap)
  if (at.lineCount <= 1) return Math.min(cap, Math.ceil(at.maxLineWidth) + 1)
  // narrower is never fewer lines: the smallest width still on `n` lines is where the count first stops rising
  let lo = 1
  let hi = cap
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (measure(mid).lineCount > at.lineCount) lo = mid + 1
    else hi = mid
  }
  return Math.min(cap, Math.ceil(measure(hi).maxLineWidth) + 1)
}

// ── the blocks on the page ──
const blocks = new Set<HTMLElement>()
const texts = new WeakMap<HTMLElement, { font: string; prepared: PreparedText }>()
let column: HTMLElement | null = null
let watching: ResizeObserver | undefined
let available = 0 // the column's content width, as last read

/** The canvas font of an element, from the four parts the shorthand needs (the computed shorthand is empty in some
 *  browsers); the same stack the CSS paints with, so the measure is the browser's own. */
const fontOf = (s: CSSStyleDeclaration) => `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
const pad = (s: CSSStyleDeclaration) => parseFloat(s.paddingLeft) + parseFloat(s.paddingRight)
const fit = (block: HTMLElement) => {
  if (available <= 0) return
  let w = 0
  for (const bubble of block.querySelectorAll<HTMLElement>(".said")) {
    const s = getComputedStyle(bubble)
    const inner = available - pad(s)
    if (inner <= 0) continue
    const font = fontOf(s)
    let t = texts.get(bubble)
    if (!t || t.font !== font) {
      t = { font, prepared: prepare(bubble.textContent ?? "", font, { whiteSpace: "pre-wrap" }) }
      texts.set(bubble, t)
    }
    const { prepared } = t
    w = Math.max(w, tight((width) => measureLineStats(prepared, width), inner) + pad(s))
  }
  block.style.width = w > 0 ? `${Math.min(available, w)}px` : ""
}
const refit = () => {
  if (!column) return
  const s = getComputedStyle(column)
  available = column.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
  for (const b of blocks) fit(b)
}

/** A player's block (`.spoke`, holding its `.said` bubbles) once it is in the document: fitted now and on every
 *  change of the column's width; returns what lets it go. */
export const shrinkwrap = (block: HTMLElement): (() => void) => {
  blocks.add(block)
  if (!watching) {
    column = block.closest("main")
    if (column) {
      watching = new ResizeObserver(refit)
      watching.observe(column) // fires once on observe: the first fit of every block registered by then
      void document.fonts?.ready.then(refit)
    }
  } else fit(block)
  return () => {
    blocks.delete(block)
    block.style.width = ""
  }
}
