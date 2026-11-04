// Tests for src/product.ts: shapes decode to answer schemas, caps and filters are code, the fold is declared
// (append / latest / rows merged by a key column) and feed and recall read the same one, recall items get stable ids,
// and resolve merges defaults ← card patch ← 小剧场 ← player toggle.
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
const keyed: Product = { ...inventory, id: "kbag", fold: { key: "item" } } // rows merged by item, newest wins
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

// Resolve: defaults ← card patch by id ← player toggle; a new product needs text and shape; recall must fit the shape.
const r = resolve(defaults, [{ id: "options", on: true }, inventory], [], { notes: false })
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
assert.throws(() => resolve(defaults, [{ ...inventory, fold: { key: "weight" } }]), /fold key names a table column/)
// narrate has no schema to force a shape: a narrate product is text; a patch moves a text product to narrate
assert.throws(() => resolve(defaults, [{ ...inventory, stage: "narrate" }]), /a narrate product is text/)
const diary = { id: "diary", text: "d", shape: { kind: "text" as const } }
assert.equal(resolve(defaults, [diary, { id: "diary", stage: "narrate" }]).at(-1)!.stage, "narrate")

// Theaters: a layer between the card's patches and the toggles, compiled to a narrate text product.
const stock = decodeProducts([
  { id: "notes", text: "facts", shape: { kind: "text" }, fold: "append", feed: true },
  { id: "options", text: "moves", shape: { kind: "list", max: 4 }, on: false },
  { id: "inner", label: "心声", text: "thoughts", shape: { kind: "text" }, stage: "narrate", on: false },
])
const by = (ps: readonly Product[], id: string) => ps.find((p) => p.id === id)
// a new id: fixed stage and shape, nothing else; a later patch finishes or overrides an earlier one, in order
assert.deepEqual(by(resolve(stock, [], [{ id: "town", label: "T", text: "gossip" }]), "town"), {
  id: "town",
  label: "T",
  text: "gossip",
  shape: { kind: "text" },
  stage: "narrate",
  on: true,
})
assert.equal(
  by(
    resolve(
      stock,
      [],
      [
        { id: "town", text: "pack's", on: false },
        { id: "town", text: "mine" },
      ],
    ),
    "town",
  )!.text,
  "mine",
)
// a new id without text is resolve's existing error
assert.throws(() => resolve(stock, [], [{ id: "town" }]), /needs text and shape/)
// on `inner`: wording and default change; no text keeps the question; the toggle still has the last word
const patched = by(resolve(stock, [], [{ id: "inner", text: "mine", on: true }]), "inner")!
assert.deepEqual([patched.text, patched.on, patched.label, patched.stage], ["mine", true, "心声", "narrate"])
assert.equal(by(resolve(stock, [], [{ id: "inner", on: true }]), "inner")!.text, "thoughts")
assert.equal(by(resolve(stock, [], [{ id: "inner", on: true }], { inner: false }), "inner")!.on, false)
// a card's text theater: the patch lands over its `when` and its cap, and the card's patch came first
const capped = {
  id: "diary",
  text: "d",
  shape: { kind: "text" as const, max: 9 },
  when: { path: "n", op: "gt" as const, value: 0 },
}
const onDiary = by(resolve(stock, [capped], [{ id: "diary", text: "mine" }]), "diary")!
assert.deepEqual(
  [onDiary.text, onDiary.shape, onDiary.when, onDiary.stage],
  ["mine", capped.shape, capped.when, "narrate"],
)
// The lock: on context (`notes`), a list (`options`), a keyed world table or a text the model reads back the patch is
// dropped whole, not thrown: the entry is what it was without the theater.
const world = [
  keyed,
  { id: "mood", text: "m", shape: { kind: "text" as const }, feed: true }, // a world text
  { id: "seen", text: "s", shape: { kind: "list" as const } }, // a list theater: never read back, still not text
]
const locked = ["notes", "options", "kbag", "mood", "seen"].map((id) => ({ id, label: "X", text: "X", on: true }))
assert.deepEqual(resolve(stock, world, locked), resolve(stock, world))
// a card's patch with no shape yet is not text: the theater is dropped and the card's own error stands
assert.throws(() => resolve(stock, [{ id: "ghost" }], [{ id: "ghost", text: "x" }]), /needs text and shape/)

console.log("ok")
