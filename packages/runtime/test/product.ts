// Tests for src/product.ts: shapes decode to answer schemas, caps and filters are code, the fold is declared
// (append / latest / rows merged by a key column) and feed and recall read the same one, recall items get stable ids,
// and validate holds a product's completeness and shape rules (the merge itself is test/layer.ts).
import assert from "node:assert/strict"
import { Schema } from "effect"
import {
  cap,
  decodeProducts,
  fold,
  render,
  rows,
  shapeSchema,
  validate,
  withCatalogs,
  type Catalog,
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

// Revisioned recall is exercised through derived.ts and context.ts.

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
// Catalogs: a catalog column is an enum whose options are the items holding on the state; none holding drops the table
// product, or the record's key (and the record with its last key).
const cgs: Catalog[] = [
  {
    id: "cg",
    baseUrl: "https://img/",
    items: [
      { id: "sword", variants: ["sword1.png", "sword2.png"] },
      { id: "night", when: { path: "dark", is: true } },
    ],
  },
  { id: "bgm", items: [{ id: "battle", when: { path: "hp", op: "lt", value: 10 } }] },
]
const pics: Product = {
  role: "chronicle",
  id: "pics",
  text: "illustrations after paragraphs",
  shape: {
    kind: "table",
    columns: [
      { key: "after", type: "int" },
      { key: "id", type: "enum", catalog: "cg" },
    ],
  },
}
const track = { key: "track", type: "enum", catalog: "bgm" } as const
const mood: Product = {
  role: "theater",
  id: "mood",
  text: "this turn",
  shape: { kind: "record", keys: [{ key: "line", type: "text" }, track] },
}
const day = { fields: { dark: false, hp: 50 } }
const [p1, m1] = withCatalogs([pics, mood], cgs, day)
assert.deepEqual(p1!.shape, {
  kind: "table",
  columns: [
    { key: "after", type: "int" },
    { key: "id", type: "enum", options: ["sword"] },
  ],
})
assert.deepEqual(dec(p1!)([{ after: 2, id: "sword" }]), [{ after: 2, id: "sword" }])
assert.throws(() => dec(p1!)([{ after: 2, id: "night" }])) // filtered out: not decodable
assert.deepEqual(dec(p1!)([]), []) // a table answers "none" with no row
assert.deepEqual(m1!.shape, { kind: "record", keys: [{ key: "line", type: "text" }] }) // bgm empty: the key dropped
const [, m2] = withCatalogs([pics, mood], cgs, { fields: { dark: true, hp: 5 } })
assert.deepEqual(m2!.shape, {
  kind: "record",
  keys: [
    { key: "line", type: "text" },
    { key: "track", type: "enum", options: ["battle"] },
  ],
})
const solo: Product = { ...mood, id: "solo", shape: { kind: "record", keys: [track] } }
assert.deepEqual(withCatalogs([solo, inventory], cgs, day), [inventory]) // no key left: the product goes; others untouched
assert.deepEqual(
  withCatalogs([pics], [{ id: "cg", items: [{ id: "night", when: { path: "dark", is: true } }] }], day),
  [],
)
assert.throws(() => withCatalogs([pics], [], day), /no catalog cg/)
// exactly one of options and catalog on an enum column; a catalog pick is not world state
assert.equal(validate(pics).on, true)
const col = (c: object) => ({ ...pics, shape: { kind: "table" as const, columns: [c as never] } })
assert.throws(() => validate(col({ key: "id", type: "enum" })), /exactly one of options or catalog/)
assert.throws(() => validate(col({ key: "id", type: "enum", options: ["a"], catalog: "cg" })), /exactly one/)
assert.throws(() => validate(col({ key: "id", type: "text", catalog: "cg" })), /exactly one/)
assert.throws(() => validate({ ...pics, role: "world" }), /not world state/)
console.log("product ok")
