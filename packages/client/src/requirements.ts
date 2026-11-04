// The prose requirements as the Writing page and Settings → 写作包 edit them, pure over a `Layer` / `Local` row: the
// per-card supplement is one tail fragment under a fixed id (`extra`) in `Local.fragments` (the rest of the row's list
// is left as it is); a row's `fragments` list exposes text, position (`at`), slot (`id`) and `mode`. A text cleared is
// the fragment removed.
import type { Fragment } from "@effect-tavern/runtime/src/fragment.ts"
import type { Layer } from "@effect-tavern/runtime/src/layer.ts"

/** The per-card supplement's slot id: no card frame names it, so it meets nothing and `mode` is moot; `both` says so. */
export const EXTRA = "extra"
export type At = NonNullable<Fragment["at"]>

export const extraOf = (r: Partial<Layer> | undefined): string => r?.fragments?.find((f) => f.id === EXTRA)?.text ?? ""
export const withExtra = <R extends Layer>(r: R, text: string): R => {
  const rest = (r.fragments ?? []).filter((f) => f.id !== EXTRA)
  const t = text.trim()
  const list = t ? [...rest, { id: EXTRA, at: "tail" as const, mode: "both" as const, text: t }] : rest
  const { fragments: _, ...base } = r
  return (list.length ? { ...base, fragments: list } : base) as R
}

/** Where a fragment goes: absent is the head (fragment.ts). */
export const atOf = (f: Fragment): At => f.at ?? "head"
const withFragments = <R extends Layer>(r: R, list: readonly Fragment[]): R => {
  const { fragments: _, ...base } = r
  return (list.length ? { ...base, fragments: list } : base) as R
}
export const addFragment = <R extends Layer>(r: R, id: string, text: string, at: At): R =>
  text.trim()
    ? withFragments(r, [
        { id, ...(at === "tail" ? { at: "tail" as const } : {}), text: text.trim() },
        ...(r.fragments ?? []),
      ])
    : r
export const removeFragment = <R extends Layer>(r: R, i: number): R =>
  withFragments(
    r,
    (r.fragments ?? []).filter((_, j) => j !== i),
  )
export const setFragmentText = <R extends Layer>(r: R, i: number, text: string): R =>
  text.trim()
    ? withFragments(
        r,
        (r.fragments ?? []).map((f, j) => (j === i ? { ...f, text: text.trim() } : f)),
      )
    : removeFragment(r, i)
export const setFragmentAt = <R extends Layer>(r: R, i: number, at: At): R =>
  withFragments(
    r,
    (r.fragments ?? []).map((f, j) => {
      if (j !== i) return f
      const { at: _at, ...rest } = f
      return at === "head" ? rest : { ...rest, at } // head is the absent default: the key leaves
    }),
  )
