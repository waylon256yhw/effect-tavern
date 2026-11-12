// Model outputs contain wiring only; pure application consumes decoded values.
import { Schema } from "effect"
import { type Card, Field } from "./card.ts"
import { type Cond } from "./cond.ts"
import { identifier } from "./lint.ts"
import { Product, Col, type RecordShape } from "./product.ts"

/** Author chrome, stored beside the editable card; it never enters a runtime Card. */
const Fraction = Schema.Number.check(Schema.makeFilter((n) => Number.isFinite(n) && n > 0))
export const WorkshopLayout = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      h: Fraction,
      items: Schema.Array(Schema.Struct({ id: Schema.String, w: Fraction })),
    }),
  ),
})
export type WorkshopLayout = typeof WorkshopLayout.Type
export interface CardDraft {
  card?: Card
  layout?: WorkshopLayout
}
export interface DraftView extends CardDraft {
  card: Card
  draft: boolean
}

/** The model sees wiring and empty prose slots; authored values are only sent through an explicit selection. */
export const mechanical = (card: Card) => {
  const fragment = ({ text: _t, label: _l, ...wiring }: Card["fiction"][number]) => wiring
  return {
    id: card.id,
    heading: card.heading,
    input: card.input,
    director: card.director,
    frame: card.frame.map(fragment),
    fiction: card.fiction.map(fragment),
    asks: card.asks?.map(fragment),
    greetings: card.greetings.map((g) => ({ do: g.do })),
    ...(card.passages && { passages: card.passages.map(({ text: _text, note: _note, ...p }) => p) }),
    rules: {
      ...card.rules,
      fields: card.rules.fields.map(({ label: _l, group: _g, ...wiring }) => wiring),
      actions: card.rules.actions.map(({ text: _t, roll, ...wiring }) => ({
        ...wiring,
        roll: roll && typeof roll === "object" && "judge" in roll ? { judged: true } : roll,
      })),
      readouts: card.rules.readouts?.map(({ text: _t, options, ...wiring }) => ({
        ...wiring,
        options: options.map(({ text: _t, ...wiring }) => wiring),
      })),
    },
    lore: card.lore.map(({ layers, sections, ...wiring }) => ({
      ...wiring,
      layers: layers.map(() => ""),
      sections: sections?.map(({ id }) => ({ id })),
    })),
    products: card.products?.map(({ text: _t, label: _l, initial: _i, ...wiring }) => wiring),
    catalogs: card.catalogs?.map(({ id, items }) => ({ id, items: items.map(({ id, when }) => ({ id, when })) })),
  }
}

const Token = Schema.String.check(Schema.isPattern(identifier))
const Scalar = Schema.Union([Token, Schema.Number, Schema.Boolean])
const Sub = Schema.suspend((): Schema.Codec<Cond> => Condition)
const Condition: Schema.Codec<Cond> = Schema.Union([
  Schema.Struct({ path: Token, is: Scalar }),
  Schema.Struct({ path: Token, op: Schema.Literals(["lt", "lte", "gt", "gte"]), value: Schema.Number }),
  Schema.Struct({ all: Schema.Array(Sub) }),
  Schema.Struct({ any: Schema.Array(Sub) }),
  Schema.Struct({ not: Sub }),
  Schema.Struct({ event: Token }),
])
const Effects = Schema.Array(
  Schema.Union([
    Schema.Struct({ path: Token, set: Scalar }),
    Schema.Struct({ path: Token, add: Schema.Union([Schema.Number, Schema.Struct({ path: Token })]) }),
    Schema.Struct({ event: Token }),
  ]),
)
const optional = Schema.optionalKey
const Fields = Schema.Struct({
  path: Token,
  type: Field.fields.type,
  min: optional(Schema.Number),
  max: optional(Schema.Number),
  initial: Scalar,
  options: optional(Schema.Array(Token)),
  hidden: Field.fields.hidden,
  start: Field.fields.start,
  view: Field.fields.view,
})
const Actions = Schema.Struct({
  id: Token,
  when: optional(Condition),
  roll: optional(
    Schema.Union([Schema.Number, Schema.Struct({ path: Token }), Schema.Struct({ judged: Schema.Literal(true) })]),
  ),
  hit: optional(Effects),
  miss: optional(Effects),
  do: optional(Effects),
})
const Readouts = Schema.Struct({
  id: Token,
  when: optional(Condition),
  options: Schema.Array(Schema.Struct({ id: Token, do: Effects })),
})
const Column = Schema.Struct({
  key: Token,
  type: Col.fields.type,
  options: optional(Schema.Array(Token)),
  catalog: optional(Token),
})
const List = Schema.Struct({ kind: Schema.Literal("list"), max: optional(Schema.Int) })
const Table = Schema.Struct({
  kind: Schema.Literal("table"),
  max: optional(Schema.Int),
  columns: Schema.Array(Column),
  filter: optional(Condition),
})
const Record: Schema.Codec<RecordShape> = Schema.Struct({
  kind: Schema.Literal("record"),
  keys: Schema.Array(
    Schema.Union([
      Column,
      Schema.Struct({ key: Token, shape: Schema.Union([List, Table, Schema.suspend(() => Record)]) }),
    ]),
  ),
})
const Shape = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), max: optional(Schema.Int) }),
  List,
  Table,
  Record,
])
const Binding = Schema.Union([
  Schema.Struct({
    to: Schema.String.check(Schema.isPattern(/^fiction\..+\.when$|^lore\..+\.(?:unlock(?:\[\d+\])?|offer)$/)),
    when: Condition,
  }),
  Schema.Struct({ to: Schema.String.check(Schema.isPattern(/^greetings\[\d+\]\.do$/)), do: Effects }),
])
export const CompileOutput = Schema.Struct({
  fields: optional(Schema.Array(Fields)),
  actions: optional(Schema.Array(Actions)),
  readouts: optional(Schema.Array(Readouts)),
  over: optional(Condition),
  cap: optional(Schema.Int),
  bindings: Schema.Array(Binding),
  // Explicitly requested unwritten slots. No prose can travel through these declarations.
  slots: optional(
    Schema.Array(Schema.String.check(Schema.isPattern(/^(?:fiction\..+|lore\..+\.layers\[\d+\]|greetings\[\d+\])$/))),
  ),
  products: optional(
    Schema.Array(
      Schema.Struct({
        id: Token,
        shape: Shape,
        role: Product.fields.role,
        stage: Product.fields.stage,
        fold: optional(Schema.Union([Schema.Literals(["latest", "append"]), Schema.Struct({ key: Token })])),
        when: optional(Condition),
        on: Product.fields.on,
        trigger: Product.fields.trigger,
        feed: Product.fields.feed,
        recall: optional(Schema.Union([Schema.Literal(true), Token])),
        // initial can contain arbitrary authored prose; it stays author-owned alongside text and label.
      }),
    ),
  ),
})
export const SortOutput = Schema.Array(
  Schema.Struct({
    paragraphs: Schema.Array(Schema.Int),
    to: Schema.String.check(Schema.isPattern(/^(?:(?:frame|fiction)\..+|greetings\[\d+\]|lore\..+\.layers\[\d+\])$/)),
  }),
)
export const ReviewOutput = Schema.Array(
  Schema.Struct({
    rule: Schema.Literal("review:consistency"),
    level: Schema.Literal("warn"),
    path: Schema.String,
    message: Schema.String,
    hint: optional(Schema.String),
  }),
)
export type CompileOutput = typeof CompileOutput.Type
export type SortOutput = typeof SortOutput.Type
// Only the four destination families below can receive text. Existing entries are never replaced.
const place = (card: Card, to: string, text: string): Card => {
  const f = /^(fiction|frame)\.(.+)$/.exec(to)
  if (f) {
    const kind = f[1] as "fiction" | "frame",
      id = f[2]!
    if (!identifier.test(id)) throw new Error(`invalid identifier ${id}`)
    const old = card[kind].find((x) => x.id === id)
    if (kind === "frame" && !old) throw new Error(`undeclared frame slot ${to}`)
    if (old && (kind !== "frame" || (old.text !== undefined && old.text !== ""))) throw new Error(`occupied slot ${to}`)
    return {
      ...card,
      [kind]: old ? card[kind].map((x) => (x === old ? { ...x, text } : x)) : [...card[kind], { id, text }],
    }
  }
  const g = /^greetings\[(\d+)\]$/.exec(to)
  if (g && Number(g[1]) === card.greetings.length) return { ...card, greetings: [...card.greetings, { text }] }
  const l = /^lore\.(.+)\.layers\[(\d+)\]$/.exec(to)
  if (l) {
    const id = l[1]!,
      index = Number(l[2])
    if (!identifier.test(id)) throw new Error(`invalid identifier ${id}`)
    const old = card.lore.find((e) => e.id === id)
    if (index !== (old?.layers.length ?? 0)) throw new Error(`layers must append: ${to}`)
    const entry = old ?? { id, layers: [], unlock: { all: [] }, offer: { any: [] } }
    const next = { ...entry, layers: [...entry.layers, text] }
    return { ...card, lore: old ? card.lore.map((e) => (e === old ? next : e)) : [...card.lore, next] }
  }
  throw new Error(`invalid destination ${to}`)
}
export const applySort = (card: Card, source: readonly string[], placements: SortOutput): Card => {
  const seen = new Set<number>()
  let result = card
  for (const p of placements) {
    if (!p.paragraphs.length) throw new Error("empty placement")
    for (const i of p.paragraphs) {
      if (i < 0 || i >= source.length || seen.has(i)) throw new Error(`invalid or repeated paragraph ${i}`)
      seen.add(i)
    }
    result = place(
      result,
      p.to,
      [...p.paragraphs]
        .sort((a, b) => a - b)
        .map((i) => source[i]!)
        .join("\n\n"),
    )
  }
  return result
}
const merge = <T>(old: readonly T[], next: readonly T[], key: (v: T) => string): T[] => {
  const seen = new Set<string>()
  const out = [...old]
  for (const item of next) {
    const id = key(item)
    if (seen.has(id)) throw new Error(`duplicate output ${id}`)
    seen.add(id)
    const i = out.findIndex((x) => key(x) === id)
    if (i < 0) out.push(item)
    else out[i] = { ...out[i], ...item }
  }
  return out
}
export const applyCompile = (card: Card, output: CompileOutput): Card => {
  let result = card
  for (const slot of output.slots ?? []) result = place(result, slot, "")
  const actions = (output.actions ?? []).map((a) => {
    const old = card.rules.actions.find((x) => x.id === a.id)
    const roll =
      a.roll && typeof a.roll === "object" && "judged" in a.roll
        ? { judge: old?.roll && typeof old.roll === "object" && "judge" in old.roll ? old.roll.judge : "" }
        : a.roll
    if (
      old?.roll &&
      typeof old.roll === "object" &&
      "judge" in old.roll &&
      roll !== undefined &&
      !(typeof roll === "object" && "judge" in roll)
    )
      throw new Error("cannot remove authored judge")
    return { ...a, ...(roll !== undefined && { roll }), text: old?.text ?? "" } as Card["rules"]["actions"][number]
  })
  const readouts = (output.readouts ?? []).map((q) => {
    const old = card.rules.readouts?.find((x) => x.id === q.id)
    return {
      ...q,
      text: old?.text ?? "",
      options: merge(
        old?.options ?? [],
        q.options.map((o) => ({ ...o, text: old?.options.find((x) => x.id === o.id)?.text ?? "" })),
        (x) => x.id,
      ),
    }
  })
  result = {
    ...result,
    rules: {
      ...card.rules,
      fields: merge(card.rules.fields, output.fields ?? [], (x) => x.path),
      actions: merge(card.rules.actions, actions, (x) => x.id),
      ...(output.readouts && { readouts: merge(card.rules.readouts ?? [], readouts, (x) => x.id) }),
      ...(output.over && { over: output.over }),
      ...(output.cap !== undefined && { cap: output.cap }),
    },
    ...(output.products && {
      products: merge(
        card.products ?? [],
        output.products.map((p) => ({ ...p, text: card.products?.find((x) => x.id === p.id)?.text ?? "" })),
        (x) => x.id,
      ),
    }),
  }
  for (const b of output.bindings) {
    let found = false
    result = {
      ...result,
      fiction: result.fiction.map((f) => {
        if (b.to !== `fiction.${f.id}.when` || !("when" in b)) return f
        found = true
        return { ...f, when: b.when }
      }),
      greetings: result.greetings.map((g, i) => {
        if (b.to !== `greetings[${i}].do` || !("do" in b)) return g
        found = true
        return { ...g, do: b.do }
      }),
      lore: result.lore.map((e) => {
        if (!("when" in b)) return e
        if (b.to === `lore.${e.id}.offer`) {
          found = true
          return { ...e, offer: b.when }
        }
        if (b.to === `lore.${e.id}.unlock`) {
          if (Array.isArray(e.unlock)) throw new Error(`use an indexed unlock binding: ${b.to}`)
          found = true
          return { ...e, unlock: b.when }
        }
        const i = e.layers.findIndex((_, i) => b.to === `lore.${e.id}.unlock[${i}]`)
        if (i < 0) return e
        found = true
        const unlock = Array.isArray(e.unlock)
          ? [...e.unlock]
          : e.layers.map((_, i): Cond => (i === 0 ? (e.unlock as Cond) : { any: [] }))
        while (unlock.length < e.layers.length) unlock.push({ any: [] })
        unlock[i] = b.when
        return { ...e, unlock }
      }),
    }
    if (!found) throw new Error(`invalid binding ${b.to}`)
  }
  return result
}
