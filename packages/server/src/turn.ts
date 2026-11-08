import type { InvocationToken } from "@effect-tavern/runtime/src/projection.ts"
// The turn in flight on one story, owned by the story (library.ts keeps one beside each session), never by a response.
// `start` runs an action to its end whether anyone listens or not and answers its events as a stream; a response is
// only a subscriber, and closing it stops nothing. `stop` is the player's: before the first character of prose the
// action is interrupted and leaves nothing ("withdrawn"), after it the prose halts where it is and record finishes a
// `stopped` node ("halted", session.ts); "before or after the first character" is this module's state. `busy` is the
// phase running, or null; a story runs one turn at a time (the wire answers a second action 409). `attach` is the
// late subscriber's: the snapshot (the phase, and the draft: the parent it hangs under, the player's input, the prose
// so far, the first draft a rewrite displaced; a `demand` has none, it only amends its node) then the live events,
// no replay. A turn that fails with nobody subscribed keeps its failure for the next `attach`, which consumes it
// (snapshot, then the `error`); a new action clears it. The calls a turn makes are filed under the node it lands
// (`file`) here, whoever listens. The broadcast is one Queue per subscriber, private to the run.
import type { Input } from "@effect-tavern/runtime/src/journal.ts"
import { textOf } from "@effect-tavern/runtime/src/journal.ts"
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import {
  decodeAction,
  perform,
  type Action,
  type Event,
  type Phase,
  type Session,
} from "@effect-tavern/runtime/src/session.ts"
import { Cause, Deferred, Effect, Fiber, Queue, Stream } from "effect"

export interface Draft {
  parent: Id | null
  input: Input
  invocations?: readonly InvocationToken[]
  text: string
  products?: Record<string, string> // narrate blocks so far, by id
  prev?: string
  fresh?: boolean // the line is nowhere else (an act): a client that attaches and sees it fail puts it back in the box
}
/** What a subscriber reads: the session's events, and the failure as a last element (the wire's `error` event). */
export type Out = Event | { kind: "error"; phase: Phase; cause: Cause.Cause<unknown> }
export type Call = Extract<Event, { kind: "call" }>

/** The phase an action is in before its first `stage`; a synchronous action (greet, checkout, setField) writes its node
 *  at once, the record's work. */
const first: Partial<Record<Action["kind"], Phase>> = {
  act: "lookup",
  swipe: "lookup",
  reword: "narrate",
  edit: "check",
}
/** The draft an action puts up, as the client draws it (client turn.ts): none for the ones that narrate nothing. */
const draftInput = (s: Session, a: Action): Draft | null => {
  if (a.kind === "act")
    return { parent: a.parent === undefined ? s.log.head : a.parent, input: a.input, text: "", fresh: true }
  if (a.kind !== "swipe" && a.kind !== "reword" && a.kind !== "edit") return null
  const n = s.log.nodes.get(a.node)
  if (!n) return null // the action fails on its own
  if (a.kind === "swipe") return { parent: n.parent, input: n.input, text: "" }
  if (a.kind === "reword") {
    const note = [n.input.note, a.note].filter(Boolean).join("\n") // joined as the session joins it
    return { parent: n.parent, input: note ? { ...n.input, note } : n.input, text: "" }
  }
  return { parent: n.parent, input: a.input ?? n.input, text: a.text ?? textOf(n.reply) }
}

const draftOf = (s: Session, a: Action): Draft | null => {
  const d = draftInput(s, a)
  if (!d?.input.invoke?.length || (d.parent !== null && !s.log.nodes.has(d.parent))) return d
  const catalog = s.activeContext(d.parent).playerCatalog
  const prior = "node" in a && a.node !== null && s.log.nodes.has(a.node) ? s.timelineNode(a.node).invocations : []
  return {
    ...d,
    invocations: d.input.invoke.flatMap((id) => {
      const item = catalog.find((i) => i.resourceId === id) ?? prior.find((i) => i.resourceId === id)
      return item ? [{ resourceId: item.resourceId, title: item.title, source: item.source }] : []
    }),
  }
}

interface Run {
  phase: Phase
  node?: Id
  draft: Draft | null
  narrating: boolean // a character of prose has streamed: a stop halts, no longer withdraws
  halt: Deferred.Deferred<void>
  fiber?: Fiber.Fiber<void>
  subs: Set<Queue.Queue<Out, Cause.Done>>
}

export class Busy extends Error {
  readonly code = "busy"
  constructor() {
    super("story is busy: a turn is in flight")
  }
}

export const makeTurn = (s: Session, file: (node: Id, calls: readonly Call[]) => void) => {
  let run: Run | undefined
  let failed: { phase: Phase; draft: Draft | null; cause: Cause.Cause<unknown> } | undefined
  const subscribe = (r: Run): Stream.Stream<Out> => {
    const q = Effect.runSync(Queue.unbounded<Out, Cause.Done>())
    r.subs.add(q)
    return Stream.fromQueue(q).pipe(Stream.ensuring(Effect.sync(() => void r.subs.delete(q))))
  }
  /** The run over: no longer the story's, every subscriber's stream ends. Idempotent. */
  const end = (r: Run) => {
    if (run === r) run = undefined
    for (const q of r.subs) Queue.endUnsafe(q)
  }
  const track = (r: Run, e: Event) => {
    if (e.kind === "change" && e.node) {
      r.draft = null
      r.node = e.node.id
    }
    if (e.kind === "stage") {
      r.phase = e.phase
      // each draft starts over: a narrate after check is the rewrite, the first one kept as `prev`
      if (e.phase === "narrate" && r.draft?.text) {
        const { products: _, ...d } = r.draft // the rewrite writes its own blocks
        r.draft = { ...d, text: "", prev: r.draft.text }
      }
    }
    if (e.kind === "delta" && e.part.type === "text-delta") {
      r.narrating = true // reasoning is not prose: the client counts the same
      if (r.draft) r.draft = { ...r.draft, text: r.draft.text + e.part.text }
    }
    if (e.kind === "delta" && e.part.type === "product-delta" && r.draft) {
      const { id, text } = e.part
      r.draft = { ...r.draft, products: { ...r.draft.products, [id]: (r.draft.products?.[id] ?? "") + text } }
    }
  }
  const skip = (node: Id): Event => {
    const r = run
    if (!r || r.phase !== "record" || r.node !== node)
      throw new Error("this settlement is not the active record attempt")
    const event: Event = { kind: "change", ...s.skipRecord(node) }
    for (const q of r.subs) Queue.offerUnsafe(q, event)
    return event
  }
  return {
    /** The phase of the turn in flight, or null. */
    get busy(): Phase | null {
      return run?.phase ?? null
    },
    /** Decodes and submits an action; a busy turn accepts only its pending record skip. */
    start: (raw: unknown): Stream.Stream<Out> => {
      const a = decodeAction(raw)
      if (run) {
        if (a.kind === "skipRecord") return Stream.make(skip(a.node))
        throw new Busy()
      }
      failed = undefined
      const r: Run = {
        phase: first[a.kind] ?? "record",
        ...(a.kind === "retryRecord" ? { node: a.node } : {}),
        draft: draftOf(s, a),
        narrating: false,
        halt: Effect.runSync(Deferred.make<void>()),
        subs: new Set(),
      }
      run = r
      const events = subscribe(r)
      const made: Call[] = [] // this action's calls, filed under its node once the node exists (an amend appends)
      r.fiber = Effect.runFork(
        Stream.runForEach(perform(s, a, Deferred.await(r.halt)), (e) =>
          Effect.sync(() => {
            track(r, e)
            if (e.kind === "call") made.push(e)
            if (e.kind === "change" && e.node) file(e.node.id, made.splice(0))
            for (const q of r.subs) Queue.offerUnsafe(q, e)
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              if (Cause.hasInterruptsOnly(cause)) return
              if (r.subs.size) for (const q of r.subs) Queue.offerUnsafe(q, { kind: "error", phase: r.phase, cause })
              else failed = { phase: r.phase, draft: r.draft, cause } // nobody heard it: the next attach does
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (r.node !== undefined && made.length) file(r.node, made.splice(0))
              end(r)
            }),
          ),
        ),
      )
      return events
    },
    skip,
    drop: (node: Id) => {
      if (run) throw new Busy()
      return s.drop(node)
    },
    /** "withdrawn" before the first character (nothing is saved, the story is free at once), "halted" after it (the
     *  turn goes on into a `stopped` node, on the same streams), null when nothing runs. */
    stop: (): "withdrawn" | "halted" | null => {
      const r = run
      if (!r) return null
      if (r.phase === "record" && r.node !== undefined && s.cancelRecord(r.node)) {
        return "halted" // the saved node remains; finalization broadcasts failed before closing
      }
      if (r.narrating) {
        Deferred.doneUnsafe(r.halt, Effect.void)
        return "halted"
      }
      if (r.fiber) Effect.runFork(Fiber.interrupt(r.fiber))
      end(r)
      return "withdrawn"
    },
    /** The snapshot and the live events while a turn runs; a failure nobody heard, once; none when idle. */
    attach: (): { phase: Phase | null; draft: Draft | null; events: Stream.Stream<Out> } | undefined => {
      if (run) return { phase: run.phase, draft: run.draft, events: subscribe(run) }
      const f = failed
      if (!f) return undefined
      failed = undefined
      return {
        phase: null,
        draft: f.draft,
        events: Stream.make({ kind: "error", phase: f.phase, cause: f.cause } as Out),
      }
    },
  }
}
export type Turn = ReturnType<typeof makeTurn>
