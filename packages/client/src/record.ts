// The readings a client draws, as data: one pure projection per panel, one element kind per data shape
// (docs/client-design-brief-3.md §1). `record` is a turn's Record: only what it changed or produced. `status` is the
// full table at a node, grouped by the fields' `group`. Both choose a field's element the same way (`reading`): an enum
// is a step track, an int with both bounds a meter, anything else (an int bounded on one side, a number, a boolean) a
// value row, so no field is lost: that row is where a missing display declaration shows itself concretely.
import type { Check, Field, Rules, State } from "@effect-tavern/runtime/src/card.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"

export type Element =
  | { kind: "steps"; path: string; label: string; options: readonly string[]; was: number; now: number } // enum: indexes into options
  | { kind: "meter"; path: string; label: string; min: number; max: number; was: number; now: number } // int with both bounds
  | { kind: "value"; path: string; label: string; was: State[string]; now: State[string] } // any other change
  | { kind: "check"; check: Check }
  | { kind: "clue"; id: string; text: string; pinnable: boolean } // pinnable: a deeper layer is still untold
  | { kind: "pin"; id: string; told: boolean } // the entry this act pinned; untold: check never saw it fire, it can be pinned again
  | { kind: "notes"; items: readonly string[] }

export const reading = (f: Field, was: State[string], now: State[string]): Element => {
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
  if (f.type === "int" && f.min !== undefined && f.max !== undefined)
    return { kind: "meter", path: f.path, label, min: f.min, max: f.max, was: Number(was), now: Number(now) }
  return { kind: "value", path: f.path, label, was, now }
}

export const record = (rules: Rules, node: Node, prev: Node | undefined): Element[] => {
  const before: State = prev?.state ?? Object.fromEntries(rules.fields.map((f) => [f.path, f.initial]))
  const out: Element[] = []
  for (const f of rules.fields) {
    if (f.hidden) continue
    const was = before[f.path]!
    const now = node.state[f.path]!
    if (was !== now) out.push(reading(f, was, now))
  }
  for (const check of node.checks) out.push({ kind: "check", check })
  const untold = new Set(node.readable.map((r) => r.id))
  for (const d of node.delivered) out.push({ kind: "clue", id: d.id, text: d.text, pinnable: untold.has(d.id) })
  const p = node.turn.input.pin
  if (p !== undefined) out.push({ kind: "pin", id: p, told: node.turn.fired.some((d) => d.id === p) })
  const notes = node.turn.products.notes as readonly string[] | undefined
  if (notes?.length) out.push({ kind: "notes", items: notes })
  return out
}

/** Every field at a state, in the card's order, grouped by `group` in order of first appearance; ungrouped fields
 *  come first under no name. */
export const status = (rules: Rules, state: State): { group?: string; items: Element[] }[] => {
  const groups = new Map<string | undefined, Element[]>([[undefined, []]])
  for (const f of rules.fields) {
    if (f.hidden) continue
    const v = state[f.path]!
    groups.set(f.group, [...(groups.get(f.group) ?? []), reading(f, v, v)])
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
