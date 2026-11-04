// Pure helpers for `Layer` and `Local` rows (Settings → 写作包 and the Writing page):
// - `packHoles` and `withPackName` for proper-noun defaults on any row (`Layer` or `Local`);
// - `cardNameKeys`, `orderedPacks`, `toggleMount`, `withProductPatch`, `withoutProductPatch` for the Writing page;
// - `fillKnown` for filling `{{key}}` holes from `cardView.layer.names` when inserting a snippet or sending a turn;
// - `serializePack` for exporting a pack as a JSON file (an import is the server's decode of that file).
import type { Layer, Local } from "@effect-tavern/runtime/src/layer.ts"
import { HOLE, holes } from "@effect-tavern/runtime/src/names.ts"
import type { ProductPatch } from "@effect-tavern/runtime/src/product.ts"

/** Fills every `{{key}}` that `names` has a value for, leaving any unfilled hole as written. */
export const fillKnown = (text: string, names?: Readonly<Record<string, string>>): string =>
  !names ? text : text.replace(HOLE, (raw, k: string) => (Object.hasOwn(names, k) ? names[k]! : raw))

/** `harness` is a fixed rank in `GET /packs`, not a user-deletable or card-mounted pack. */
export const isReservedPack = (id: string): boolean => id === "harness"

/** The proper-noun holes in a row's own texts, plus any keys already in `p.names` (excluding `user`). */
export const packHoles = (p: Partial<Layer>): string[] => {
  const text = [
    ...(p.fragments ?? []).map((x) => x.text ?? ""),
    ...(p.entries ?? []).map((x) => x.text),
    ...(p.asks ?? []).map((x) => x.text),
    ...(p.products ?? []).map((x) => x.text ?? ""),
    ...(p.snippets ?? []).flatMap((x) => [x.text, x.after ?? ""]),
  ].join("\n")
  const found = holes(text).filter((k) => k !== "user")
  for (const k of Object.keys(p.names ?? {})) if (k !== "user" && !found.includes(k)) found.push(k)
  return found
}

export const withPackName = <R extends Layer>(p: R, key: string, value: string): R => {
  const v = value.trim()
  const { [key]: _, ...rest } = p.names ?? {}
  const next = v ? { ...rest, [key]: v } : rest
  const { names: _n, ...base } = p
  return (Object.keys(next).length ? { ...base, names: next } : base) as R
}

/** The proper-noun keys shown on the Writing page: `holes ∪ (Object.keys(names) \ {"user"})`, strictly from `GET /card`. */
export const cardNameKeys = (
  unfilledHoles: readonly string[] | undefined,
  mergedNames: Readonly<Record<string, string>> | undefined,
): string[] => {
  const hs = (unfilledHoles ?? []).filter((k) => k !== "user")
  const filled = Object.keys(mergedNames ?? {}).filter((k) => k !== "user" && !hs.includes(k))
  return [...hs, ...filled]
}

/** Mountable user packs (`all` excluding `harness`): mounted first in their mount order, then the rest. */
export const orderedPacks = (all: readonly Layer[], mountedIds: readonly string[] = []): Layer[] => {
  const pool = all.filter((p) => !isReservedPack(p.id))
  const byId = new Map(pool.map((p) => [p.id, p]))
  const mounted = mountedIds.map((id) => byId.get(id)).filter((p): p is Layer => p !== undefined)
  const seen = new Set(mounted.map((p) => p.id))
  return [...mounted, ...pool.filter((p) => !seen.has(p.id))]
}

export const toggleMount = (l: Local, packId: string): Local => {
  const cur = l.mounts ?? []
  const next = cur.includes(packId) ? cur.filter((id) => id !== packId) : [...cur, packId]
  const { mounts: _, ...rest } = l
  return next.length ? { ...rest, mounts: next } : rest
}

export const withProductPatch = (list: readonly ProductPatch[] | undefined, item: ProductPatch): ProductPatch[] => {
  const cur = list ?? []
  const idx = cur.findIndex((p) => p.id === item.id)
  return idx >= 0 ? cur.map((p, i) => (i === idx ? { ...p, ...item } : p)) : [...cur, item]
}

export const withoutProductPatch = (list: readonly ProductPatch[] | undefined, id: string): ProductPatch[] =>
  (list ?? []).filter((p) => p.id !== id)

/** 恢复默认 on a player's row: the patch for `id` loses its label and text and keeps its `on`; left with only its id, it goes. */
export const withoutProductText = (list: readonly ProductPatch[] | undefined, id: string): ProductPatch[] =>
  (list ?? []).flatMap((p) => {
    if (p.id !== id) return [p]
    const { label: _l, text: _t, ...rest } = p
    return Object.keys(rest).length > 1 ? [rest] : []
  })

/** What the Writing page's product dialog saves: only a label or text that is non-empty and not what is shown (a card's
 *  item shows no text, so any typed text goes); no `shown` is a new 小剧场, which needs text and starts off; nothing
 *  changed is undefined. */
export const productEdit = (
  shown: { id: string; label?: string; text?: string } | undefined,
  id: string,
  label: string,
  text: string,
): ProductPatch | undefined => {
  const l = label.trim()
  const x = text.trim()
  const patch = {
    ...(l && l !== (shown?.label ?? shown?.id) && { label: l }),
    ...(x && x !== shown?.text && { text: x }),
  }
  if (!shown) return x ? { id, ...patch, on: false } : undefined
  return Object.keys(patch).length ? { id, ...patch } : undefined
}

/** The row without its id (JSON drops an undefined key): what an import sends back under a new id. */
export const serializePack = (p: Layer): string => JSON.stringify({ ...p, id: undefined }, null, 2) + "\n"
