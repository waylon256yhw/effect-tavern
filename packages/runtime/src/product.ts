// Products declare their responsibility explicitly: world state, chronicle, or player-facing theater.
// Shapes compile tool inputs and completion outputs. Chronicle values may fold across turns; world state
// changes only through world.ts transactions and stable host-assigned entity IDs. Presentation caps apply
// to per-turn outputs; exceeding a world-state limit is a recoverable transaction error.
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
  role: Schema.Literals(["world", "chronicle", "theater"]),
  initial: Schema.optionalKey(Schema.Unknown),
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
  role: Schema.optionalKey(Product.fields.role),
})
export type ProductPatch = typeof ProductPatch.Type
export const decodeProducts = Schema.decodeUnknownSync(Schema.Array(Product))

type Row = Record<string, unknown>
export const colSchema = (c: typeof Col.Type) => {
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
    map.set(k, x)
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

/** Presentation names for explicit product roles. */
export const kindOf = (p: Pick<Product, "role">): "world" | "context" | "theater" =>
  p.role === "chronicle" ? "context" : p.role

/** A product once its patches are in (layer.ts walks the ranks): complete, its `fold` and `recall` fitting its shape, `on`
 *  decided. Throws, naming it: a card's bad patch fails when the session opens. */
export const validate = <P extends Partial<Product> & { id: string }>(p: P): P & Product => {
  if (p.role === "theater" && (p.feed || p.recall)) throw new Error(`${p.id}: theater cannot feed or recall`)
  if (!p.shape || p.text === undefined) throw new Error(`${p.id}: a product needs text and shape`)
  if (!p.role) throw new Error(`${p.id}: a product needs an explicit role`)
  if (p.role === "world" && p.fold !== undefined)
    throw new Error(`${p.id}: world state uses transactions, not a fold policy`)
  if (p.role === "world" && p.stage === "narrate") throw new Error(`${p.id}: world writes belong to record`)
  if (p.role === "world" && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(p.id))
    throw new Error(`${p.id}: world product IDs must be tool-safe identifiers`)
  if (p.role === "world" && p.shape.kind === "table" && p.shape.columns.some((c) => c.key === "entityId"))
    throw new Error(`${p.id}: entityId is reserved for host identity`)
  if (p.id === "answers") throw new Error("answers is reserved for rule readouts")
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
