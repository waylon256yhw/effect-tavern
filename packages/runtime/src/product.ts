// Products: what the model is asked for at a fixed point after the prose, as data. The ecosystem's
// per-turn string variables, option menus, inner thoughts, inventories and chronicles are all this one thing
// (docs/card-reading-2.md §7, docs/memory-table-reading.md §5): a declared question with a closed SHAPE for the answer.
// Shapes: text, list (of text), record (fixed keys; a key may hold a list or table, one level), table (rows over typed
// columns). Caps and filters are data applied by code (slice, not a schema rejection). `fold` says
// how the value accumulates along the path (latest node, append, or rows merged by a key column, newest row per key):
// one declaration that feed (Known / Current), recall (the lookup index) and a client drawing the product all read.
// `feed` says whether the folded value goes back to the model next turn; `recall` makes the folded items readable by
// the lookup stage like lore (hook = the item, or one column). The harness owns a default list (notes, options, inner);
// a card patches by id, a player row patches label, text and `on` or declares a 小剧场 (layer.ts). `stage` says who writes it: record (one structured call, any shape) or
// narrate (the narrator after the prose, in a block opened by `<<aside>> <id>`, streamed, text only: no schema to force).
// Keyed tables accept partial rows and deletion tombstones; records merge defined fields. Notes remain a chronicle.
// Ceilings: pinning a row so record leaves it alone; a cap derived from state; `every` n turns.
import { Schema } from "effect"
import { Cond, holds } from "./cond.ts"

const Int = Schema.Int
export const Col = Schema.Struct({
  key: Schema.String,
  type: Schema.Literals(["text", "int", "boolean", "enum"]),
  options: Schema.optionalKey(Schema.Array(Schema.String)),
})
export const TextShape = Schema.Struct({ kind: Schema.Literal("text"), max: Schema.optionalKey(Int) }) // max chars
export const ListShape = Schema.Struct({ kind: Schema.Literal("list"), max: Schema.optionalKey(Int) }) // max items
export const TableShape = Schema.Struct({
  kind: Schema.Literal("table"),
  columns: Schema.Array(Col),
  max: Schema.optionalKey(Int), // max rows
  filter: Schema.optionalKey(Cond), // rows shown / recalled: a Cond over the row's columns (a row is a state object)
})
export interface RecordShape {
  readonly kind: "record"
  readonly keys: readonly (
    | typeof Col.Type
    | { readonly key: string; readonly shape: typeof ListShape.Type | typeof TableShape.Type | RecordShape }
  )[]
}
export const RecordShape: Schema.Codec<RecordShape> = Schema.Struct({
  kind: Schema.Literal("record"),
  keys: Schema.Array(
    Schema.Union([
      Col,
      Schema.Struct({
        key: Schema.String,
        shape: Schema.Union([ListShape, TableShape, Schema.suspend(() => RecordShape)]),
      }),
    ]),
  ),
})
export const Shape = Schema.Union([TextShape, ListShape, RecordShape, TableShape])
export type Shape = typeof Shape.Type
export type TableShape = typeof TableShape.Type

// How a product's value accumulates along the path. `latest`: the newest node that has one (a scene, a thought).
// `append`: every node's items in order (notes). `{ key }`: table rows merged by that column, the newest row per key
// in order of first appearance (people, an inventory: record reports the new and changed rows, the fold keeps the rest).
// Default: append for a list, latest otherwise.
export const Fold = Schema.Union([Schema.Literals(["latest", "append"]), Schema.Struct({ key: Schema.String })])
export type Fold = typeof Fold.Type

export const Product = Schema.Struct({
  id: Schema.String,
  label: Schema.optionalKey(Schema.String), // the shown name (the Writing page's toggle, a drawn product); the id when absent
  text: Schema.String, // the question; an ask `product.<id>` is a text patch at its row's rank (layer.ts)
  shape: Shape,
  stage: Schema.optionalKey(Schema.Literals(["narrate", "record"])), // default record
  fold: Schema.optionalKey(Fold),
  when: Schema.optionalKey(Cond), // asked only when it holds on the post-settlement state
  on: Schema.optionalKey(Schema.Boolean), // default true; the later row wins (layer.ts)
  feed: Schema.optionalKey(Schema.Boolean), // default false: fold goes back to the model (Known / Current)
  recall: Schema.optionalKey(Schema.Union([Schema.Literal(true), Schema.String])), // list: true; table: the hook column
})
export type Product = typeof Product.Type
/** A card's entry: a patch over the harness default of the same id, or a whole new product. */
export const ProductPatch = Schema.Struct({
  ...Product.fields,
  text: Schema.optionalKey(Schema.String),
  shape: Schema.optionalKey(Shape),
})
export type ProductPatch = typeof ProductPatch.Type
export const decodeProducts = Schema.decodeUnknownSync(Schema.Array(Product))

type Row = Record<string, unknown>
const colSchema = (c: typeof Col.Type) => {
  if (c.type === "text") return Schema.String
  if (c.type === "int") return Int
  if (c.type === "boolean") return Schema.Boolean
  if (!c.options?.length) throw new Error(`${c.key}: enum column needs options`)
  return Schema.Literals([...c.options])
}
/** The answer schema for a shape: what the record call is forced to produce. */
export const shapeSchema = (s: Shape, partial = false): Schema.Top => {
  switch (s.kind) {
    case "text":
      return Schema.String
    case "list":
      return Schema.Array(Schema.String)
    case "table":
      return Schema.Array(Schema.Struct(Object.fromEntries(s.columns.map((c) => [c.key, colSchema(c)]))))
    case "record":
      return Schema.Struct(
        Object.fromEntries(
          s.keys.map((k) => {
            const field = "shape" in k ? shapeSchema(k.shape, partial) : colSchema(k)
            return [k.key, partial ? Schema.optionalKey(field) : field]
          }),
        ),
      )
  }
}

/** Cross-turn products use sparse operations; notes and theater remain required top-level answers. */
export const sparse = (p: Pick<Product, "id" | "feed" | "recall">) => p.id !== "notes" && !!(p.feed || p.recall)
export const opSchemas = (p: Product): Schema.Top[] => {
  const product = Schema.Literal(p.id)
  if (p.shape.kind === "table" && typeof p.fold === "object") {
    const key = p.fold.key
    return [
      Schema.Struct({
        op: Schema.Literal("upsert"),
        product,
        row: Schema.Struct(
          Object.fromEntries(
            p.shape.columns.map((c) => [c.key, c.key === key ? colSchema(c) : Schema.optionalKey(colSchema(c))]),
          ),
        ),
      }),
      Schema.Struct({
        op: Schema.Literal("delete"),
        product,
        key: colSchema(p.shape.columns.find((c) => c.key === key)!),
      }),
    ]
  }
  return [Schema.Struct({ op: Schema.Literal("set"), product, value: shapeSchema(p.shape, true) })]
}
export type Op =
  | { op: "set"; product: string; value: unknown }
  | { op: "upsert"; product: string; row: Row }
  | { op: "delete"; product: string; key: unknown }
const defined = (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))
const orderedRow = (s: Shape, r: Row): Row =>
  s.kind === "table"
    ? Object.fromEntries(s.columns.filter((c) => r[c.key] !== undefined).map((c) => [c.key, r[c.key]]))
    : r
export const mergeRecord = (s: RecordShape, prev: Row, patch: Row): Row => {
  const out = { ...prev }
  for (const k of s.keys) {
    const v = patch[k.key]
    if (v === undefined) continue
    if ("shape" in k && k.shape.kind === "record") {
      const merged = mergeRecord(k.shape, (prev[k.key] as Row | undefined) ?? {}, v as Row)
      if (Object.keys(merged).length) out[k.key] = merged
    } else out[k.key] = v
  }
  return out
}
/** Reduce this call's operations to node deltas. A delete followed by reinsertion keeps the reset boundary. */
export const deltas = (ps: readonly Product[], ops: readonly Op[]): Row => {
  const out: Row = {}
  for (const o of ops) {
    const p = ps.find((p) => p.id === o.product)!
    if (o.op === "set") {
      const value =
        p.shape.kind === "record" ? mergeRecord(p.shape, (out[p.id] as Row | undefined) ?? {}, o.value as Row) : o.value
      if (p.shape.kind === "record" && !Object.keys(value as Row).length) continue
      out[p.id] = cap(p.shape, value)
    } else {
      const key = (p.fold as { key: string }).key
      const row = o.op === "delete" ? { [key]: o.key, $delete: true } : orderedRow(p.shape, o.row)
      const rows = (out[p.id] as Row[] | undefined) ?? []
      const i = rows.findLastIndex((r) => r[key] === row[key])
      if (i >= 0 && !(rows[i]!.$delete === true && o.op === "upsert")) {
        rows[i] = o.op === "delete" ? row : orderedRow(p.shape, { ...rows[i], ...row })
      } else rows.push(row)
      out[p.id] = rows
    }
  }
  // Count logical keys, not the extra tombstone needed for a delete/reinsert reset.
  for (const p of ps) {
    if (p.shape.kind !== "table" || typeof p.fold !== "object" || p.shape.max === undefined || out[p.id] === undefined)
      continue
    const key = p.fold.key
    const rows = out[p.id] as Row[]
    const kept = new Set([...new Set(rows.map((r) => r[key]))].slice(0, p.shape.max))
    out[p.id] = rows.filter((r) => kept.has(r[key]))
  }
  return out
}

/** Caps are data applied by code: over the cap, the model's answer is cut, not rejected. */
export const cap = (s: Shape, v: unknown): unknown => {
  if (s.kind === "text") return s.max === undefined ? v : String(v).slice(0, s.max)
  if (s.kind === "list" || s.kind === "table") return s.max === undefined ? v : (v as unknown[]).slice(0, s.max)
  const r = v as Row
  return Object.fromEntries(
    s.keys.filter((k) => r[k.key] !== undefined).map((k) => [k.key, "shape" in k ? cap(k.shape, r[k.key]) : r[k.key]]),
  )
}
/** Rows a table shows and recalls, with their index in the stored array (the filter never renumbers). */
export const rows = (s: TableShape, v: unknown): Array<{ i: number; row: Row }> =>
  (v as Row[]).map((row, i) => ({ i, row })).filter(({ row }) => !s.filter || holds(s.filter, row))
/** One item of a list or table as a line of text; what a recalled entry delivers. */
export const itemText = (item: unknown): string =>
  typeof item === "object" && item !== null
    ? Object.entries(item as Row)
        .map(([k, x]) => `${k}=${String(x)}`)
        .join(", ")
    : String(item)
/** A value as the model reads it back (Known, Current). */
export const render = (s: Shape, v: unknown): string => {
  switch (s.kind) {
    case "text":
      return String(v)
    case "list":
      return (v as string[]).join("; ")
    case "table":
      return rows(s, v)
        .map(({ row }) => itemText(row))
        .join(" | ")
    case "record": {
      const r = v as Row
      return s.keys
        .filter((k) => r[k.key] !== undefined)
        .map((k) => `${k.key}: ${"shape" in k ? render(k.shape, r[k.key]) : String(r[k.key])}`)
        .join("; ")
    }
  }
}

/** The items of a list or table folded along a path (`vs` = the value at each node, undefined where it has none), each
 *  with the position and stored index it came from. Merge by key keeps the newest row per key where the key first appeared. */
const items = (
  p: Pick<Product, "shape" | "fold">,
  vs: readonly unknown[],
): Array<{ at: number; i: number; item: unknown }> => {
  const all = vs.flatMap((v, at) => (v === undefined ? [] : (v as unknown[]).map((item, i) => ({ at, i, item }))))
  const f = p.fold ?? (p.shape.kind === "list" ? "append" : "latest")
  if (f === "append") return all
  if (f === "latest") {
    const last = vs.findLastIndex((v) => v !== undefined)
    return all.filter((x) => x.at === last)
  }
  const map = new Map<string, (typeof all)[number]>()
  for (const x of all) {
    const row = x.item as Row
    const k = String(row[f.key])
    if (row.$delete === true) map.delete(k)
    else map.set(k, { ...x, item: orderedRow(p.shape, { ...(map.get(k)?.item as Row | undefined), ...defined(row) }) })
  }
  return [...map.values()]
}
/** The current value of each product along a path, by its fold; a product no node has is absent. */
export const fold = (ps: readonly Pick<Product, "id" | "shape" | "fold">[], history: readonly Readonly<Row>[]): Row =>
  Object.fromEntries(
    ps.flatMap((p) => {
      const vs = history.map((h) => h[p.id])
      if (!vs.some((v) => v !== undefined)) return []
      const flat = p.shape.kind === "text"
      if (p.shape.kind === "record")
        return [
          [
            p.id,
            vs.reduce<Row>(
              (acc, v) => (v === undefined ? acc : mergeRecord(p.shape as RecordShape, acc, v as Row)),
              {},
            ),
          ],
        ]
      return [[p.id, flat ? vs.filter((v) => v !== undefined).at(-1) : items(p, vs).map((x) => x.item)]]
    }),
  )

/** Entries a recall product contributes to the lookup index over a path: the folded items (filtered rows only), each
 *  id `<product>@<node>#<index>` naming the node and stored index it lives at, hook = the item or the named column. */
export const recallEntries = (
  p: Product,
  path: readonly { id: number; v: unknown }[],
): Array<{ id: string; hook: string; text: string }> => {
  if (p.recall === undefined || (p.shape.kind !== "list" && p.shape.kind !== "table")) return []
  const s = p.shape
  return items(
    p,
    path.map((n) => n.v),
  )
    .filter(({ item }) => s.kind === "list" || !s.filter || holds(s.filter, item as Row))
    .map(({ at, i, item }) => ({
      id: `${p.id}@${path[at]!.id}#${i}`,
      hook: s.kind === "list" ? String(item) : String((item as Row)[p.recall as string]),
      text: itemText(item),
    }))
}
export const entryRef = (id: string): { product: string; node: number; index: number } | undefined => {
  const m = /^(.+)@(\d+)#(\d+)$/.exec(id)
  return m ? { product: m[1]!, node: Number(m[2]), index: Number(m[3]) } : undefined
}

/** The three kinds (docs/theater-brief.md §1), read off what the model reads back and how it folds: read back and replaced
 *  or merged by key → world (what is now: the readings page, the ledger); read back and appended → context (the model's
 *  chronicle: the Inspector only); never read back → theater (for the player alone: inline under its turn). Orthogonal
 *  to `stage`. `options` falls under theater by these rules; it has its own container, so the theater drawers skip it. */
export const kindOf = (p: Pick<Product, "shape" | "fold" | "feed" | "recall">): "world" | "context" | "theater" =>
  !p.feed && !p.recall
    ? "theater"
    : (p.fold ?? (p.shape.kind === "list" ? "append" : "latest")) === "append"
      ? "context"
      : "world"

/** A product once its patches are in (layer.ts walks the ranks): complete, its `fold` and `recall` fitting its shape, `on`
 *  decided. Throws, naming it: a card's bad patch fails when the session opens. */
export const validate = <P extends Partial<Product> & { id: string }>(p: P): P & Product => {
  if (!p.shape || p.text === undefined) throw new Error(`${p.id}: a product needs text and shape`)
  if (
    typeof p.fold === "object" &&
    !(p.shape.kind === "table" && p.shape.columns.some((c) => c.key === (p.fold as { key: string }).key))
  )
    throw new Error(`${p.id}: fold key names a table column`)
  if (p.stage === "narrate" && p.shape.kind !== "text") throw new Error(`${p.id}: a narrate product is text`)
  if (p.recall !== undefined) {
    if (p.shape.kind === "list" && p.recall !== true) throw new Error(`${p.id}: recall on a list is true`)
    if (p.shape.kind === "table" && !p.shape.columns.some((c) => c.key === p.recall))
      throw new Error(`${p.id}: recall names a column`)
    if (p.shape.kind === "text" || p.shape.kind === "record") throw new Error(`${p.id}: only lists and tables recall`)
  }
  return { ...(p as P & Product), on: p.on ?? true }
}
