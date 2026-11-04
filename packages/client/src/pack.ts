// Pure helpers for 写作包 (`Pack`), 玩家侧小剧场 (`Theater`), and 代称 (`names` / `holes`):
// - `packHoles` and `withPackName` for the Settings → 写作包 editor;
// - `cardNameKeys`, `withCardName`, `orderedPacks`, `toggleMount`, `withTheater`, `withoutTheater` for the Writing page;
// - `fillKnown` for filling `{{key}}` holes from `cardView.names` when inserting a snippet or sending a turn;
// - `serializePack` for exporting a pack as a JSON file (an import is the server's decode of that file).
import type { Pack, Player, Theater } from "@effect-tavern/runtime/src/fragment.ts"
import { HOLE, holes } from "@effect-tavern/runtime/src/names.ts"

/** Fills every `{{key}}` that `names` has a value for, leaving any unfilled hole as written. */
export const fillKnown = (text: string, names?: Readonly<Record<string, string>>): string =>
  !names ? text : text.replace(HOLE, (raw, k: string) => (Object.hasOwn(names, k) ? names[k]! : raw))

export const packCount = (p: Pack): number =>
  (p.fragments?.length ?? 0) +
  (p.entries?.length ?? 0) +
  (p.lexicon?.length ?? 0) +
  (p.theaters?.length ?? 0) +
  (p.snippets?.length ?? 0)

/** The proper-noun holes in a pack's own texts, plus any keys already in `p.names` (excluding `user`). */
export const packHoles = (p: Pack): string[] => {
  const text = [
    ...(p.fragments ?? []).map((x) => x.text ?? ""),
    ...(p.entries ?? []).map((x) => x.text),
    ...(p.theaters ?? []).map((x) => x.text ?? ""),
    ...(p.snippets ?? []).flatMap((x) => [x.text, x.after ?? ""]),
  ].join("\n")
  const found = holes(text).filter((k) => k !== "user")
  for (const k of Object.keys(p.names ?? {})) if (k !== "user" && !found.includes(k)) found.push(k)
  return found
}

export const withPackName = (p: Pack, key: string, value: string): Pack => {
  const v = value.trim()
  const { [key]: _, ...rest } = p.names ?? {}
  const next = v ? { ...rest, [key]: v } : rest
  const { names: _n, ...base } = p
  return Object.keys(next).length ? { ...base, names: next } : base
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

export const withCardName = (p: Player, cardId: string, key: string, value: string): Player => {
  if (!cardId) return p
  const v = value.trim()
  const { [key]: _, ...restKey } = p.names?.[cardId] ?? {}
  const nextCard = v ? { ...restKey, [key]: v } : restKey
  const { [cardId]: _c, ...restCards } = p.names ?? {}
  const nextNames = Object.keys(nextCard).length ? { ...restCards, [cardId]: nextCard } : restCards
  const { names: _n, ...base } = p
  return Object.keys(nextNames).length ? { ...base, names: nextNames } : base
}

/** Mounted packs first (in their mount priority order), then the rest of the library. */
export const orderedPacks = (all: readonly Pack[], mountedIds: readonly string[] = []): Pack[] => {
  const byId = new Map(all.map((p) => [p.id, p]))
  const mounted = mountedIds.map((id) => byId.get(id)).filter((p): p is Pack => p !== undefined)
  const seen = new Set(mounted.map((p) => p.id))
  return [...mounted, ...all.filter((p) => !seen.has(p.id))]
}

export const toggleMount = (p: Player, cardId: string, packId: string): Player => {
  if (!cardId) return p
  const cur = p.packs?.[cardId] ?? []
  const nextCard = cur.includes(packId) ? cur.filter((id) => id !== packId) : [...cur, packId]
  const { [cardId]: _, ...restCards } = p.packs ?? {}
  const nextPacks = nextCard.length ? { ...restCards, [cardId]: nextCard } : restCards
  const { packs: _p, ...base } = p
  return Object.keys(nextPacks).length ? { ...base, packs: nextPacks } : base
}

export const withTheater = (list: readonly Theater[] | undefined, item: Theater): Theater[] => {
  const cur = list ?? []
  const idx = cur.findIndex((t) => t.id === item.id)
  return idx >= 0 ? cur.map((t, i) => (i === idx ? { ...t, ...item } : t)) : [...cur, item]
}

export const withoutTheater = (list: readonly Theater[] | undefined, id: string): Theater[] =>
  (list ?? []).filter((t) => t.id !== id)

/** The row without its id (JSON drops an undefined key): what an import sends back under a new id. */
export const serializePack = (p: Pack): string => JSON.stringify({ ...p, id: undefined }, null, 2) + "\n"
