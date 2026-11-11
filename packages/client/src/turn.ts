import { emptyDraft, type DraftModel } from "./composition.ts"
// The turn in flight (docs: GLOSSARY Turn / Stop, review/architecture-review-2026-10-30.html card 3): the eight actions by
// node id, plus stop, attach and abandon. Each one sends through the wire and lets the stream land it (store.ts
// `apply`); the ones that run the narrator (act, swipe, reword, edit, keep) first put a draft under the node's parent.
// The turn is the server's: a stream is only this client reading it. Stop asks the server (`POST /stop`), which
// decides: before the first character the turn is withdrawn (the line back in its box, the stream ends empty), after
// it the prose halts and the `stopped` node comes down the same stream. Attach picks up a turn already in flight on a
// story the client lands on (its draft, then its events). Abandon is the story switch's: the client stops reading and
// drops the draft; the turn runs on, on the server, and is there to attach to when the player comes back.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import { fillKnown } from "./pack.ts"
import {
  card,
  clear,
  demanded,
  draft,
  error,
  type Id,
  inputOf,
  log,
  composition,
  prose,
  registry,
  revising,
  running,
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
  const start = (
    parent: Id | null,
    input: { text: string; note?: string; invoke?: readonly string[] },
    action: Action,
    text = "",
    submitted?: DraftModel,
  ) => {
    registry.set(error, null)
    registry.set(demanded, null)
    registry.set(draft, {
      parent,
      input,
      text,
      composition: submitted,
      invocations:
        submitted?.invocations ??
        ("node" in action && action.node !== null ? registry.get(log).nodes.get(action.node)?.invocations : undefined),
      fresh: action.kind === "act" || registry.get(revising) !== null,
    })
    go(action)
  }
  const node = (id: Id) => L.get(registry.get(log), id)
  /** The revised input (the invoke kept, a cleared note gone) and the node it revises. */
  const revised = (text: string, note: string, selected: readonly string[]) => {
    const n = node(registry.get(revising)!.node)
    const { note: _, invoke: __, ...kept } = n.input
    return { n, input: { ...kept, ...inputOf(text, note), ...(selected.length ? { invoke: selected } : {}) } }
  }
  return {
    /** The player's line (and note) as a new turn under head; revising, beside the revised one under the same parent. */
    act: (): void => {
      const submitted = registry.get(composition)
      const rawText = submitted.text.trim()
      const rawNote = submitted.note.trim()
      const selected = submitted.invocations.map((i) => i.resourceId)
      registry.set(composition, emptyDraft())
      const dict = registry.get(card)?.layer?.names
      const text = fillKnown(rawText, dict)
      const note = fillKnown(rawNote, dict)
      if (registry.get(revising)) {
        const { n, input } = revised(text, note, selected)
        return start(n.parent, input, { kind: "act", parent: n.parent, input }, "", submitted)
      }
      const input = { ...inputOf(text, note), ...(selected.length ? { invoke: selected } : {}) }
      start(registry.get(log).head, input, { kind: "act", input }, "", submitted) // under head: the server knows where that is
    },
    /** The story starts from an opening (none on the card: an empty line, the player's first words start it). The
     *  caller (the card page's Begin) then closes onto the reader: this module sits under pages.ts and moves no page. */
    greet: (index?: number): void => {
      registry.set(composition, emptyDraft()) // the old story's invoke and error do not carry into a new one
      registry.set(error, null)
      if (registry.get(card)?.greetings.length) go({ kind: "greet", ...(index !== undefined && { greeting: index }) })
    },
    /** Head to a version's newest leaf (the server moves it), or an empty line. */
    checkout: (id: Id | null): void => go({ kind: "checkout", node: id }),
    swipe: (id: Id): void => {
      const n = node(id)
      start(n.parent, n.input, { kind: "swipe", node: id })
    },
    reword: (id: Id, note?: string): void => {
      const n = node(id)
      const input = { ...n.input, note: [n.input.note, note].filter(Boolean).join("\n") || undefined } // joined as the session joins it
      start(n.parent, input, { kind: "reword", node: id, ...(note !== undefined && { note }) })
    },
    /** The prose rewritten by the player: check and record run over it, nothing is narrated. */
    edit: (id: Id, text: string): void => {
      const n = node(id)
      start(n.parent, n.input, { kind: "edit", node: id, text }, text)
    },
    /** The revised line sent with the prose kept: a sibling whose record is redone over the same prose. */
    keep: (): void => {
      const submitted = registry.get(composition)
      const rawText = submitted.text.trim()
      const rawNote = submitted.note.trim()
      registry.set(composition, emptyDraft())
      const dict = registry.get(card)?.layer?.names
      const { n, input } = revised(
        fillKnown(rawText, dict),
        fillKnown(rawNote, dict),
        submitted.invocations.map((i) => i.resourceId),
      )
      start(n.parent, input, { kind: "edit", node: n.id, input }, prose(n), submitted)
    },
    retryRecord: (id: Id): void => {
      registry.set(error, null)
      registry.set(demanded, null)
      registry.set(stage, "record")
      go({ kind: "retryRecord", node: id })
    },
    skipRecord: (id: Id): void => {
      registry.set(error, null)
      registry.set(demanded, null)
      go({ kind: "skipRecord", node: id })
    },
    setField: (id: Id, effects: Extract<Action, { kind: "setField" }>["effects"]): void =>
      go({ kind: "setField", node: id, effects }),
    /** One product asked for over a node's scene: a record call, the answer kept on the node, no turn and no draft. */
    demand: (id: Id, product: string): void => {
      registry.set(error, null)
      registry.set(demanded, id)
      go({ kind: "demand", node: id, product })
    },
    stop: async (): Promise<void> => {
      if (!registry.get(working)) return
      const mine = streams
      const how = await stop()
      if (streams !== mine) return // abandon left this story while its stop was in flight
      if (how === "withdrawn") {
        for (const close of streams) close() // the turn is gone: nothing late on its stream lands after the clear
        streams = []
        withdraw()
        running(null) // no node or error will come down the stream to say the turn is over
        return clear() // the revision, if any, stays: its line is back in the box under it
      }
      // halted: what the server is doing with the cut prose; the node (or record's error) comes down the stream
      if (how === "halted" && registry.get(working)) registry.set(stage, "record")
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
