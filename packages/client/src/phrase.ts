// Declared rules as phrases: a condition, an effect, a chance, in the words a player reads on the card page (and an
// author edits by, later, in the workbench). The declarations are unsettled: no state, no before and after (that is
// record.ts). Paths show by their field label, events by their name. Pure: no Solid, no DOM.
import type { Chance, Effect_, Rules } from "@effect-tavern/runtime/src/card.ts"
import type { Cond } from "@effect-tavern/runtime/src/cond.ts"

export type Label = (path: string) => string
/** Field labels by path, from the rules; a path with no field shows as itself. */
export const labels = (rules: Rules): Label => {
  const m = new Map(rules.fields.map((f) => [f.path, f.label ?? f.path]))
  return (p) => m.get(p) ?? p
}
const OP = { lt: "<", lte: "≤", gt: ">", gte: "≥" } as const
const scalar = (v: string | number | boolean) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v))

/** `体力 = 0 or 敌手 = 0`; an empty `all` is always, an empty `any` never (a lore entry's "never unlocks"). */
export const cond = (c: Cond, by: Label, nested = false): string => {
  if ("all" in c || "any" in c) {
    const [list, word] = "all" in c ? [c.all, " and "] : [c.any, " or "]
    if (list.length === 0) return "all" in c ? "always" : "never"
    const s = list.map((x) => cond(x, by, true)).join(word)
    return nested && list.length > 1 ? `(${s})` : s
  }
  if ("not" in c) return `not ${cond(c.not, by, true)}`
  if ("event" in c) return `on ${c.event}`
  if ("is" in c)
    return typeof c.is === "boolean" ? (c.is ? by(c.path) : `not ${by(c.path)}`) : `${by(c.path)} = ${c.is}`
  return `${by(c.path)} ${OP[c.op]} ${c.value}`
}
/** `敌手 −10`, `起点 = 血案`, `event strike:hit` (a page decides whether an event name is for its reader). */
export const effect = (e: typeof Effect_.Type, by: Label): string =>
  "event" in e
    ? `event ${e.event}`
    : "set" in e
      ? `${by(e.path)} = ${scalar(e.set)}`
      : typeof e.add === "number"
        ? `${by(e.path)} ${e.add < 0 ? "−" : "+"}${Math.abs(e.add)}`
        : `${by(e.path)} + ${by(e.add.path)}`
/** `60%`, `by 体力`, or `judged` (the model names the odds inside decide; the question is detail). */
export const chance = (c: typeof Chance.Type, by: Label): string =>
  typeof c === "number" ? `${Math.round(c * 100)}%` : "judge" in c ? "judged" : `by ${by(c.path)}`
