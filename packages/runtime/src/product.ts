// Products: what the model is asked for at a fixed point after the prose (the record stage), as data. The ecosystem's
// per-turn string variables, option menus, inner thoughts, inventories and chronicles are all this one thing
// (docs/card-reading-2.md §7, docs/memory-table-reading.md §5): a declared question with a closed SHAPE for the answer.
// Shapes: text, list (of text), record (fixed keys; a key may hold a list or table, one level), table (rows over typed
// columns). Caps and filters are data applied by code (slice, not a schema rejection). `feed` says whether the folded
// value goes back to the model next turn; `recall` makes the accumulated items readable by the lookup stage like lore
// (hook = the item, or one column). The harness owns a default list (notes, options, inner); a card patches by id; the
// player toggles `on`.
// Ceilings: keyed tables answered as upsert/delete ops instead of full values; a cap derived from state; `every` n turns.
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
export const RecordShape = Schema.Struct({
  kind: Schema.Literal("record"),
  keys: Schema.Array(
    Schema.Union([Col, Schema.Struct({ key: Schema.String, shape: Schema.Union([ListShape, TableShape]) })]),
  ),
})
export const Shape = Schema.Union([TextShape, ListShape, RecordShape, TableShape])
export type Shape = typeof Shape.Type
export type TableShape = typeof TableShape.Type

export const Product = Schema.Struct({
  id: Schema.String,
  text: Schema.String, // the question; overridden per id by the player's / card's `asks` (fragment id `product.<id>`)
  shape: Shape,
  when: Schema.optionalKey(Cond), // asked only when it holds on the post-settlement state
  on: Schema.optionalKey(Schema.Boolean), // default true; the player's toggle wins
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
export const shapeSchema = (s: Shape): Schema.Top => {
  switch (s.kind) {
    case "text":
      return Schema.String
    case "list":
      return Schema.Array(Schema.String)
    case "table":
      return Schema.Array(Schema.Struct(Object.fromEntries(s.columns.map((c) => [c.key, colSchema(c)]))))
    case "record":
      return Schema.Struct(
        Object.fromEntries(s.keys.map((k) => [k.key, "shape" in k ? shapeSchema(k.shape) : colSchema(k)])),
      )
  }
}

/** Caps are data applied by code: over the cap, the model's answer is cut, not rejected. */
export const cap = (s: Shape, v: unknown): unknown => {
  if (s.kind === "text") return s.max === undefined ? v : String(v).slice(0, s.max)
  if (s.kind === "list" || s.kind === "table") return s.max === undefined ? v : (v as unknown[]).slice(0, s.max)
  const r = v as Row
  return Object.fromEntries(s.keys.map((k) => [k.key, "shape" in k ? cap(k.shape, r[k.key]) : r[k.key]]))
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
      return s.keys.map((k) => `${k.key}: ${"shape" in k ? render(k.shape, r[k.key]) : String(r[k.key])}`).join("; ")
    }
  }
}

/** The current value of each product along a path: lists accumulate, everything else is the latest node that has one. */
export const fold = (ps: readonly Product[], history: readonly Readonly<Row>[]): Row =>
  Object.fromEntries(
    ps.flatMap((p) => {
      const vs = history.map((h) => h[p.id]).filter((v) => v !== undefined)
      return vs.length ? [[p.id, p.shape.kind === "list" ? vs.flat() : vs.at(-1)]] : []
    }),
  )

/** Entries a recall product contributes to the lookup index: id `<product>@<node>#<index>`, hook, text. */
export const recallEntries = (
  p: Product,
  v: unknown,
  at: number,
): Array<{ id: string; hook: string; text: string }> => {
  if (p.recall === undefined || v === undefined) return []
  if (p.shape.kind === "list")
    return (v as string[]).map((item, i) => ({ id: `${p.id}@${at}#${i}`, hook: item, text: item }))
  if (p.shape.kind === "table")
    return rows(p.shape, v).map(({ i, row }) => ({
      id: `${p.id}@${at}#${i}`,
      hook: String(row[p.recall as string]),
      text: itemText(row),
    }))
  return []
}
export const entryRef = (id: string): { product: string; node: number; index: number } | undefined => {
  const m = /^(.+)@(\d+)#(\d+)$/.exec(id)
  return m ? { product: m[1]!, node: Number(m[2]), index: Number(m[3]) } : undefined
}

/** Harness defaults, patched by the card per id, `on` decided by the player. Validates completeness and `recall`. */
export const resolve = (
  defaults: readonly Product[],
  card: readonly ProductPatch[] = [],
  player: Readonly<Record<string, boolean>> = {},
): Product[] => {
  const byId = new Map<string, Partial<Product> & { id: string }>(defaults.map((p) => [p.id, p]))
  for (const c of card) byId.set(c.id, { ...byId.get(c.id), ...c })
  return [...byId.values()].map((p) => {
    if (!p.shape || p.text === undefined) throw new Error(`${p.id}: a product needs text and shape`)
    if (p.recall !== undefined) {
      if (p.shape.kind === "list" && p.recall !== true) throw new Error(`${p.id}: recall on a list is true`)
      if (p.shape.kind === "table" && !p.shape.columns.some((c) => c.key === p.recall))
        throw new Error(`${p.id}: recall names a column`)
      if (p.shape.kind === "text" || p.shape.kind === "record") throw new Error(`${p.id}: only lists and tables recall`)
    }
    return { ...(p as Product), on: player[p.id] ?? p.on ?? true }
  })
}
