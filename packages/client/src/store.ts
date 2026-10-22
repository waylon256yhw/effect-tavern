// The client's state as atoms, fed by the wire's events. The log tree lives in `nodes`; which sibling the reader is on
// is `active` (parent → child), client state the protocol does not keep; the path is derived by walking it from the
// root. `draft` is the node being written: its prose grows by `delta`; a second draft (check failed) starts it over and
// keeps the first as `prev`, greyed in place until the node lands. A failed turn keeps its draft as a ghost under `error`.
import type { Rules } from "@effect-tavern/runtime/src/card.ts"
import type { Format, Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import type { Event, Node, Phase } from "@effect-tavern/runtime/src/session.ts"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"

export type Id = number
export interface Draft {
  parent: Id | null
  input: { text: string; note?: string }
  text: string
  prev?: string // the discarded first draft, shown greyed under the rewrite
}
export type Wire = Event | { kind: "error"; message: string }

export const registry = AtomRegistry.make()
export const nodes = Atom.make<ReadonlyMap<Id, Node>>(new Map())
export const active = Atom.make<ReadonlyMap<Id | null, Id>>(new Map())
export const draft = Atom.make<Draft | null>(null)
/** What the client draws the card by (GET /card): read once at open, before anything subscribes, hence keepAlive. */
export interface CardView {
  id: string
  title: string
  heading?: string // what titles a turn (Card.heading); absent, turns have no titles and there is no scene list
  input: "act" | "note" // the default channel: participant mode (act) or author mode (note), fixed for the session
  rules: Rules
  snippets: readonly Snippet[]
  format: readonly Format[]
}
export const card = Atom.make<CardView | null>(null).pipe(Atom.keepAlive)
export const pin = Atom.make<string | null>(null).pipe(Atom.keepAlive) // an untold entry the next act must tell (Input.pin), armed from a clue
export const compose = Atom.make("") // the composer's text; an Options row writes here and never sends
export const aside = Atom.make(false) // this one send goes to the narrator (participant mode's deviation); clears after the send
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
    const next: Node = all.get(chosen.get(parent)!) ?? kids.at(-1)!
    out.push(next)
    parent = next.turn.id
  }
})

/** The last node on the reading line and the one before it (its parent): what the header's dot, the Status table and
 *  the desktop's inline Record read. */
export const latest = Atom.make((get) => {
  const line = get(path)
  const node = line.at(-1)
  return node ? { node, prev: line.at(-2) } : null
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
      // Each draft starts over: a narrate after check is the rewrite, the first one greys under it.
      if (e.phase === "narrate") registry.update(draft, (d) => (d ? { ...d, text: "", prev: d.text || d.prev } : d))
      return
    case "delta":
      if (e.part.type === "text-delta") {
        pending += e.part.text
        frame ??= requestAnimationFrame(flush)
      }
      return
    case "node":
      registry.update(nodes, (all) => new Map(all).set(e.node.turn.id, e.node))
      registry.update(active, (m) => new Map(m).set(e.node.turn.parent, e.node.turn.id))
      registry.set(draft, null)
      registry.set(stage, null)
      return
    case "error":
      registry.set(error, e.message)
      registry.set(stage, null)
      withdraw()
      return
  }
}

/** The turn did not become a node: its line goes back into the box (unless the reader has typed since). */
export const withdraw = (): void => {
  const d = registry.get(draft)
  if (!d || registry.get(compose)) return
  registry.set(compose, d.input.text || d.input.note || "")
  registry.set(aside, !!d.input.note)
}

export const load = (all: readonly Node[]): void => {
  registry.set(nodes, new Map(all.map((n) => [n.turn.id, n])))
  registry.set(active, new Map())
}
