// The stage's left edge as a control (#181): a separator the hand drags, the keyboard steps and an agent can set. It
// only reads the hand: fold.ts says what a position and a release mean, and the shell (the callbacks) owns what a
// fold, a dock and a width are. A press without a move folds; a pull follows fold.ts's band, folds or docks past its
// thresholds, and on release the hand's speed either carries it into a fold or a dock, or the track springs back from
// where the band let it go. Escape during a pull puts the track back.
import { bindDrag, definePrimitive, dragThreshold } from "@ui-sdk/core"
import { createVelocityTracker, solveSpring } from "@ui-sdk/core/gesture"
import { createParts } from "@ui-sdk/solid/primitive"
import { drag, release, SIDE, step } from "./fold.ts"

type EdgeOptions = {
  width: number
  folded: boolean
  /** The width the track shows while the hand or the spring leads; null when it is the remembered width again. */
  onTrack?: (shown: number | null) => void
  /** A width to remember (a release inside the band, a key, an agent). */
  onWidth?: (width: number) => void
  onFold?: () => void
  onDock?: (width: number) => void
}

const edge = definePrimitive({
  name: "edge",
  options: {
    width: "number",
    folded: "boolean",
    onTrack: "callback",
    onWidth: "callback",
    onFold: "callback",
    onDock: "callback",
  },
  state: (options: EdgeOptions) => ({ width: options.width, folded: options.folded }),
  sync: (options: EdgeOptions) => ({ width: options.width, folded: options.folded }),
  api: (context) => {
    let stop: (() => void) | undefined
    let frame = 0
    context.onDestroy(() => {
      stop?.()
      cancelAnimationFrame(frame)
    })
    /** The track from where the band let it go to the width it rests at, carrying the hand's speed. */
    const settle = (from: number, to: number, velocity: number) => {
      const { onTrack } = context.options()
      if (Math.abs(from - to) < 0.5) return onTrack?.(null)
      const spring = solveSpring(0.3, 1, from - to, velocity)
      const start = performance.now()
      const tick = () => {
        const t = performance.now() - start
        const at = spring.position(t)
        if (t > 600 || (Math.abs(at) < 0.5 && Math.abs(spring.velocity(t)) < 0.05)) return onTrack?.(null)
        onTrack?.(to + at)
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }
    return {
      /** A width inside the band, remembered at once. */
      setWidth(width: number) {
        if (!context.options().folded)
          context.options().onWidth?.(Math.round(Math.min(SIDE.max, Math.max(SIDE.min, width))))
      },
      /** Folds the sidebar. The edge is gone while it is folded: the fold key brings it back. */
      fold() {
        if (!context.options().folded) context.options().onFold?.()
      },
      pointerdown(event: PointerEvent, el: HTMLElement) {
        if (event.button !== 0) return
        event.preventDefault()
        stop?.()
        cancelAnimationFrame(frame)
        const left = el.closest(".canvas")?.getBoundingClientRect().left ?? 0
        const speed = createVelocityTracker()
        // the fold as this pull has left it: the shell's own signal lands a tick after the callback
        let folded = context.options().folded
        let moved = false
        let x = event.clientX - left
        let shown = context.options().width
        let keep = shown
        stop = bindDrag(el, event, {
          threshold: dragThreshold,
          cancelOnEscape: true,
          onMove: (at) => {
            const o = context.options()
            moved = true
            x = at.x - left
            speed.add(at.event.timeStamp, x)
            const d = drag(x, folded)
            if (d.kind === "close") {
              folded = true
              o.onFold?.()
            } else if (d.kind === "open") {
              folded = false
              shown = keep = d.width
              o.onDock?.(d.width)
            } else if (d.kind === "width") {
              shown = d.shown
              keep = d.keep
              o.onTrack?.(d.shown)
            }
          },
          onEnd: (end, canceled) => {
            const o = context.options()
            stop = undefined
            if (canceled) return o.onTrack?.(null)
            if (!moved) return o.onFold?.() // a click on the edge folds
            const v = speed.velocity(end.timeStamp)
            const r = release(x, v, folded)
            if (r.kind === "fold") return o.onFold?.()
            if (r.kind === "dock") return o.onDock?.(r.width)
            if (folded) return
            o.onWidth?.(keep)
            // the track's own speed: the hand's, scaled by how much of it the band was passing on
            const near = drag(x + 1, false)
            settle(shown, keep, near.kind === "width" ? v * (near.shown - shown) : 0)
          },
        })
      },
      keydown(event: KeyboardEvent) {
        const o = context.options()
        if (event.key === "Enter") {
          event.preventDefault()
          return o.onFold?.()
        }
        const to = step(o.width, event.key)
        if (to === undefined) return
        event.preventDefault()
        o.onWidth?.(to)
      },
    }
  },
  slots: (slot) => ({
    root: slot({
      role: "separator",
      focus: "tab-stop",
      keys: ["ArrowLeft", "ArrowRight", "Home", "End", "Enter"],
      attrs: (state) => ({
        tabindex: "0",
        "aria-orientation": "vertical",
        "aria-valuenow": String(state.width),
        "aria-valuemin": String(SIDE.min),
        "aria-valuemax": String(SIDE.max),
      }),
      on: {
        pointerdown: (event, { el, api }) => api.pointerdown(event, el!),
        keydown: (event, { api }) => api.keydown(event),
      },
    }),
  }),
  agent: { actions: ["setWidth", "fold"] },
})

/** The stage's left edge: `width`, `folded` and what the hand, a key or an agent asks of them. */
export const Edge = createParts(edge, { root: "div" }).Root
