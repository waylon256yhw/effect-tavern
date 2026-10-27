// The prose requirements as the Writing page edits them (the 文风与要求 tab), pure over the player layer: the per-card
// supplement is one tail fragment under a fixed id in `Player.forCard[card]` (the rest of that card's list, hand-written
// or imported, is left as it is); the global requirements are `Player.global` with text and position exposed, every
// other key of a fragment (mode, when, role, label) kept as the layer has it. A text cleared is the fragment removed.
import type { Fragment, Player } from "@effect-tavern/runtime/src/fragment.ts"

/** The per-card supplement's slot id: no card frame names it, so it meets nothing and `mode` is moot; `both` says so. */
export const EXTRA = "extra"
export type At = NonNullable<Fragment["at"]>

export const extraOf = (p: Player, card: string): string => p.forCard[card]?.find((f) => f.id === EXTRA)?.text ?? ""
export const withExtra = (p: Player, card: string, text: string): Player => {
  const { [card]: mine = [], ...others } = p.forCard
  const rest = mine.filter((f) => f.id !== EXTRA)
  const t = text.trim()
  const list = t ? [...rest, { id: EXTRA, at: "tail" as const, mode: "both" as const, text: t }] : rest
  return { ...p, forCard: list.length ? { ...others, [card]: list } : others }
}

/** Where a fragment goes: absent is the head (fragment.ts). */
export const atOf = (f: Fragment): At => f.at ?? "head"
export const addGlobal = (p: Player, id: string, text: string, at: At): Player =>
  text.trim() ? { ...p, global: [{ id, at, text: text.trim() }, ...p.global] } : p
export const removeGlobal = (p: Player, i: number): Player => ({ ...p, global: p.global.filter((_, j) => j !== i) })
export const setGlobalText = (p: Player, i: number, text: string): Player =>
  text.trim()
    ? { ...p, global: p.global.map((f, j) => (j === i ? { ...f, text: text.trim() } : f)) }
    : removeGlobal(p, i)
export const setGlobalAt = (p: Player, i: number, at: At): Player => ({
  ...p,
  global: p.global.map((f, j) => {
    if (j !== i) return f
    const { at: _at, ...rest } = f
    return at === "head" ? rest : { ...rest, at } // head is the absent default: the key leaves
  }),
})
