// The readings a client draws, as data: one pure projection per panel, one element kind per data shape
// (docs/client-design-brief-3.md §1). `record` is a turn's Record: only what it changed or produced. `status` is the
// full table at a node, grouped by the fields' `group`. Both choose a field's element the same way (`reading`): an enum
// is a step track, an int with both bounds a meter, anything else (an int bounded on one side, a number, a boolean) a
// value row, so no field is lost: that row is where a missing display declaration shows itself concretely. A meter is
// one of two by what its number means (runtime card.ts `drawn`, shared with `card check`): a gauge is a stock filled
// from min (hp 0..100), a scale is a point on an axis the card's fiction splits into stages (好感度 -30..100 with six
// bands); the cuts come from the bands' `when`, and the card's `view` overrides the guess.
// Beside the readings, the rest of what the chrome reads off a node, each its own pure function over the log, the card
// view or the node (review/architecture-review-2026-10-30.html card 4: one module, no eager node object): the field
// rows alone and the two dots' yes/no (`fields`, `fieldChanged`, `marked`), the input line and its channel, the parent,
// the versions, the scene.
import { drawn, type Check, type Field, type Rules, type State } from "@effect-tavern/runtime/src/card.ts"
import type { Cond } from "@effect-tavern/runtime/src/cond.ts"
import type { Shape } from "@effect-tavern/runtime/src/product.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import type { CardView } from "./store.ts"

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
  | { kind: "notes"; text: string }
  | { kind: "product"; id: string; label: string; shape: Shape; value: unknown } // any other product on the node (a card's, or one demanded), drawn by its shape; options are the Options container's

export const reading = (
  f: Field,
  was: State[string],
  now: State[string],
  whens: readonly (Cond | undefined)[] = [],
): Element => {
  const label = f.label ?? f.path
  const d = drawn(f, whens)
  if (d.as === "steps")
    return {
      kind: "steps",
      path: f.path,
      label,
      options: f.options!,
      was: f.options!.indexOf(String(was)),
      now: f.options!.indexOf(String(now)),
    }
  if (d.as !== "value")
    return {
      kind: "meter",
      path: f.path,
      label,
      min: f.min!,
      max: f.max!,
      was: Number(was),
      now: Number(now),
      cuts: d.cuts,
      scale: d.as === "scale",
    }
  return { kind: "value", path: f.path, label, was, now }
}

/** The conditions a meter's stages come from: the fiction variants' `when` (`reading`'s cuts). */
export const whens = (view: Pick<CardView, "fiction"> | null | undefined) => view?.fiction.map((f) => f.when) ?? []

const before = (rules: Rules, prev: Node | undefined): State =>
  prev?.state ?? Object.fromEntries(rules.fields.map((f) => [f.path, f.initial]))

/** The Record's field-change rows alone: every shown field whose value differs from the parent's (from the initial
 *  values at a root). */
export const fields = (
  rules: Rules,
  node: Node,
  prev: Node | undefined,
  whens: readonly (Cond | undefined)[] = [],
): Element[] => {
  const was = before(rules, prev)
  return rules.fields
    .filter((f) => !f.hidden && was[f.path] !== node.state[f.path])
    .map((f) => reading(f, was[f.path]!, node.state[f.path]!, whens))
}

/** Did this turn change a shown field: the Status button's dot. */
export const fieldChanged = (rules: Rules | undefined, node: Node, prev: Node | undefined): boolean => {
  if (rules === undefined) return false
  const was = before(rules, prev)
  return rules.fields.some((f) => !f.hidden && was[f.path] !== node.state[f.path])
}

/** Does the Record hold anything but notes (a field change, a check, a clue, a pin, a declared product): the Record
 *  pill's dot. Notes alone light nothing: every turn has them. */
export const marked = (
  rules: Rules | undefined,
  node: Node,
  prev: Node | undefined,
  products: readonly Declared[] = [],
): boolean =>
  rules !== undefined &&
  (fieldChanged(rules, node, prev) ||
    node.checks.length > 0 ||
    node.delivered.length > 0 ||
    node.turn.input.pin !== undefined ||
    products.some((p) => p.id !== "notes" && p.id !== "options" && node.turn.products[p.id] !== undefined))

/** What the card view says of a product: its id, shown name and shape (store.ts CardView). */
export type Declared = { id: string; label?: string; shape: Shape }
export const record = (
  rules: Rules,
  node: Node,
  prev: Node | undefined,
  products: readonly Declared[] = [],
  whens: readonly (Cond | undefined)[] = [],
): Element[] => {
  const out: Element[] = fields(rules, node, prev, whens)
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
  const notes = node.turn.products.notes as string | readonly string[] | undefined // a list in libraries before #82
  const text = Array.isArray(notes) ? notes.join(" ") : (notes as string | undefined)
  if (text) out.push({ kind: "notes", text })
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

/** The player's line on a turn: the act's text, else the note; a greeting has none. */
export const lineOf = (node: Node): string => node.turn.input.text || node.turn.input.note || ""

/** Which channel a turn's input took (GLOSSARY §二 channel): an act, a note, both, or neither (the greeting). */
export const channelOf = (node: Node): "act" | "note" | "both" | "greeting" => {
  const { text, note } = node.turn.input
  return text && note ? "both" : text ? "act" : note ? "note" : "greeting"
}

/** A node's parent in the log; a root has none. */
export const parentOf = (log: L.Log<Node>, node: Node): Node | undefined =>
  node.parent === null ? undefined : log.nodes.get(node.parent)

/** A turn's versions: its parent's children in id order, where it stands among them, and whether they differ in the
 *  player's input (then a version is told apart by its line, otherwise by its prose). */
export const versions = (log: L.Log<Node>, node: Node): { list: Node[]; index: number; varied: boolean } => {
  const list = L.children(log, node.parent)
  return {
    list,
    index: list.findIndex((s) => s.id === node.id),
    varied: new Set(list.map((v) => `${v.turn.input.text}\n${v.turn.input.note}`)).size > 1,
  }
}

/** A turn's scene: its heading where it differs from its parent's (the first turn under a new title); else none. */
export const sceneOf = (ref: string | undefined, log: L.Log<Node>, node: Node): string | undefined => {
  const h = heading(ref, node)
  const p = parentOf(log, node)
  return h !== undefined && (!p || heading(ref, p) !== h) ? h : undefined
}
