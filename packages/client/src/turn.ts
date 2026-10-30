// The turn in flight (docs: GLOSSARY §二, review/architecture-review-2026-10-30.html card 3): the eight actions by
// node id, plus stop, attach and abandon. Each one sends through the wire and lets the stream land it (store.ts
// `apply`); the ones that run the narrator (act, swipe, reword, edit, keep) first put a draft under the node's parent.
// The turn is the server's: a stream is only this client reading it. Stop asks the server (`POST /stop`), which
// decides: before the first character the turn is withdrawn (the line back in its box, the stream ends empty), after
// it the prose halts and the `stopped` node comes down the same stream. Attach picks up a turn already in flight on a
// story the client lands on (its draft, then its events). Abandon is the story switch's: the client stops reading and
// drops the draft; the turn runs on, on the server, and is there to attach to when the player comes back.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import {
  card,
  clear,
  draft,
  error,
  type Id,
  inputOf,
  log,
  pin,
  prose,
  registry,
  revising,
  settle,
  stage,
  withdraw,
  working,
} from "./store.ts"
import * as wire from "./wire.ts"

export interface Transport {
  send: (action: Action) => () => void // returns what closes the stream
  attach: () => () => void // the turn in flight, if any; returns what closes the stream
  stop: () => Promise<"withdrawn" | "halted" | null>
}

export const createTurn = ({ send, attach, stop }: Transport) => {
  let streams: (() => void)[] = [] // every response this story opened: what a story switch closes
  const go = (action: Action) => void streams.push(send(action))
  /** A draft under `parent`, then the action. `text`: an edit's draft is the player's prose, shown while check and
   *  record run over it. A fresh line (an act, a revised line) is nowhere else: a failed turn puts it back in the box. */
  const start = (parent: Id | null, input: { text: string; note?: string }, action: Action, text = "") => {
    registry.set(error, null)
    registry.set(draft, { parent, input, text, fresh: action.kind === "act" || registry.get(revising) !== null })
    go(action)
  }
  const node = (id: Id) => L.get(registry.get(log), id)
  /** The revised input (the pin kept, a cleared note gone) and the node it revises. */
  const revised = (text: string, note: string) => {
    const n = node(registry.get(revising)!.node)
    const { note: _, ...kept } = n.turn.input
    return { n, input: { ...kept, ...inputOf(text, note) } }
  }
  return {
    /** The player's line (and note) as a new turn under head; revising, beside the revised one under the same parent. */
    act: (text: string, note: string): void => {
      if (registry.get(revising)) {
        const { n, input } = revised(text, note)
        return start(n.parent, input, { kind: "act", parent: n.parent, input })
      }
      const pinned = registry.get(pin)
      const input = { ...inputOf(text, note), ...(pinned ? { pin: pinned } : {}) }
      registry.set(pin, null)
      start(registry.get(log).head, input, { kind: "act", input }) // under head: the server knows where that is
    },
    /** The story starts from an opening (none on the card: an empty line, the player's first words start it). The
     *  caller (the card page's Begin) then closes onto the reader: this module sits under pages.ts and moves no page. */
    greet: (index?: number): void => {
      registry.set(pin, null) // the old story's pin and error do not carry into a new one
      registry.set(error, null)
      if (registry.get(card)?.greetings.length) go({ kind: "greet", ...(index !== undefined && { greeting: index }) })
    },
    /** Head to a version's newest leaf (the server moves it), or an empty line. */
    checkout: (id: Id | null): void => go({ kind: "checkout", node: id }),
    swipe: (id: Id): void => {
      const n = node(id)
      start(n.parent, n.turn.input, { kind: "swipe", node: id })
    },
    reword: (id: Id, note?: string): void => {
      const n = node(id)
      const input = { ...n.turn.input, note: [n.turn.input.note, note].filter(Boolean).join("\n") || undefined } // joined as the session joins it
      start(n.parent, input, { kind: "reword", node: id, ...(note !== undefined && { note }) })
    },
    /** The prose rewritten by the player: check and record run over it, nothing is narrated. */
    edit: (id: Id, text: string): void => {
      const n = node(id)
      start(n.parent, n.turn.input, { kind: "edit", node: id, text }, text)
    },
    /** The revised line sent with the prose kept: a sibling whose record is redone over the same prose. */
    keep: (text: string, note: string): void => {
      const { n, input } = revised(text, note)
      start(n.parent, input, { kind: "edit", node: n.id, input }, prose(n))
    },
    setField: (id: Id, effects: Extract<Action, { kind: "setField" }>["effects"]): void =>
      go({ kind: "setField", node: id, effects }),
    /** One product asked for over a node's scene: a record call, the answer kept on the node, no turn and no draft. */
    demand: (id: Id, product: string): void => go({ kind: "demand", node: id, product }),
    stop: async (): Promise<void> => {
      if (!registry.get(working)) return
      const how = await stop()
      if (how === "withdrawn") {
        for (const close of streams) close() // the turn is gone: nothing late on its stream lands after the clear
        streams = []
        withdraw()
        return clear() // the revision, if any, stays: its line is back in the box under it
      }
      // halted: what the server is doing with the cut prose; the node (or record's error) comes down the stream
      if (how === "halted") registry.set(stage, "record")
    },
    /** Landing on a story: the turn already in flight there, if any, drawn as it stands and read to its end. */
    attach: (): void => void streams.push(attach()),
    /** Another story: this client stops reading the old one's streams and drops its draft, nothing withdrawn. */
    abandon: (): void => {
      for (const close of streams) close()
      streams = []
      settle() // the revision and the error were the old story's too
    },
  }
}
export type Turn = ReturnType<typeof createTurn>

export const turn: Turn = createTurn({
  send: wire.send,
  attach: wire.attach,
  stop: wire.stop,
})
