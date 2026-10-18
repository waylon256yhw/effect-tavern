// Tests for src/product.ts: shapes decode to answer schemas, caps and filters are code, lists accumulate while other
// shapes take the latest, recall items get stable ids, and resolve merges defaults ← card patch ← player toggle.
import assert from "node:assert/strict"
import { Schema } from "effect"
import {
  cap,
  decodeProducts,
  entryRef,
  fold,
  recallEntries,
  render,
  resolve,
  rows,
  shapeSchema,
  type Product,
} from "../src/product.ts"

const defaults = decodeProducts([
  { id: "notes", text: "facts", shape: { kind: "list" }, feed: true },
  { id: "options", text: "four moves", shape: { kind: "list", max: 4 }, on: false },
])
const inventory: Product = {
  id: "bag",
  text: "what the player carries",
  shape: {
    kind: "table",
    columns: [
      { key: "item", type: "text" },
      { key: "n", type: "int" },
      { key: "kind", type: "enum", options: ["weapon", "misc"] },
    ],
    max: 2,
    filter: { path: "n", op: "gt", value: 0 },
  },
  feed: true,
  recall: "item",
}
const scene: Product = {
  id: "scene",
  text: "the scene",
  shape: {
    kind: "record",
    keys: [
      { key: "place", type: "text" },
      { key: "present", shape: { kind: "list", max: 1 } },
    ],
  },
}

// Answer schemas: a table row is checked column by column; a record's nested shape is one level down.
const dec = (p: Product) => Schema.decodeUnknownSync(shapeSchema(p.shape) as Schema.Codec<unknown>)
assert.deepEqual(dec(inventory)([{ item: "sword", n: 1, kind: "weapon" }]), [{ item: "sword", n: 1, kind: "weapon" }])
assert.throws(() => dec(inventory)([{ item: "sword", n: 1, kind: "food" }]))
assert.throws(() => dec(inventory)([{ item: "sword", n: 1.5, kind: "misc" }]))
assert.deepEqual(dec(scene)({ place: "inn", present: ["A", "B"] }), { place: "inn", present: ["A", "B"] })
assert.throws(() => dec(scene)({ place: "inn" }))

// Caps cut, filters hide, neither renumbers: the stored array keeps the model's order and indices.
const bag = [
  { item: "sword", n: 1, kind: "weapon" },
  { item: "coin", n: 0, kind: "misc" },
  { item: "rope", n: 2, kind: "misc" },
]
assert.deepEqual(cap(inventory.shape, bag), bag.slice(0, 2))
assert.deepEqual(
  rows(inventory.shape as Extract<Product["shape"], { kind: "table" }>, bag).map((r) => r.i),
  [0, 2],
)
assert.equal(render(inventory.shape, bag), "item=sword, n=1, kind=weapon | item=rope, n=2, kind=misc")
assert.deepEqual(cap(scene.shape, { place: "inn", present: ["A", "B"] }), { place: "inn", present: ["A"] })
assert.equal(render(scene.shape, { place: "inn", present: ["A"] }), "place: inn; present: A")
assert.equal(cap({ kind: "text", max: 3 }, "abcdef"), "abc")

// Fold along a path: lists accumulate, a table or record is the latest node that has one; absent stays absent.
const path = [{ notes: ["a"], bag: bag.slice(0, 1) }, { notes: ["b"] }, { notes: ["c"], bag }]
assert.deepEqual(fold([...defaults, inventory], path), { notes: ["a", "b", "c"], bag })
assert.deepEqual(fold([scene], path), {})

// Recall entries: filtered rows only, id = product@node#index with the stored index, hook = the named column.
assert.deepEqual(recallEntries(inventory, bag, 7), [
  { id: "bag@7#0", hook: "sword", text: "item=sword, n=1, kind=weapon" },
  { id: "bag@7#2", hook: "rope", text: "item=rope, n=2, kind=misc" },
])
assert.deepEqual(entryRef("bag@7#2"), { product: "bag", node: 7, index: 2 })
assert.equal(entryRef("li"), undefined)
assert.deepEqual(recallEntries(scene, { place: "inn", present: [] }, 1), []) // no recall declared

// Resolve: defaults ← card patch by id ← player toggle; a new product needs text and shape; recall must fit the shape.
const r = resolve(defaults, [{ id: "options", on: true }, inventory], { notes: false })
assert.deepEqual(
  r.map((p) => [p.id, p.on]),
  [
    ["notes", false],
    ["options", true],
    ["bag", true],
  ],
)
assert.equal(r[1]!.shape.kind === "list" && r[1]!.shape.max, 4) // the patch kept the default's shape
assert.throws(() => resolve(defaults, [{ id: "ghost" }]), /needs text and shape/)
assert.throws(() => resolve(defaults, [{ ...inventory, recall: "weight" }]), /names a column/)
assert.throws(() => resolve(defaults, [{ ...scene, recall: true }]), /only lists and tables/)

console.log("ok")
