// Resource identity, immutable deliveries and request-local residency. Story unlocks are
// resolved by derived.ts; a lookup can only see this already-authorized resource set.
import { createHash } from "node:crypto"
import { Schema } from "effect"
import { stageTool } from "@effect-tavern/provider"
import { hook, type Disclosure, type ContextPolicy } from "./lore.ts"

export type Source = "card" | "pack" | "memory"
export interface DeliverySnapshot {
  readonly resourceId: string
  readonly revision: string
  readonly title: string
  readonly text: string
  readonly source: Source
  readonly residency: "permanent" | "window" | "turn"
  readonly superseded?: string
}
export interface Resource extends DeliverySnapshot {
  access: { model: boolean; player: boolean }
  activation: "always" | "on_demand"
  disclosures: readonly Disclosure[]
  product?: string
}
export interface CatalogEntry {
  id: string
  title: string
  hook: string
  source: Source
}
export const revision = (value: unknown): string =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_, v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, v[k]]),
            )
          : v,
      ),
    )
    .digest("hex")
export const policy = (source: Source, p: ContextPolicy = {}) => ({
  access: p.access ?? { model: true, player: source === "pack" },
  activation: p.activation ?? "on_demand",
  residency: p.residency ?? "window",
})
export const loreResource = (
  entry: ContextPolicy & { id: string; source?: "card" | "pack"; layers: readonly string[] },
  depth: number,
): Resource => {
  const source = entry.source ?? "card"
  const text = entry.layers.slice(0, depth).join("\n\n")
  return {
    resourceId: `${source}:${entry.id}`,
    revision: revision({ text, depth }),
    title: hook(entry.layers[0]!),
    text,
    source,
    ...policy(source, entry),
    disclosures: source === "card" ? Array.from({ length: depth }, (_, i) => ({ id: entry.id, layer: i + 1 })) : [],
  }
}
/** Preserve every delivered version in the journal, while request assembly selects the latest. */
export const uniqueDeliveries = (snapshots: readonly DeliverySnapshot[]) => [
  ...new Map(snapshots.map((s) => [`${s.resourceId}#${s.revision}`, s])).values(),
]

export const freeze = (r: Resource, previous?: DeliverySnapshot): DeliverySnapshot => ({
  resourceId: r.resourceId,
  revision: r.revision,
  title: r.title,
  text: r.text,
  source: r.source,
  residency: r.residency,
  ...(previous && previous.revision !== r.revision ? { superseded: previous.revision } : {}),
})
export const catalogEntry = (r: Resource): CatalogEntry => ({
  id: r.resourceId,
  title: r.title.slice(0, 160),
  hook: r.title.slice(0, 160),
  source: r.source,
})
/** The latest actually injected snapshot per identity; a logical ID alone never means resident. */
export const latest = (snapshots: readonly DeliverySnapshot[]) => [
  ...new Map(snapshots.map((s) => [s.resourceId, s])).values(),
]
export const deliveryText = (s: DeliverySnapshot) =>
  `[${s.resourceId} revision=${s.revision}${s.superseded ? ` supersedes=${s.superseded}` : ""}] ${s.title}\n${s.text}`
/** Both narrator and lookup inject this same set. Permanent survives the window, turn never does. */
export const residentOn = (
  path: readonly { deliveries: readonly DeliverySnapshot[] }[],
  start: number,
): DeliverySnapshot[] =>
  latest(
    path.flatMap((t, i) =>
      t.deliveries.filter((d) => d.residency === "permanent" || (d.residency === "window" && i >= start)),
    ),
  )

const Scope = Schema.Literals(["all", "card", "pack", "memory"])
const segmenter = new Intl.Segmenter("zh", { granularity: "word" })
const termsOf = (q: string) => [
  ...new Set([...segmenter.segment(q.toLowerCase())].filter((s) => s.isWordLike).map((s) => s.segment)),
]

export const contextLookup = (resources: readonly Resource[], injected: readonly DeliverySnapshot[]) => {
  const held = new Map(injected.map((s) => [s.resourceId, s]))
  const delivered: DeliverySnapshot[] = []
  const disclosures: Disclosure[] = []
  const readable = () =>
    resources.filter(
      (r) => r.access.model && r.activation === "on_demand" && held.get(r.resourceId)?.revision !== r.revision,
    )
  const search = (query: string, scope: "all" | Source = "all") => {
    const terms = termsOf(query)
    if (!terms.length) return []
    return readable()
      .filter((r) => scope === "all" || r.source === scope)
      .map((r) => ({
        r,
        score: terms.reduce(
          (n, t) => n + Number(`${r.resourceId}\n${r.title}\n${r.text}`.toLowerCase().includes(t)),
          0,
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ r }) => ({
        title: r.title.slice(0, 160),
        source: r.source,
        resourceId: r.resourceId,
        revision: r.revision,
        ...(held.has(r.resourceId) ? { supersedes: held.get(r.resourceId)!.revision } : {}),
      }))
  }
  const tools = {
    search_context: stageTool(
      Schema.Struct({ query: Schema.String, scope: Schema.optionalKey(Scope) }),
      "Search unlocked, model-readable context by Chinese or English terms. Returns at most 8 summaries, excluding resident revisions. Read their resourceId to get full text; search again using facts you discover.",
      async ({ query, scope }) => ({ ok: true, value: search(query, scope) }),
    ),
    read_context: stageTool(
      Schema.Struct({ refs: Schema.Array(Schema.String) }),
      "Read up to 8 resource IDs returned by search_context. Full frozen snapshots are delivered to the narrator. Already resident revisions need no repeat read.",
      async ({ refs }) => {
        const ids = [...new Set(refs)]
        if (ids.length > 8) return { ok: false, code: "too_many_refs", message: "Read at most 8 resources per call." }
        const selected: Resource[] = []
        for (const id of ids) {
          const r = resources.find((r) => r.resourceId === id && r.access.model && r.activation === "on_demand")
          if (!r)
            return {
              ok: false,
              code: "unavailable_resource",
              message: `${id}: unavailable; search for accessible resources.`,
            }
          selected.push(r)
        }
        const results = selected.map((r) => {
          const previous = held.get(r.resourceId)
          if (previous?.revision === r.revision)
            return { resourceId: r.resourceId, revision: r.revision, resident: true }
          const snapshot = freeze(r, previous)
          held.set(r.resourceId, snapshot)
          delivered.push(snapshot)
          disclosures.push(...r.disclosures)
          return snapshot
        })
        return { ok: true, value: results }
      },
    ),
  }
  return { tools, readable, search, delivered, disclosures }
}
