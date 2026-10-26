// Model names: models.dev's models.json reduced to a display name and a family per `owner/model` key (the server's
// names.ts fetches and stores it, GET /models/names hands it to the client). Pricing, limits and capabilities are not
// read; the owner's per-model settings stay in `ModelEntry`.
export type Names = Readonly<Record<string, { name: string; family: string }>>
export interface Named {
  owner: string
  name: string
  family: string
}
/** An id's last path segment, normalized the way relays vary it: case, `:tag` suffixes (an `:8b` size kept), a
 *  `-latest` tail, `3.7` for `3-7`, `_` for `-`. */
const clean = (s: string) =>
  s
    .slice(s.lastIndexOf("/") + 1)
    .toLowerCase()
    .replace(/:(\d+b)\b/, "-$1")
    .replace(/:.*$/, "")
    .replace(/-latest$/, "")
    .replace(/(\d)\.(\d)/g, "$1-$2")
    .replaceAll("_", "-")
const stripDate = (s: string) => s.replace(/-(?:20\d{6}|\d{4}-\d{2}-\d{2})$/, "")
const cache = new WeakMap<Names, Map<string, Named>>()
/** The table by normalized id, built once per table: exact keys first, then date-stripped aliases only where no exact
 *  key holds the name (`gpt-4o-2024-11-20` keeps its own entry, `claude-3.7-sonnet` falls to the dated one). */
const index = (names: Names) => {
  let map = cache.get(names)
  if (map) return map
  map = new Map()
  const entry = (k: string, v: { name: string; family: string }): Named => ({
    owner: k.slice(0, k.indexOf("/")),
    name: v.name.replace(/ \(latest\)$/i, ""),
    family: v.family,
  })
  for (const [k, v] of Object.entries(names)) map.set(clean(k), entry(k, v))
  for (const [k, v] of Object.entries(names)) {
    const b = stripDate(clean(k))
    if (!map.has(b)) map.set(b, entry(k, v))
  }
  cache.set(names, map)
  return map
}
/** A relay's model id in the table, by its normalized last path segment (`muse-spark-1.1`, `meta/muse-spark-1.1` and
 *  `deepseek-ai/DeepSeek-V3` all hit), then without a date tail, else nothing (the caller falls back to the id). */
export const lookup = (names: Names, id: string): Named | undefined => {
  const m = index(names)
  const c = clean(id)
  return m.get(c) ?? m.get(stripDate(c))
}
