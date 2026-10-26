// Model names: models.dev's models.json reduced to a display name and a family per `owner/model` key (the server's
// names.ts fetches and stores it, GET /models/names hands it to the client). Pricing, limits and capabilities are not
// read; the owner's per-model settings stay in `ModelEntry`.
export type Names = Readonly<Record<string, { name: string; family: string }>>
export interface Named {
  owner: string
  name: string
  family: string
}
const tail = (id: string) => id.slice(id.lastIndexOf("/") + 1)
/** A relay's model id in the table: as `owner/model`, else by its last path segment (`muse-spark-1.1` and
 *  `meta/muse-spark-1.1` hit the same key), else nothing (the caller falls back to the id itself). */
export const lookup = (names: Names, id: string): Named | undefined => {
  // ponytail: a scan of ~600 keys per miss; index by tail if a list ever reads thousands of ids
  const key = id in names ? id : Object.keys(names).find((k) => tail(k) === tail(id))
  return key === undefined ? undefined : { owner: key.slice(0, key.indexOf("/")), ...names[key]! }
}
