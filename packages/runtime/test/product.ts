// Tests for src/product.ts: shapes decode to answer schemas, caps and filters are code, the fold is declared
// (append / latest / rows merged by a key column) and feed and recall read the same one, recall items get stable ids,
// and validate holds a product's completeness and shape rules (the merge itself is test/layer.ts).
import assert from "node:assert/strict"
import { Schema } from "effect"
import {
  cap,
  decodeProducts,
  entryRef,
  fold,
  recallEntries,
  render,
  rows,
  shapeSchema,
  validate,
  type Product,
} from "../src/product.ts"

const defaults = decodeProducts([
  { role: "chronicle" as const, id: "notes", text: "facts", shape: { kind: "list" }, feed: true },
  { role: "theater" as const, id: "options", text: "four moves", shape: { kind: "list", max: 4 }, on: false },
])
const inventory: Product = {
  role: "world" as const,
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
const keyed: Product = { ...inventory, role: "chronicle", id: "kbag", fold: { key: "item" } } // rows merged by item, newest wins
const scene: Product = {
  role: "world" as const,
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

// Fold along a path, as declared: a list appends, a table or record defaults to the latest node that has one, a keyed
// table merges rows by the key (newest row per key, in order of first appearance); absent stays absent.
const path = [{ notes: ["a"], bag: bag.slice(0, 1) }, { notes: ["b"] }, { notes: ["c"], bag }]
assert.deepEqual(fold([...defaults, inventory], path), { notes: ["a", "b", "c"], bag })
assert.deepEqual(fold([scene], path), {})
const kpath = [{ kbag: [bag[0]!, bag[1]!] }, {}, { kbag: [{ item: "coin", n: 3, kind: "misc" }, bag[2]!] }]
assert.deepEqual(fold([keyed], kpath), { kbag: [bag[0], { item: "coin", n: 3, kind: "misc" }, bag[2]] })
assert.deepEqual(fold([keyed], [{ kbag: [bag[0]!] }, { kbag: [] }]), { kbag: [bag[0]] }) // a turn with no new rows keeps the table

// Recall entries read the same fold: id = product@node#index with the node and stored index the row lives at,
// filtered rows only, hook = the named column. On a keyed table the superseded row is not an entry.
const nodes = (vs: Record<string, unknown>[], ids: number[], id: string) =>
  vs.map((v, i) => ({ id: ids[i]!, v: v[id] }))
assert.deepEqual(recallEntries(inventory, nodes(path, [5, 6, 7], "bag")), [
  { id: "bag@7#0", hook: "sword", text: "item=sword, n=1, kind=weapon" },
  { id: "bag@7#2", hook: "rope", text: "item=rope, n=2, kind=misc" },
])
assert.deepEqual(
  recallEntries(keyed, nodes(kpath, [1, 2, 3], "kbag")).map((e) => e.id),
  ["kbag@1#0", "kbag@3#0", "kbag@3#1"], // coin was filtered at node 1 (n=0) and is readable from node 3 (n=3)
)
assert.deepEqual(entryRef("bag@7#2"), { product: "bag", node: 7, index: 2 })
assert.equal(entryRef("li"), undefined)
assert.deepEqual(recallEntries(scene, [{ id: 1, v: { place: "inn", present: [] } }]), []) // no recall declared

// Validate: a product needs text and shape; recall and fold must fit the shape; a narrate product is text; `on` decided.
assert.equal(validate(inventory).on, true)
assert.equal(validate({ ...inventory, on: false }).on, false)
assert.throws(() => validate({ id: "ghost" }), /needs text and shape/)
assert.throws(() => validate({ ...inventory, recall: "weight" }), /names a column/)
assert.throws(() => validate({ ...scene, recall: true }), /only lists and tables/)
assert.throws(
  () => validate({ ...inventory, role: "chronicle", fold: { key: "weight" } }),
  /fold key names a table column/,
)
assert.throws(() => validate({ ...inventory, stage: "narrate" }), /world writes belong to record/)

assert.throws(() => validate({ ...inventory, fold: { key: "item" } }), /world state uses transactions/)
console.log("product ok")
