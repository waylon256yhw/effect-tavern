// The client's state as atoms, fed by the wire's events. The log tree lives in `nodes`; which sibling the reader is on
// is `active` (parent → child), client state the protocol does not keep; the path is derived by walking it from the
// root. `draft` is the node being written: its prose grows by `delta`, a second draft (check failed) starts it over.
import type { Event, Node, Phase } from "@effect-tavern/runtime/src/session.ts"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"

export type Id = number
export interface Draft {
  parent: Id | null
  input: { text: string; note?: string }
  text: string
}
export type Wire = Event | { kind: "error"; message: string }

export const registry = AtomRegistry.make()
export const nodes = Atom.make<ReadonlyMap<Id, Node>>(new Map())
export const active = Atom.make<ReadonlyMap<Id | null, Id>>(new Map())
export const draft = Atom.make<Draft | null>(null)
export const stage = Atom.make<Phase | null>(null)
export const error = Atom.make<string | null>(null)

/** Siblings of a parent in id order; the newest is the default active one. */
export const childrenOf = (all: ReadonlyMap<Id, Node>, parent: Id | null): Node[] =>
  [...all.values()].filter((n) => n.turn.parent === parent).sort((a, b) => a.turn.id - b.turn.id)

/** The reading line: from the root, the active child at every step. */
export const path = Atom.make((get) => {
  const all = get(nodes)
  const chosen = get(active)
  const out: Node[] = []
  let parent: Id | null = null
  for (;;) {
    const kids = childrenOf(all, parent)
    if (kids.length === 0) return out
    const next: Node = all.get(chosen.get(parent) ?? kids[kids.length - 1]!.turn.id) ?? kids[kids.length - 1]!
    out.push(next)
    parent = next.turn.id
  }
})

export const prose = (n: Node): string =>
  n.turn.reply
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("")

// Deltas are appended on an animation frame, not per token: one re-render per frame however fast the model types.
let pending = ""
let frame: number | undefined
const flush = () => {
  frame = undefined
  const t = pending
  pending = ""
  registry.update(draft, (d) => (d ? { ...d, text: d.text + t } : d))
}

export const apply = (e: Wire): void => {
  switch (e.kind) {
    case "stage":
      registry.set(stage, e.phase)
      // Each draft starts over: a narrate after check is the rewrite, the first one is gone.
      if (e.phase === "narrate") registry.update(draft, (d) => (d ? { ...d, text: "" } : d))
      return
    case "delta":
      if (e.part.type === "text-delta") {
        pending += e.part.text
        frame ??= requestAnimationFrame(flush)
      }
      return
    case "call":
      return
    case "node":
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
        frame = undefined
        pending = ""
      }
      registry.update(nodes, (all) => new Map(all).set(e.node.turn.id, e.node))
      registry.update(active, (m) => new Map(m).set(e.node.turn.parent, e.node.turn.id))
      registry.set(draft, null)
      registry.set(stage, null)
      return
    case "error":
      registry.set(error, e.message)
      registry.set(draft, null)
      registry.set(stage, null)
      return
  }
}

export const load = (all: readonly Node[]): void => {
  registry.set(nodes, new Map(all.map((n) => [n.turn.id, n])))
  registry.set(active, new Map())
}
