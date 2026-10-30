// The turn in flight (docs: GLOSSARY §二, review/architecture-review-2026-10-30.html card 3): the eight actions by
// node id, plus stop and abandon. Each one sends through the wire and lets the stream land it (store.ts `apply`); the
// ones that run the narrator (act, swipe, reword, edit, keep) first put a draft under the node's parent. Stop closes
// the response: before the first character the turn is withdrawn (the line back in its box), after it the server
// finishes a `stopped` node the closed response never carries, so the snapshot is read back until it shows up.
// Abandon is the story switch's: the stream is cut and the draft dropped, nothing goes back anywhere.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import { t } from "./i18n.ts"
import {
  apply,
  arrived,
  card,
  clear,
  draft,
  error,
  type Id,
  inputOf,
  log,
  page,
  pin,
  prose,
  registry,
  revising,
  settle,
  stage,
  withdraw,
} from "./store.ts"
import * as wire from "./wire.ts"

export interface Transport {
  send: (action: Action) => () => void // returns the abort
  fetchNodes: () => Promise<void>
  delay: (ms: number) => Promise<void>
}

export const createTurn = ({ send, fetchNodes, delay }: Transport) => {
  let stopper: (() => void) | null = null // the narrating turn's abort: what Stop closes
  let streams: (() => void)[] = [] // every response this story opened: what a story switch closes
  const go = (action: Action) => {
    const abort = send(action)
    streams.push(abort)
    return abort
  }
  /** A draft under `parent`, then the action. `text`: an edit's draft is the player's prose, shown while check and
   *  record run over it. A fresh line (an act, a revised line) is nowhere else: a failed turn puts it back in the box. */
  const start = (parent: Id | null, input: { text: string; note?: string }, action: Action, text = "") => {
    registry.set(error, null)
    registry.set(draft, { parent, input, text, fresh: action.kind === "act" || registry.get(revising) !== null })
    stopper = go(action)
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
    /** The story starts from an opening (none on the card: an empty line, the player's first words start it). A draft
     *  is a reason to be in the reader: the page goes there, whatever the log holds yet. */
    greet: (index?: number): void => {
      registry.set(pin, null) // the old story's pin and error do not carry into a new one
      registry.set(error, null)
      if (registry.get(card)?.greetings.length) go({ kind: "greet", ...(index !== undefined && { greeting: index }) })
      registry.set(page, "reader")
    },
    /** Head to a version's newest leaf (the server moves it), or an empty line. */
    checkout: (id: Id | null): void => void go({ kind: "checkout", node: id }),
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
      void go({ kind: "setField", node: id, effects }),
    /** One product asked for over a node's scene: a record call, the answer kept on the node, no turn and no draft. */
    demand: (id: Id, product: string): void => void go({ kind: "demand", node: id, product }),
    stop: async (): Promise<void> => {
      if (!stopper) return
      stopper()
      const was = registry.get(log).nodes.size
      if (!arrived()) {
        withdraw()
        return clear() // the revision, if any, stays: its line is back in the box under it
      }
      registry.set(stage, "record") // what the server is doing with the cut prose; the Record slot waits for it
      for (let i = 0; i < 100 && registry.get(log).nodes.size === was; i++) {
        await delay(300)
        await fetchNodes()
      }
      // record failed on the server (the closed response never carried its error): the ghost says so, the line comes back
      if (registry.get(log).nodes.size === was) return apply({ kind: "error", message: t("app.stoppedNotRecorded") })
      settle()
    },
    /** Another story: every response this one opened is closed and the draft dropped, nothing withdrawn, no poll. */
    abandon: (): void => {
      for (const abort of streams) abort()
      streams = []
      stopper = null
      settle() // the revision and the error were the old story's too
    },
  }
}
export type Turn = ReturnType<typeof createTurn>

export const turn: Turn = createTurn({
  send: wire.send,
  fetchNodes: wire.fetchNodes,
  delay: (ms) => new Promise((r) => setTimeout(r, ms)),
})
