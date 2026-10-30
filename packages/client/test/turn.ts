// The turn in flight (src/turn.ts) on a scripted wire: an act lands; a stop before the first character withdraws the
// line into its box, after it reads the snapshot back until the stopped node shows up (or says it never did); a failed
// revision keeps the revision and gives the line back; a story switch drops the stream without withdrawing; a demand
// holds the composer with no draft.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import assert from "node:assert/strict"
import { t } from "../src/i18n.ts"
import {
  apply,
  boxes,
  card,
  type CardView,
  cancelRevise,
  dismiss,
  draft,
  error,
  log,
  registry,
  revise,
  revising,
  setBoxes,
  stage,
  working,
  type Wire,
} from "../src/store.ts"
import { createTurn } from "../src/turn.ts"

let frames: (() => void)[] = []
;(globalThis as any).requestAnimationFrame = (f: () => void) => frames.push(f)
;(globalThis as any).cancelAnimationFrame = () => void (frames = [])
let clock = 0
Object.defineProperty(performance, "now", { value: () => clock })
const tick = () => {
  clock += 16
  const fs = frames
  frames = []
  fs.forEach((f) => f())
}
const playOut = () => {
  for (let n = 0; frames.length && n < 400; n++) tick()
}
const node = (id: number, parent: number | null, text: string, input = `in${id}`) =>
  ({ id, parent, turn: { id, parent, input: { text: input }, reply: [{ type: "text", text }], end: "end" } }) as any
const delta = (text: string): Wire => ({ kind: "delta", part: { type: "text-delta", id: "0", text } }) as Wire

// the scripted wire: each send is a stream the test feeds; an aborted one applies nothing more
type Stream = { action: Action; aborted: boolean; emit: (...es: Wire[]) => void }
const streams: Stream[] = []
const last = () => streams.at(-1)!
let grows = true // whether the stopped node ever shows up in the snapshot
let polls = 0
const turn = createTurn({
  send: (action) => {
    const s: Stream = { action, aborted: false, emit: (...es) => es.forEach((e) => !s.aborted && apply(e)) }
    streams.push(s)
    return () => void (s.aborted = true)
  },
  fetchNodes: async () => {
    polls++
    const l = registry.get(log)
    const id = l.nodes.size
    if (grows && polls === 3) registry.set(log, L.apply(l, { node: node(id, l.head, "cut"), head: id } as any))
  },
  delay: async () => {},
})

registry.set(card, { input: "act", greetings: [] } as unknown as CardView)
registry.set(log, L.of({ nodes: [node(0, null, "root")], head: 0 }))

// (a) act → lookup → narrate → deltas → the node lands: nothing in flight, nothing left over
turn.act("hi", "")
assert.deepEqual(last().action, { kind: "act", input: { text: "hi" } })
assert.equal(registry.get(draft)?.parent, 0)
last().emit({ kind: "stage", phase: "lookup" }, { kind: "stage", phase: "narrate" }, delta("hel"), delta("lo"))
last().emit({ kind: "change", node: node(1, 0, "hello", "hi"), head: 1 } as Wire)
playOut()
assert.deepEqual(
  [registry.get(draft), registry.get(revising), registry.get(error), registry.get(stage)],
  [null, null, null, null],
)
assert.equal(registry.get(log).head, 1)

// (b) stop before the first character: withdrawn, the line and its note back in their boxes
turn.act("line", "note")
setBoxes({ text: "", note: "", aside: false }) // the composer clears after the send
last().emit({ kind: "stage", phase: "narrate" })
await turn.stop()
assert.ok(last().aborted)
assert.deepEqual(boxes(), { text: "line", note: "note", aside: true })
assert.equal(registry.get(draft), null)

// (c) stop after a character: the Record slot waits while the snapshot is read back, the stopped node lands
setBoxes({ text: "", note: "", aside: false })
turn.act("go", "")
last().emit({ kind: "stage", phase: "narrate" }, delta("abc"))
playOut()
const was = registry.get(log).nodes.size
polls = 0
const stopping = turn.stop()
assert.equal(registry.get(stage), "record")
await stopping
assert.equal(polls, 3)
assert.equal(registry.get(log).nodes.size, was + 1)
assert.deepEqual([registry.get(draft), registry.get(stage), registry.get(error)], [null, null, null])

// (d) the stopped node never shows up: the ghost says so and the line comes back
grows = false
turn.act("lost", "")
last().emit({ kind: "stage", phase: "narrate" }, delta("abc"))
playOut()
polls = 0
await turn.stop()
assert.equal(polls, 100)
assert.equal(registry.get(error)?.message, t("app.stoppedNotRecorded"))
assert.equal(boxes().text, "lost")
dismiss()
setBoxes({ text: "", note: "", aside: false })

// (e) a revision that fails: the revision stays, the revised line is back in the box
setBoxes({ text: "typed", note: "", aside: false })
revise(L.get(registry.get(log), 1), "text")
assert.equal(boxes().text, "hi")
turn.act("hi again", "")
setBoxes({ text: "", note: "", aside: false })
assert.deepEqual(last().action, { kind: "act", parent: 0, input: { text: "hi again" } }) // beside the old one
last().emit({ kind: "error", message: "boom" })
assert.equal(registry.get(revising)?.node, 1)
assert.equal(boxes().text, "hi again")
dismiss()
cancelRevise()
assert.equal(boxes().text, "typed") // the displaced draft back
setBoxes({ text: "", note: "", aside: false })

// (f) another story while streaming: the stream is closed, the draft gone, nothing withdrawn, nothing more applied
const size = registry.get(log).nodes.size
turn.act("bye", "")
const s = last()
s.emit({ kind: "stage", phase: "narrate" }, delta("part"))
turn.abandon()
assert.ok(s.aborted)
assert.deepEqual([registry.get(draft), registry.get(stage), boxes().text], [null, null, ""])
s.emit(delta("more"), { kind: "change", node: node(size, 1, "partmore", "bye"), head: size } as Wire)
playOut()
assert.deepEqual([registry.get(draft), registry.get(log).nodes.size], [null, size])

// (g) a demand runs a stage with no draft: the composer is held all the same, until the answer lands
turn.demand(1, "aside")
last().emit({ kind: "stage", phase: "record" })
assert.deepEqual([registry.get(draft), registry.get(working)], [null, true])
last().emit({ kind: "change", head: registry.get(log).head } as Wire)
assert.equal(registry.get(working), false)
console.log("ok")
