// The readings a client draws, as data: one pure projection per panel, one element kind per data shape
// (docs/client-design-brief-3.md §1). `record` is a turn's ledger: only what it changed, and its world products' new values. `status` is the
// full table at a node, grouped by the fields' `group`. Both choose a field's element the same way (`reading`): an enum
// is a step track, an int with both bounds a meter, anything else (an int bounded on one side, a number, a boolean) a
// value row, so no field is lost: that row is where a missing display declaration shows itself concretely. A meter is
// one of two by what its number means (runtime card.ts `drawn`, shared with `card check`): a gauge is a stock filled
// from min (hp 0..100), a scale is a point on an axis the card's fiction splits into stages (好感度 -30..100 with six
// bands); the cuts come from the bands' `when`, and the card's `view` overrides the guess.
// Beside the readings, the rest of what the chrome reads off a node, each its own pure function over the log, the card
// view or the node (review/architecture-review-2026-10-30.html card 4: one module, no eager node object): the field
// rows alone, the Status dot and the pill's yes/no (`fields`, `fieldChanged`, `marked`), a product's kind (`kindOf`), the input line and its channel, the parent,
// the versions, the scene.
import { drawn, type Check, type Field, type Rules, type State } from "@effect-tavern/runtime/src/card.ts"
import type { Cond } from "@effect-tavern/runtime/src/cond.ts"
import { kindOf, type Product, type Shape } from "@effect-tavern/runtime/src/product.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { TimelineNode as Node, TurnDetail } from "@effect-tavern/runtime/src/projection.ts"
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
  | { kind: "clue"; id: string; text: string }
  | {
      kind: "product"
      id: string
      label: string
      shape: Shape
      value: unknown
      change: "insert" | "patch" | "remove" | "replace"
    } // a world product's value this turn, drawn by its shape

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

/** Field deltas are computed on the server, including root initial values. */
export const fields = (rules: Rules, detail: TurnDetail, whens: readonly (Cond | undefined)[] = []): Element[] =>
  detail.fieldChanges.flatMap((c) => {
    const f = rules.fields.find((f) => f.path === c.path && !f.hidden)
    return f ? [reading(f, c.was, c.now, whens)] : []
  })
export const fieldChanged = (node: Node): boolean => node.changeSummary.fields > 0

/** Product presentation declarations carried by the card view. */
export type Declared = Pick<Product, "id" | "label" | "shape" | "fold" | "feed" | "recall" | "role" | "on" | "trigger">

/** A card's 小剧场: its theater products (`kindOf`) except `options`, which has its own container. */
export const theater = (products: readonly Declared[]) =>
  products.filter((p) => p.id !== "options" && kindOf(p) === "theater")

/** The 小剧场 a node can still be asked for (the `demand` action): theater, enabled on this card (`on !== false`), and
 *  not on the node yet; one asked for leaves the list as it lands. */
export const demandable = (
  products: readonly Declared[],
  node: Pick<Node, "theater">,
): { value: string; label: string }[] =>
  theater(products)
    .filter((p) => p.on !== false && node.theater[p.id] === undefined)
    .map((p) => ({ value: p.id, label: p.label ?? p.id }))

/** A product's kind (docs/theater-brief.md §1): one definition, the server's export reads it too. */
export { kindOf }

/** A value this turn: present, and not an empty list or table (`[]` is "no item this turn"); a text or record counts
 *  by presence. */
export const fresh = (v: unknown) => v !== undefined && !(Array.isArray(v) && v.length === 0)

/** A turn's ledger: what it changed (field rows, checks, clues delivered) and the world products' new values or
 *  rows. The model's chronicle (context) and the player's 小剧场 (theater) are not in it. */
export const record = (
  rules: Rules,
  detail: TurnDetail,
  products: readonly Declared[] = [],
  whens: readonly (Cond | undefined)[] = [],
): Element[] => {
  const out: Element[] = fields(rules, detail, whens)
  for (const check of detail.checks) out.push({ kind: "check", check })
  for (const d of detail.deliveries) out.push({ kind: "clue", id: d.resourceId, text: d.text })
  for (const c of detail.productChanges) {
    const p = products.find((p) => p.id === c.id)
    if (p) out.push({ kind: "product", ...c, label: p.label ?? c.id, shape: p.shape })
  }
  return out
}

/** Is the ledger non-empty: the one rule for drawing a turn's Record pill. */
export const marked = (node: Node): boolean => Object.values(node.changeSummary).some((n) => n > 0)

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
export const heading = (_ref: string | undefined, node: Node, _log?: L.Log<Node>): string | undefined => node.heading

/** The player's line on a turn: the act's text, else the note; a greeting has none. */
export const lineOf = (node: Node): string =>
  node.input.text || node.input.note || node.invocations.map((i) => i.title).join(" · ")

/** Which channel a turn's input took (GLOSSARY Channel): an act, a note, both, or neither (the greeting). */
export const channelOf = (node: Node): "act" | "note" | "both" | "invoke" | "greeting" => {
  const { text, note } = node.input
  return text && note ? "both" : text ? "act" : note ? "note" : node.invocations.length ? "invoke" : "greeting"
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
    varied: new Set(list.map((v) => JSON.stringify(v.input))).size > 1,
  }
}

/** A turn's scene: its heading where it differs from its parent's (the first turn under a new title); else none. */
export const sceneOf = (ref: string | undefined, log: L.Log<Node>, node: Node): string | undefined => {
  const h = heading(ref, node, log)
  const p = parentOf(log, node)
  return h !== undefined && (!p || heading(ref, p, log) !== h) ? h : undefined
}
