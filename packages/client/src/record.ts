// The Record sheet's data: one pure projection of (rules, node, the node before it) into the elements the sheet draws,
// one kind per data shape (docs/client-design-brief-3.md §1). Only what this turn changed or produced is emitted. A
// changed field with no drawable shape (an int bounded on one side, a number, a boolean) falls back to `value`, so no
// change is lost: that row is where the display-declaration gap shows itself concretely.
import type { Check, Rules, State } from "@effect-tavern/runtime/src/card.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"

export type Element =
  | { kind: "steps"; path: string; options: readonly string[]; was: number; now: number } // enum: indexes into options
  | { kind: "meter"; path: string; min: number; max: number; was: number; now: number } // int with both bounds
  | { kind: "value"; path: string; was: State[string]; now: State[string] } // any other change
  | { kind: "check"; check: Check }
  | { kind: "clue"; id: string; text: string; pinnable: boolean } // pinnable: a deeper layer is still untold
  | { kind: "notes"; items: readonly string[] }

export const record = (rules: Rules, node: Node, prev: Node | undefined): Element[] => {
  const before: State = prev?.state ?? Object.fromEntries(rules.fields.map((f) => [f.path, f.initial]))
  const out: Element[] = []
  for (const f of rules.fields) {
    const was = before[f.path]!
    const now = node.state[f.path]!
    if (was === now) continue
    if (f.type === "enum" && f.options)
      out.push({
        kind: "steps",
        path: f.path,
        options: f.options,
        was: f.options.indexOf(String(was)),
        now: f.options.indexOf(String(now)),
      })
    else if (f.type === "int" && f.min !== undefined && f.max !== undefined)
      out.push({ kind: "meter", path: f.path, min: f.min, max: f.max, was: Number(was), now: Number(now) })
    else out.push({ kind: "value", path: f.path, was, now })
  }
  for (const check of node.checks) out.push({ kind: "check", check })
  const untold = new Set(node.readable.map((r) => r.id))
  for (const d of node.delivered) out.push({ kind: "clue", id: d.id, text: d.text, pinnable: untold.has(d.id) })
  const notes = node.turn.products.notes as readonly string[] | undefined
  if (notes?.length) out.push({ kind: "notes", items: notes })
  return out
}
