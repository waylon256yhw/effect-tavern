// §16.5: the one piece of logic authors get. A closed tree over state paths; evaluable, GUI-able, decodable.
import { Schema } from "effect"

export type Cond =
  | { readonly path: string; readonly is: string | number | boolean }
  | { readonly path: string; readonly op: "lt" | "lte" | "gt" | "gte"; readonly value: number }
  | { readonly all: readonly Cond[] }
  | { readonly any: readonly Cond[] }
  | { readonly not: Cond }
  | { readonly event: string } // this turn emitted the event (for lore windows and anything else that reads settlement)
const Sub = Schema.suspend((): Schema.Codec<Cond> => Cond)
export const Cond: Schema.Codec<Cond> = Schema.Union([
  Schema.Struct({ path: Schema.String, is: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]) }),
  Schema.Struct({ path: Schema.String, op: Schema.Literals(["lt", "lte", "gt", "gte"]), value: Schema.Number }),
  Schema.Struct({ all: Schema.Array(Sub) }),
  Schema.Struct({ any: Schema.Array(Sub) }),
  Schema.Struct({ not: Sub }),
  Schema.Struct({ event: Schema.String }),
])

export type State = Record<string, unknown>
const lookup = (s: State, path: string) => {
  const v = path.split(".").reduce<unknown>((o, k) => (o as State | undefined)?.[k], s)
  if (v === undefined) throw new Error(`unknown state path ${path}`)
  return v
}
export const holds = (c: Cond, s: State, events: readonly string[] = []): boolean => {
  if ("all" in c) return c.all.every((x) => holds(x, s, events))
  if ("any" in c) return c.any.some((x) => holds(x, s, events))
  if ("not" in c) return !holds(c.not, s, events)
  if ("event" in c) return events.includes(c.event)
  const v = lookup(s, c.path)
  if ("is" in c) return v === c.is
  if (typeof v !== "number") throw new Error(`${c.path} is not a number`)
  return c.op === "lt" ? v < c.value : c.op === "lte" ? v <= c.value : c.op === "gt" ? v > c.value : v >= c.value
}
/** State paths a condition depends on: a fragment without `when` renders independently of state. */
export const reads = (c: Cond): string[] =>
  "all" in c
    ? c.all.flatMap(reads)
    : "any" in c
      ? c.any.flatMap(reads)
      : "not" in c
        ? reads(c.not)
        : "event" in c
          ? []
          : [c.path]
