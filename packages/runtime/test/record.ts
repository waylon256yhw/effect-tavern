// Sparse record through the real provider schema and session; folded recall keeps earlier columns.
import assert from "node:assert/strict"
import { fake, fakeText, type FakeCall } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { makeSession, type Event } from "../src/session.ts"
import { fold, type Product } from "../src/product.ts"
import { chat } from "./cards/index.ts"
import { defaultAnswer, readStage } from "./script.ts"

const people: Product = {
  id: "people",
  text: "People",
  on: true,
  recall: "name",
  fold: { key: "name" },
  shape: {
    kind: "table",
    columns: [
      { key: "name", type: "text" },
      { key: "note", type: "text" },
      { key: "role", type: "text" },
    ],
  },
}
const scene: Product = {
  id: "scene",
  text: "Scene",
  on: true,
  feed: true,
  shape: {
    kind: "record",
    keys: [
      { key: "place", type: "text" },
      { key: "present", shape: { kind: "list" } },
    ],
  },
}
const calls: FakeCall[] = []
let ops: unknown[] = []
const model = fake((o) => {
  calls.push(o)
  const doc = readStage(o)
  if (doc.phase === "record") return { text: JSON.stringify({ notes: "", ops }) }
  if (doc.phase === "lookup")
    return {
      text: JSON.stringify({
        read: doc.index.filter(([id]) => id.startsWith("people@")).map(([id]) => id),
        more: false,
      }),
    }
  return defaultAnswer(doc)
})
const S = makeSession({
  card: { ...chat, products: [scene, people] },
  rows: () => ({}),
  model: () => model,
  policy: { budget: 0, keep: 1, block: 1 },
})
let parent: number | null = null
const go = async () => {
  const es = [...(await Effect.runPromise(Stream.runCollect(S.act(parent, { text: "go" }))))]
  const node = es.flatMap((e: Event) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
  parent = node.id
  return node
}
const current = (phase: string) =>
  calls
    .filter((o) => readStage(o).phase === phase)
    .at(-1)!
    .prompt.map(fakeText)
    .join("\n")
ops = [
  { op: "set", product: "scene", value: { place: "茶亭", present: ["Li"] } },
  { op: "upsert", product: "people", row: { name: "Li", note: "N1", role: "guide" } },
]
const a = await go()
ops = [
  { op: "set", product: "scene", value: { place: "竹林" } },
  { op: "upsert", product: "people", row: { name: "Li", note: "N2" } },
]
const b = await go()
assert.deepEqual(b.turn.products.scene, { place: "竹林" })
assert.deepEqual(b.turn.products.people, [{ name: "Li", note: "N2" }])
assert.match(current("record"), /Current: .*people=name=Li, note=N1, role=guide/)
assert.ok(!current("narrate").includes("people="))
ops = []
const c = await go()
assert.deepEqual(c.turn.products, { notes: "" })
assert.deepEqual(
  fold(
    [scene, people],
    [a, b, c].map((n) => n.turn.products),
  ),
  {
    scene: { place: "竹林", present: ["Li"] },
    people: [{ name: "Li", note: "N2", role: "guide" }],
  },
)
assert.match(current("record"), /scene=place: 竹林; present: Li/)
await go() // b is now in the folded prefix; lookup retrieves the complete row, not its patch.
assert.match(current("narrate"), /name=Li, note=N2, role=guide/)
ops = [{ op: "delete", product: "people", key: "Li" }]
const d = await go()
assert.deepEqual(d.turn.products.people, [{ name: "Li", $delete: true }])
assert.deepEqual(
  fold(
    [people],
    [a, b, c, d].map((n) => n.turn.products),
  ),
  { people: [] },
)
ops = []
const beforeDelete = calls.length
await go()
assert.ok(!current("record").includes("people="))
assert.ok(
  !calls
    .slice(beforeDelete)
    .flatMap((o) => readStage(o).index)
    .some(([id]) => id.startsWith("people@")),
)

// Notes-only calls omit ops and its instruction, while notes remain required even when empty.
const only = makeSession({
  card: { ...chat, products: [] },
  rows: () => ({}),
  model: () =>
    fake((o) => {
      const doc = readStage(o)
      if (doc.phase === "record") {
        assert.equal(doc.ops, undefined)
        assert.ok(!o.prompt.map(fakeText).join("\n").includes("In ops,"))
        const schema = (o.responseFormat as { schema: { required: string[]; properties: Record<string, unknown> } })
          .schema
        assert.deepEqual(schema.required, ["notes"])
        assert.equal(schema.properties.ops, undefined)
      }
      return defaultAnswer(doc, { notes: "" })
    }),
})
await Effect.runPromise(Stream.runCollect(only.act(null, { text: "go" })))
console.log("record ok")
