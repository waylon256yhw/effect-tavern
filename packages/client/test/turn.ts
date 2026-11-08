import { timelineNode as node } from "./fixtures.ts"
import { composition, updateComposition } from "../src/store.ts"
import { token } from "./fixtures.ts"
// The turn in flight (src/turn.ts) on a scripted wire: an act lands; a stop the server withdraws puts the line back in
// its box, one it halts waits on the same stream for the stopped node (or record's error, the line back); a failed
// revision keeps the revision and gives the line back; a story switch drops the stream without withdrawing; a demand
// holds the composer with no draft; an attach draws the turn as it stands and plays on to its node or its failure.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import assert from "node:assert/strict"
import {
  apply,
  cancelRevise,
  card,
  dismiss,
  draft,
  error,
  log,
  registry,
  revise,
  revising,
  stage,
  stories,
  working,
  type CardView,
  type StoryRow,
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
const delta = (text: string): Wire => ({ kind: "delta", part: { type: "text-delta", id: "0", text } }) as Wire

// the scripted wire: each send or attach is a stream the test feeds; an aborted one applies nothing more. A stop
// answers what the server would decide (`stopping`).
type Stream = { action?: Action; aborted: boolean; emit: (...es: Wire[]) => void }
const streams: Stream[] = []
const last = () => streams.at(-1)!
const open = (action?: Action) => {
  const s: Stream = { action, aborted: false, emit: (...es) => es.forEach((e) => !s.aborted && apply(e)) }
  streams.push(s)
  return () => void (s.aborted = true)
}
let stopping: "withdrawn" | "halted" | null = null
let stops = 0
const turn = createTurn({
  send: open,
  attach: () => open(),
  stop: async () => (stops++, stopping),
})

registry.set(card, { input: "act", greetings: [] } as unknown as CardView)
registry.set(log, L.of({ nodes: [node(0, null, "root")], head: 0 }))

// (a) act → lookup → narrate → deltas → the node lands: nothing in flight, nothing left over
updateComposition({ text: "hi", note: "", noteOpen: false })
turn.act()
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

// (b) the server withdraws the stop (before the first character): the line and its note back in their boxes, the
// stream closed so nothing late lands; idle, a stop asks nothing
await turn.stop()
assert.equal(stops, 0)
updateComposition({ text: "line", note: "note", noteOpen: true })
turn.act()
updateComposition({ text: "", note: "", noteOpen: false }) // the composer clears after the send
registry.set(stories, { current: 1, stories: [{ id: 1, busy: null } as unknown as StoryRow] })
last().emit({ kind: "stage", phase: "narrate" })
assert.equal(registry.get(stories)?.stories[0]?.busy, "narrate") // the row says so before any listing
stopping = "withdrawn"
await turn.stop()
assert.ok(last().aborted)
assert.equal(registry.get(stories)?.stories[0]?.busy, null) // withdrawn: no node comes to end it, the row is told
assert.deepEqual(registry.get(composition), { text: "line", note: "note", noteOpen: true, invocations: [] })
assert.deepEqual([registry.get(draft), registry.get(stage)], [null, null])

// (c) the server halts it (after a character): the Record slot waits on the same stream, the stopped node lands
updateComposition({ text: "", note: "", noteOpen: false })
updateComposition({ text: "go", note: "", noteOpen: false })
turn.act()
last().emit({ kind: "stage", phase: "narrate" }, delta("abc"))
playOut()
const was = registry.get(log).nodes.size
stopping = "halted"
await turn.stop()
assert.deepEqual([registry.get(stage), last().aborted], ["record", false])
last().emit({ kind: "change", node: node(was, 1, "abc", "go"), head: was } as Wire)
assert.equal(registry.get(log).nodes.size, was + 1)
assert.deepEqual([registry.get(draft), registry.get(stage), registry.get(error)], [null, null, null])

// (d) record fails after the halt: its error comes down the stream, the ghost says so and the line comes back
updateComposition({ text: "lost", note: "", noteOpen: false })
turn.act()
last().emit({ kind: "stage", phase: "narrate" }, delta("abc"))
playOut()
await turn.stop()
last().emit({ kind: "error", message: "record failed" })
assert.equal(registry.get(error)?.message, "record failed")
assert.equal(registry.get(composition).text, "lost")
dismiss()
updateComposition({ text: "", note: "", noteOpen: false })

// (e) a revision that fails: the revision stays, the revised line is back in the box
updateComposition({ text: "typed", note: "", noteOpen: false })
revise(L.get(registry.get(log), 1), "text")
assert.equal(registry.get(composition).text, "hi")
updateComposition({ text: "hi again", note: "", noteOpen: false })
turn.act()
updateComposition({ text: "", note: "", noteOpen: false })
assert.deepEqual(last().action, { kind: "act", parent: 0, input: { text: "hi again" } }) // beside the old one
last().emit({ kind: "error", message: "boom" })
assert.equal(registry.get(revising)?.node, 1)
assert.equal(registry.get(composition).text, "hi again")
dismiss()
cancelRevise()
assert.equal(registry.get(composition).text, "typed") // the displaced draft back
updateComposition({ text: "", note: "", noteOpen: false })

// (f) another story while streaming: the stream is closed, the draft gone, nothing withdrawn, nothing more applied
const size = registry.get(log).nodes.size
updateComposition({ text: "bye", note: "", noteOpen: false })
turn.act()
const s = last()
s.emit({ kind: "stage", phase: "narrate" }, delta("part"))
turn.abandon()
assert.ok(s.aborted)
assert.deepEqual([registry.get(draft), registry.get(stage), registry.get(composition).text], [null, null, ""])
s.emit(delta("more"), { kind: "change", node: node(size, 1, "partmore", "bye"), head: size } as Wire)
playOut()
assert.deepEqual([registry.get(draft), registry.get(log).nodes.size], [null, size])

// (g) a demand runs a stage with no draft: the composer is held all the same, until the answer lands
revise(L.get(registry.get(log), 1), "text")
const revision = registry.get(revising)
turn.demand(1, "aside")
last().emit({ kind: "stage", phase: "record" })
assert.deepEqual([registry.get(draft), registry.get(working)], [null, true])
last().emit({ kind: "change", node: node(1, 0, "hello", "hi"), head: registry.get(log).head } as Wire)
assert.equal(registry.get(working), false)
assert.equal(registry.get(revising), revision)
turn.setField(1, [{ path: "hp", set: 5 }])
last().emit({ kind: "change", node: node(1, 0, "hello", "hi"), head: registry.get(log).head } as Wire)
assert.equal(registry.get(revising), revision)
updateComposition({ text: "revised", note: "", noteOpen: false })
turn.act()
updateComposition({ text: "", note: "", noteOpen: false })
assert.deepEqual(last().action, { kind: "act", parent: 0, input: { text: "revised" } })
last().emit({ kind: "change", node: node(10, 0, "new", "revised"), head: 10 } as Wire)
assert.equal(registry.get(revising), null)

// (h) back on a story whose turn runs on: the attach draws it as it stands (the prose so far at once), the live deltas
// play on, the node lands; one that failed while nobody listened gives its line back
turn.attach()
const draftNow = { parent: 1, input: { text: "back" }, text: "so far " }
last().emit({ kind: "attach", phase: "narrate", draft: draftNow })
assert.deepEqual([registry.get(draft)?.text, registry.get(stage), registry.get(working)], ["so far ", "narrate", true])
last().emit(delta("and more"))
playOut()
assert.equal(registry.get(draft)?.text, "so far and more")
const at = registry.get(log).nodes.size
last().emit({ kind: "change", node: node(at, 1, "so far and more", "back"), head: at } as Wire)
playOut()
assert.deepEqual([registry.get(draft), registry.get(working), registry.get(log).head], [null, false, at])
turn.attach()
last().emit(
  { kind: "attach", phase: null, draft: { ...draftNow, input: { text: "failed" }, fresh: true } },
  {
    kind: "error",
    message: "boom",
  },
)
assert.deepEqual([registry.get(error)?.message, registry.get(composition).text], ["boom", "failed"])
// a swipe's line is on its node already (no `fresh` from the server): its failure leaves the box alone
updateComposition({ text: "", note: "", noteOpen: false })
turn.attach()
last().emit(
  { kind: "attach", phase: null, draft: { ...draftNow, input: { text: "rolled" } } },
  { kind: "error", message: "boom" },
)
assert.deepEqual([registry.get(error)?.message, registry.get(composition).text], ["boom", ""])

// A stop belongs to the story whose streams it was sent on, even when its reply arrives after a switch.
for (const result of ["withdrawn", "halted"] as const) {
  turn.abandon()
  let answer!: (value: typeof result) => void
  const delayed = createTurn({
    send: open,
    attach: () => open(),
    stop: () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  })
  updateComposition({ text: "A", note: "", noteOpen: false })
  delayed.act()
  const stopping = delayed.stop()
  delayed.abandon()
  updateComposition({ text: "B", note: "", noteOpen: false })
  delayed.act()
  last().emit({ kind: "stage", phase: "narrate" })
  const before = registry.get(draft)
  answer(result)
  await stopping
  assert.equal(registry.get(draft), before)
  assert.equal(registry.get(stage), "narrate")
  assert.equal(last().aborted, false)
  last().emit({ kind: "stage", phase: "record" })
  assert.equal(registry.get(stage), "record")
  delayed.abandon()
}
// Chip-only turns carry all selections, clear them on send, and restore them on failure.
turn.abandon()
updateComposition({ text: "", note: "", noteOpen: false })
updateComposition({ invocations: ["guide", "pack/style"].map(token) })
updateComposition({ text: "", note: "", noteOpen: false })
turn.act()
assert.deepEqual(last().action, { kind: "act", input: { text: "", invoke: ["guide", "pack/style"] } })
assert.deepEqual(
  registry.get(composition).invocations.map((i) => i.resourceId),
  [],
)
last().emit({ kind: "error", message: "unavailable" } as Wire)
assert.deepEqual(
  registry.get(composition).invocations.map((i) => i.resourceId),
  ["guide", "pack/style"],
)
turn.abandon()
updateComposition({ invocations: [].map(token) })
// A token-only sibling keeps its frozen labels visible while the new prose streams.
const chip = {
  ...node(100, null, "chip prose", ""),
  input: { text: "", invoke: ["guide"] },
  invocations: [token("guide")],
}
registry.set(log, L.of({ nodes: [chip], head: chip.id }))
turn.swipe(chip.id)
assert.deepEqual(registry.get(draft)?.invocations, chip.invocations)
turn.abandon()
console.log("ok")
