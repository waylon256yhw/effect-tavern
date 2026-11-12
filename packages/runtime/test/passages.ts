import assert from "node:assert/strict"
import { Effect, Fiber, Stream } from "effect"
import { fake } from "@effect-tavern/provider"
import { makeSession, outcome } from "../src/session.ts"
import { decodeCard, type Card } from "../src/card.ts"
import { gateOf, makeDerived } from "../src/derived.ts"
import { makeCard } from "../src/card.ts"
import { makeLore } from "../src/lore.ts"
import { resolve } from "../src/layer.ts"
import { narratorHistory } from "../src/history.ts"
import { lint } from "../src/lint.ts"
import { chat } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"
const card: Card = {
  ...chat,
  fiction: [],
  greetings: [{ text: "old dawn" }],
  rules: {
    fields: [{ path: "clock", type: "int", initial: 0 }],
    actions: [],
    readouts: [{ id: "time", text: "time?", options: [{ id: "tick", text: "tick", do: [{ path: "clock", add: 1 }] }] }],
  },
  passages: [
    {
      when: { path: "fields.clock", op: "gte", value: 1 },
      text: "new dawn",
      digest: [],
      do: [{ path: "clock", set: 0 }],
    },
  ],
}
const create = (c = card) =>
  makeSession({
    card: c,
    rows: () => ({}),
    model: () => fake((o) => defaultAnswer(readStage(o), { notes: "day note" })),
  })
const S = create()
const root = S.greet(card.greetings[0]!)
const p = await Effect.runPromise(outcome(S.act(root.head, { text: "old day" })))
assert.equal(p.passage, true)
assert.equal(p.boundary, true)
assert.equal(S.context(p.id).fields.clock, 0)
const path = [...S.log.nodes.values()]
assert.equal(path.length, 3)
assert.equal(p.parent, path[1]!.id)
const D = makeDerived({
  rpg: makeCard(card.rules),
  L: () => makeLore([]),
  lore: [],
  products: () => resolve(card, {}).products,
  policy: () => ({ budget: 0, keep: 2, block: 2 }),
})
assert.equal(D.at(path).summary(), undefined)
assert.equal(D.at(path).known().known, "Known: ")
assert.deepEqual(
  narratorHistory(path).map((m) => m.text),
  ["new dawn"],
)
assert.ok(!JSON.stringify(D.at(path).ledger()).includes("old day"))
const E = create({ ...card, passages: [{ when: { all: [] }, text: "ending", end: true }, ...card.passages!] })
const e0 = E.greet(card.greetings[0]!)
const e = await Effect.runPromise(outcome(E.act(e0.head, { text: "end" })))
assert.equal(e.end, "over")
await assert.rejects(Effect.runPromise(outcome(E.act(e.id, { text: "again" }))), /terminal node/)
await Effect.runPromise(outcome(E.swipe(e.parent!)))
const O = create({
  ...card,
  passages: undefined,
  rules: { ...card.rules, over: { path: "fields.clock", op: "gte", value: 1 } },
})
const o0 = O.greet(card.greetings[0]!)
assert.equal((await Effect.runPromise(outcome(O.act(o0.head, { text: "end" })))).end, "over")
const N = create({ ...card, passages: [{ when: { all: [] }, note: "new dawn", digest: [], end: true }] })
const n0 = N.greet(card.greetings[0]!)
const n = await Effect.runPromise(outcome(N.act(n0.head, { text: "day" })))
assert.equal(n.end, "over")
assert.equal(n.boundary, true)
assert.equal(N.log.nodes.size, 3)
assert.equal(decodeCard(card).passages?.length, 1)
assert.ok(
  lint({ ...card, passages: [{ when: { all: [] }, text: "x", digest: ["missing"] }] }).some(
    (d) => d.rule === "unknown-product",
  ),
)
console.log("passages: ok")

// Explicit digest bypasses the ordinary gate, and a failed digest resumes without rerunning the player's record.
let failDigest = true
let records = 0
const dc: Card = {
  ...card,
  products: [
    {
      id: "memory",
      role: "chronicle",
      text: "Remember this day",
      shape: { kind: "text" },
      on: true,
      feed: true,
      when: { any: [] },
    },
  ],
  passages: [{ ...card.passages![0]!, digest: ["memory"] }],
}
const R = makeSession({
  card: dc,
  rows: () => ({}),
  model: () =>
    fake((o) => {
      const doc = readStage(o)
      if (doc.phase === "record" && doc.asked.includes("memory")) {
        if (failDigest) throw new Error("digest unavailable")
        return defaultAnswer(doc, { memory: "remembered day" })
      }
      if (doc.phase === "record") records++
      return defaultAnswer(doc, { notes: "old day note" })
    }),
})
const r0 = R.greet(dc.greetings[0]!)
await assert.rejects(Effect.runPromise(outcome(R.act(r0.head, { text: "old day" }))), /digest unavailable/)
const pending = R.log.head!
assert.equal(R.log.nodes.get(pending)?.passageStatus, "failed")
failDigest = false
const r = await Effect.runPromise(outcome(R.retryRecord(pending)))
assert.equal(records, 1)
assert.equal(r.products.memory, "remembered day")
assert.equal(R.log.nodes.size, 3)
const rd = makeDerived({
  rpg: makeCard(dc.rules),
  L: () => makeLore([]),
  lore: [],
  products: () => resolve(dc, {}).products,
  policy: () => ({ budget: 0, keep: 2, block: 2 }),
})
assert.match(rd.at([...R.log.nodes.values()]).known().current!, /remembered day/)
assert.equal(rd.at([...R.log.nodes.values()]).known().known, "Known: ")

// A hard boundary retires window deliveries, but permanent context and unlock floors survive reset.
const entry = {
  id: "secret",
  layers: ["secret"],
  unlock: { path: "fields.clock", op: "gte", value: 1 },
  offer: { any: [] },
} as const
const ld = makeDerived({
  rpg: makeCard(card.rules),
  L: () => makeLore([{ ...entry, ...gateOf(entry.id, entry.offer) }]),
  lore: [entry],
  products: () => resolve(card, {}).products,
  policy: () => ({ budget: 0, keep: 2, block: 2 }),
})
const lp = path.map((t, i) =>
  i === 1
    ? {
        ...t,
        deliveries: (["window", "permanent"] as const).map((residency) => ({
          resourceId: residency,
          revision: "1",
          title: residency,
          text: residency,
          source: "card" as const,
          residency,
        })),
      }
    : t,
)
assert.deepEqual(
  ld
    .at(lp)
    .resident()
    .map((d) => d.resourceId),
  ["permanent"],
)
assert.equal((ld.at(lp).context().lore as Record<string, { floor: number }>).secret!.floor, 1)
const longer = [
  ...lp,
  ...[3, 4, 5].map((id) => ({ ...p, id, parent: id - 1, boundary: undefined, products: { notes: "new epoch" } })),
]
assert.ok(ld.at(longer).summary()?.text.includes("new epoch"))
assert.ok(!ld.at(longer).summary()?.text.includes("day note"))
console.log("passage recovery and boundaries: ok")

// Failed passage work uses the existing timeline recovery contract; skipping preserves the committed player record.
assert.equal(R.timelineNode(pending).settlementStatus, "committed")
failDigest = true
await assert.rejects(Effect.runPromise(outcome(R.act(r.id, { text: "another day" }))), /digest unavailable/)
const failedPassage = R.log.head!
assert.equal(R.timelineNode(failedPassage).settlementStatus, "failed")
assert.equal(R.timelineNode(failedPassage).settlementError, "passage did not complete")
assert.equal(R.log.nodes.get(failedPassage)!.settlementStatus, "committed")
await assert.rejects(Effect.runPromise(outcome(R.act(failedPassage, { text: "blocked" }))), /parent passage/)
const beforeSkip = R.context(failedPassage).fields.clock
R.skipRecord(failedPassage)
assert.equal(R.timelineNode(failedPassage).settlementStatus, "skipped")
assert.equal(R.timelineNode(failedPassage).settlementError, undefined)
assert.equal(R.context(failedPassage).fields.clock, beforeSkip)
failDigest = false
await Effect.runPromise(outcome(R.act(failedPassage, { text: "continue after skip" })))

// A dynamic passage sees the new epoch and digest from lookup through record, before its node exists.
let digested = false
let failOpening = true
const openingPrompts: { phase: string; text: string }[] = []
const dynamicCard: Card = {
  ...dc,
  director: true,
  products: [
    ...dc.products!,
    {
      id: "scene",
      role: "world",
      text: "Scene",
      on: true,
      feed: true,
      shape: { kind: "record", keys: [{ key: "place", type: "text" }] },
      initial: { place: "old-world-place" },
      when: { any: [] },
    },
  ],
  rules: { ...dc.rules, fields: [{ path: "clock", type: "int", initial: 1 }] },
  lore: [
    {
      id: "morning",
      layers: ["morning baseline", "fresh morning"],
      unlock: { all: [] },
      offer: { path: "fields.clock", is: 0 },
    },
    ...(["window", "permanent"] as const).map((residency) => ({
      id: residency,
      layers: [`${residency} baseline`, `${residency} evidence`],
      residency,
      unlock: { all: [] },
      offer: { path: "fields.clock", is: 1 },
    })),
  ],
  passages: [
    {
      when: { path: "fields.clock", op: "gte", value: 2 },
      note: "new morning",
      digest: ["memory", "scene"],
      do: [{ path: "clock", set: 0 }],
    },
  ],
}
const V = makeSession({
  card: dynamicCard,
  rows: () => ({}),
  model: () =>
    fake((o) => {
      const doc = readStage(o)
      if (doc.phase === "record" && doc.asked.includes("memory")) {
        digested = true
        const answer = defaultAnswer(doc, { memory: "digest evidence" })
        return {
          ...answer,
          toolCalls: [{ name: "patch_scene", input: { patch: { place: "new-world-place" } } }, ...answer.toolCalls!],
        }
      }
      if (digested) {
        openingPrompts.push({ phase: doc.phase, text: JSON.stringify(o.prompt) })
        if (failOpening && doc.phase === "narrate") throw new Error("opening unavailable")
      }
      if (doc.phase === "narrate") return { text: digested ? "new prose" : "old prose evidence" }
      return defaultAnswer(doc, { notes: digested ? "new note" : "old note evidence" })
    }),
})
const v0 = V.greet(dynamicCard.greetings[0]!)
await assert.rejects(Effect.runPromise(outcome(V.act(v0.head, { text: "old input evidence" }))), /opening unavailable/)
const failedOpening = V.log.head!
assert.equal(V.timelineNode(failedOpening).settlementStatus, "failed")
assert.equal(V.log.nodes.size, 2)
failOpening = false
const v = await Effect.runPromise(outcome(V.retryRecord(failedOpening)))
assert.equal(v.passage, true)
assert.equal(V.timelineNode(failedOpening).settlementStatus, "committed")
assert.equal(V.log.nodes.size, 3)
assert.deepEqual(V.context(v.id).world.scene, { place: "new-world-place" })
for (const { phase, text } of openingPrompts) {
  assert.ok(!text.includes("old prose evidence"), phase)
  assert.ok(!text.includes("old input evidence"), phase)
  assert.ok(!text.includes("old note evidence"), phase)
  if (["lookup", "narrate", "record"].includes(phase)) assert.ok(text.includes("new-world-place"), phase)
  assert.ok(!text.includes("window evidence"), phase)
  if (["lookup", "narrate", "record"].includes(phase)) assert.ok(text.includes("digest evidence"), phase)
}
assert.ok(openingPrompts.some((p) => p.phase === "lookup"))
assert.ok(openingPrompts.some((p) => p.phase === "direct"))
assert.ok(openingPrompts.some((p) => p.phase === "narrate" && p.text.includes("permanent evidence")))
console.log("passage projection, skip and dynamic context: ok")

// Skipping an in-flight digest cancels its result; finalization must not turn skipped back into failed.
let entered!: () => void
let release!: () => void
const ready = new Promise<void>((r) => {
  entered = r
})
const wait = new Promise<void>((r) => {
  release = r
})
const fast = fake((o) => defaultAnswer(readStage(o), { notes: "day", memory: "late digest" }))
const original = fast.model as any
const slow = {
  ...fast,
  model: Object.assign(Object.create(original), {
    doGenerate: async (o: any) => {
      if (readStage(o).asked.includes("memory")) {
        entered()
        await wait
      }
      return original.doGenerate(o)
    },
  }),
}
const Q = makeSession({ card: dc, rows: () => ({}), model: () => slow })
const q0 = Q.greet(dc.greetings[0]!)
const fiber = Effect.runFork(Stream.runCollect(Q.act(q0.head, { text: "day" })))
await ready
const q = Q.log.head!
assert.equal(Q.timelineNode(q).settlementStatus, "pending")
Q.skipRecord(q)
release()
await Effect.runPromise(Fiber.await(fiber))
assert.equal(Q.timelineNode(q).settlementStatus, "skipped")
assert.equal(Q.log.nodes.size, 2)
console.log("in-flight passage skip: ok")

// After a dynamic node lands, a record failure belongs to that node; skipping it must leave no blocked ancestor.
let inOpening = false
const C = makeSession({
  card: dynamicCard,
  rows: () => ({}),
  model: () =>
    fake((o) => {
      const doc = readStage(o)
      if (doc.phase === "record" && doc.asked.includes("memory")) {
        inOpening = true
        return defaultAnswer(doc, { memory: "digest evidence" })
      }
      if (inOpening && doc.phase === "record") throw new Error("opening record unavailable")
      return defaultAnswer(doc, { notes: "day" })
    }),
})
const c0 = C.greet(dynamicCard.greetings[0]!)
await assert.rejects(Effect.runPromise(outcome(C.act(c0.head, { text: "day" }))), /opening record unavailable/)
const child = C.log.nodes.get(C.log.head!)!
assert.equal(child.passage, true)
assert.equal(C.timelineNode(child.id).settlementStatus, "failed")
assert.equal(C.timelineNode(child.parent!).settlementStatus, "committed")
C.skipRecord(child.id)
inOpening = false
await Effect.runPromise(outcome(C.act(child.id, { text: "continue" })))
console.log("dynamic child recovery: ok")
