// The readings a client draws, as data: one pure projection per panel, one element kind per data shape
// (docs/client-design-brief-3.md §1). `record` is a turn's Record: only what it changed or produced. `status` is the
// full table at a node, grouped by the fields' `group`. Both choose a field's element the same way (`reading`): an enum
// is a step track, an int with both bounds a meter, anything else (an int bounded on one side, a number, a boolean) a
// value row, so no field is lost: that row is where a missing display declaration shows itself concretely. A meter is
// one of two by what its number means: a gauge is a stock filled from min (hp 0..100), a scale is a point on an axis
// the card's fiction splits into stages (好感度 -30..100 with six bands); the cuts come from the variants' `when`.
import type { Check, Field, Rules, State } from "@effect-tavern/runtime/src/card.ts"
import type { Cond } from "@effect-tavern/runtime/src/cond.ts"
import type { Shape } from "@effect-tavern/runtime/src/product.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"

export type Element =
  | { kind: "steps"; path: string; label: string; options: readonly string[]; was: number; now: number } // enum: indexes into options
  | {
      kind: "meter"
      path: string
      label: string
      min: number
      max: number
      was: number
      now: number
      cuts: readonly number[]
      scale: boolean
    } // int with both bounds; cuts: the stage thresholds inside (min, max), sorted; scale: a point on an axis, not a stock
  | { kind: "value"; path: string; label: string; was: State[string]; now: State[string] } // any other change
  | { kind: "check"; check: Check }
  | { kind: "clue"; id: string; text: string; pinnable: boolean } // pinnable: a deeper layer is still untold
  | { kind: "pin"; id: string; hook: string; told: boolean } // the entry this act pinned, by its hook (the parent's readable list; told, it has left this node's); untold: check never saw it fire, it can be pinned again
  | { kind: "notes"; items: readonly string[] }
  | { kind: "product"; id: string; label: string; shape: Shape; value: unknown } // any other product on the node (a card's, or one demanded), drawn by its shape; options are the Options container's

export const reading = (
  f: Field,
  was: State[string],
  now: State[string],
  whens: readonly (Cond | undefined)[] = [],
): Element => {
  const label = f.label ?? f.path
  if (f.type === "enum" && f.options)
    return {
      kind: "steps",
      path: f.path,
      label,
      options: f.options,
      was: f.options.indexOf(String(was)),
      now: f.options.indexOf(String(now)),
    }
  if (f.type === "int" && f.min !== undefined && f.max !== undefined) {
    const c = cuts(f.path, f.min, f.max, whens)
    return {
      kind: "meter",
      path: f.path,
      label,
      min: f.min,
      max: f.max,
      was: Number(was),
      now: Number(now),
      cuts: c,
      // a negative reach or two or more stages reads as a position; a stock with at most one threshold stays a gauge
      scale: f.min < 0 || c.length >= 2,
    }
  }
  return { kind: "value", path: f.path, label, was, now }
}

/** What the card view says of a product: its id, shown name and shape (store.ts CardView). */
export type Declared = { id: string; label?: string; shape: Shape }
export const record = (
  rules: Rules,
  node: Node,
  prev: Node | undefined,
  products: readonly Declared[] = [],
  whens: readonly (Cond | undefined)[] = [],
): Element[] => {
  const before: State = prev?.state ?? Object.fromEntries(rules.fields.map((f) => [f.path, f.initial]))
  const out: Element[] = []
  for (const f of rules.fields) {
    if (f.hidden) continue
    const was = before[f.path]!
    const now = node.state[f.path]!
    if (was !== now) out.push(reading(f, was, now, whens))
  }
  for (const check of node.checks) out.push({ kind: "check", check })
  const untold = new Set(node.readable.map((r) => r.id))
  for (const d of node.delivered) out.push({ kind: "clue", id: d.id, text: d.text, pinnable: untold.has(d.id) })
  const p = node.turn.input.pin
  if (p !== undefined)
    out.push({
      kind: "pin",
      id: p,
      hook: prev?.readable.find((r) => r.id === p)?.hook ?? p,
      told: node.turn.fired.some((d) => d.id === p),
    })
  const notes = node.turn.products.notes as readonly string[] | undefined
  if (notes?.length) out.push({ kind: "notes", items: notes })
  for (const p of products) {
    if (p.id === "notes" || p.id === "options") continue
    const value = node.turn.products[p.id]
    if (value !== undefined) out.push({ kind: "product", id: p.id, label: p.label ?? p.id, shape: p.shape, value })
  }
  return out
}

/** Every field at a state, in the card's order, grouped by `group` in order of first appearance; ungrouped fields
 *  come first under no name. */
export const status = (
  rules: Rules,
  state: State,
  whens: readonly (Cond | undefined)[] = [],
): { group?: string; items: Element[] }[] => {
  const groups = new Map<string | undefined, Element[]>([[undefined, []]])
  for (const f of rules.fields) {
    if (f.hidden) continue
    const v = state[f.path]!
    groups.set(f.group, [...(groups.get(f.group) ?? []), reading(f, v, v, whens)])
  }
  return [...groups].filter(([, items]) => items.length).map(([group, items]) => (group ? { group, items } : { items }))
}

/** A turn's title under the card's `heading` reference: a field path, else `<product>.<key>`; absent when nothing is there. */
export const heading = (ref: string | undefined, node: Node): string | undefined => {
  if (ref === undefined) return undefined
  const v = node.state[ref]
  if (v !== undefined) return String(v)
  const [id, key] = ref.split(".")
  const w = (node.turn.products[id!] as Record<string, unknown> | undefined)?.[key!]
  return typeof w === "string" && w ? w : undefined
}

// the ints a comparison on `path` splits the axis at: `gte v` / `lt v` turn at v, `gt v` / `lte v` at v + 1
const cutsOf = (c: Cond | undefined, path: string): number[] =>
  !c
    ? []
    : "all" in c
      ? c.all.flatMap((x) => cutsOf(x, path))
      : "any" in c
        ? c.any.flatMap((x) => cutsOf(x, path))
        : "not" in c
          ? cutsOf(c.not, path)
          : "op" in c && c.path === path
            ? [c.op === "gt" || c.op === "lte" ? c.value + 1 : c.value]
            : []

/** The stage thresholds of a meter on `path`: every comparison in `whens` (the fiction variants' conditions) plus 0
 *  when the scale crosses it, strictly inside (min, max), sorted and deduplicated. */
export const cuts = (path: string, min: number, max: number, whens: readonly (Cond | undefined)[] = []): number[] =>
  [...new Set([0, ...whens.flatMap((w) => cutsOf(w, path))].filter((x) => x > min && x < max))].sort((a, b) => a - b)
