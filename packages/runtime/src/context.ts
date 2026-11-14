// Resource identity, immutable deliveries and request-local residency. Story unlocks are
// resolved by derived.ts; a lookup can only see this already-authorized resource set.
import type { State as Paths } from "./cond.ts"
import { holds } from "./cond.ts"
import type { Lore } from "./lore.ts"
import type { PackEntry } from "./layer.ts"
import { itemText, type Product } from "./product.ts"
import { worldValue, type WorldState } from "./world.ts"
import type { PlayerCatalogItem } from "./projection.ts"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { Schema } from "effect"
import { stageTool } from "@effect-tavern/provider/src/stage.ts"
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
  of?: string // a section's entry resource (`card:<entry>`); never frozen into the snapshot
}
export const revision = (value: unknown): string =>
  bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify(value, (_, v) =>
          v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(
                Object.keys(v)
                  .sort()
                  .map((k) => [k, v[k]]),
              )
            : v,
        ),
      ),
    ),
  )
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
/** An entry's sections, one resource each (docs/sections-brief.md §2): visible with the entry, read on demand only,
 *  never by the player, no disclosure. The entry's own resource stays loreResource's, byte for byte. */
export const sectionResources = (
  entry: ContextPolicy & { id: string; source?: "card" | "pack"; sections?: readonly { id: string; text: string }[] },
  depth: number,
): Resource[] => {
  const source = entry.source ?? "card"
  const p = policy(source, entry)
  return depth < 1
    ? []
    : (entry.sections ?? []).map((x) => ({
        resourceId: `${source}:${entry.id}#${x.id}`,
        revision: revision({ text: x.text }),
        title: hook(x.text),
        text: x.text,
        source,
        access: { model: p.access.model, player: false },
        activation: "on_demand",
        residency: p.residency,
        disclosures: [],
        of: `${source}:${entry.id}`,
      }))
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
export const catalogEntry = (r: Resource): PlayerCatalogItem => ({
  resourceId: r.resourceId,
  title: r.title.slice(0, 160),
  summary: (r.text.slice(r.title.length).trim() || r.title).replace(/\s+/g, " ").slice(0, 240),
  category: r.source === "pack" ? r.resourceId.slice(5).split("/")[0]! : "card",
  source: r.source,
  available: true,
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
// Whole chunks between spaces and punctuation; a CJK chunk found nowhere (an unspaced phrase such as 拉毗的过去) falls
// back to its character bigrams. No word segmenter: ICU splits unknown names into single characters.
const termsOf = (q: string, haystacks: readonly string[]) => [
  ...new Set(
    q
      .toLowerCase()
      .split(/[\p{P}\p{Z}\s]+/u)
      .filter(Boolean)
      .flatMap((c) => {
        const cs = Array.from(c)
        const unmatched = /\p{Script=Han}/u.test(c) && cs.length > 2 && !haystacks.some((h) => h.includes(c))
        return unmatched ? cs.slice(1).map((ch, i) => cs[i]! + ch) : [c]
      }),
  ),
]
const count = (h: string, t: string) => h.split(t).length - 1

/** A catalog line: an entry by id and title (its hook; never a second cut of its text), `resident` when only its unread
 *  sections, listed under it, are left to read. */
export interface Unit {
  resourceId: string
  title: string
  resident?: boolean
  sections?: readonly { resourceId: string; title: string }[]
}
/** What lookup can read this turn, computed once by the host for both readers (#168): the whole pool when it fits
 *  (`complete`), else the count by source and the top 8 of `search` over the input. */
export type Catalog =
  | { complete: true; units: Unit[] }
  | { complete: false; counts: Partial<Record<Source, number>>; matched: Unit[] }
// ponytail: decision-lookup.ts readings (#168): 227 questions fit one decision request (~84 input tokens each), so a
// unit count in the low hundreds; and a directory bound that keeps lookup's first request under the 16000 characters
// test/lookup.ts holds a 2000-entry catalog to (a chat-card request at this bound: ~13000). Raise both against the
// instrument, not by feel.
export const CATALOG_UNITS = 256
export const CATALOG_CHARS = 10000
const lineOf = (u: Unit) =>
  [
    `${u.resourceId} ${u.title}${u.resident ? " (resident: sections only)" : ""}`,
    ...(u.sections ?? []).map((x) => `  ${x.resourceId} ${x.title}`),
  ].join("\n")
/** The catalog as the LLM loop's first request reads it (and `card view --stage lookup`). */
export const catalogBlock = (c: Catalog) =>
  c.complete
    ? [`Available (${c.units.length}, complete):`, ...c.units.map(lineOf)].join("\n")
    : [
        `Available (${Object.values(c.counts).reduce((n, x) => n + x, 0)}): ${Object.entries(c.counts)
          .map(([s, n]) => `${s} ${n}`)
          .join(", ")}`,
        ...(c.matched.length ? ["Matching <input>:", ...c.matched.map(lineOf)] : []),
      ].join("\n")

export const contextLookup = (resources: readonly Resource[], injected: readonly DeliverySnapshot[]) => {
  const held = new Map(injected.map((s) => [s.resourceId, s]))
  const delivered: DeliverySnapshot[] = []
  const disclosures: Disclosure[] = []
  const unheld = (r: Resource) => held.get(r.resourceId)?.revision !== r.revision
  const open = (r: Resource) => r.access.model && r.activation === "on_demand"
  /** An entry's sections not in this request: its directory, on the lookup side only (§3), never in a snapshot. */
  const sectionsOf = (id: string) => resources.filter((x) => x.of === id && open(x) && unheld(x))
  const directory = (xs: readonly Resource[]) =>
    xs.map((x) => ({ resourceId: x.resourceId, title: x.title.slice(0, 160) }))
  /** The search units: an entry (never a section) whose own face is unread, or that still has an unread section. */
  const readable = () =>
    resources.filter((r) => !r.of && r.access.model && ((open(r) && unheld(r)) || sectionsOf(r.resourceId).length))
  const search = (query: string, scope: "all" | Source = "all") => {
    const pool = readable()
      .filter((r) => scope === "all" || r.source === scope)
      .map((r) => {
        const sections = sectionsOf(r.resourceId)
        return {
          r,
          sections,
          name: r.resourceId.toLowerCase().replace(/^.*[:/]/, ""),
          anchor: `${r.resourceId}\n${r.title}`.toLowerCase(),
          // a resident face is already in the request: only its name and its unread sections can match
          text: [...(unheld(r) ? [r.text] : []), ...sections.map((x) => x.text)].join("\n").toLowerCase(),
        }
      })
    const terms = termsOf(
      query,
      pool.flatMap((x) => [x.anchor, x.text]),
    )
    // ponytail: substring match ranked by zone (anchor terms, id prefixes, body terms, body occurrences), no BM25 or
    // embeddings; upgrade when a card outgrows it (thousands of entries, or names that are substrings of common words).
    const score = ({ name, anchor, text }: (typeof pool)[number]) => [
      terms.filter((t) => anchor.includes(t)).length,
      terms.filter((t) => name.startsWith(t)).length,
      terms.filter((t) => text.includes(t)).length,
      terms.reduce((n, t) => n + count(text, t), 0),
    ]
    const hit = (x: Resource) => terms.some((t) => x.text.toLowerCase().includes(t))
    return pool
      .map((x) => ({ ...x, s: score(x) }))
      .filter(({ s }) => s[0]! + s[2]! > 0)
      .sort((a, b) => b.s.reduce((d, n, i) => d || n - a.s[i]!, 0))
      .slice(0, 8)
      .map(({ r, sections }) => ({
        title: r.title.slice(0, 160),
        source: r.source,
        resourceId: r.resourceId,
        revision: r.revision,
        ...(held.has(r.resourceId) && unheld(r) ? { supersedes: held.get(r.resourceId)!.revision } : {}),
        ...(unheld(r) ? {} : { resident: true }), // only its sections are left to read
        // ponytail: every unread section, bounded by lint's 8 per entry; page them when an entry may hold more
        ...(sections.length
          ? { sections: directory([...sections.filter(hit), ...sections.filter((x) => !hit(x))]) }
          : {}),
      }))
  }
  /** A told snapshot as lookup reads it: narrate's line, then the entry's unread sections, if any. */
  const told = (s: DeliverySnapshot) => {
    const xs = sectionsOf(s.resourceId)
    return xs.length
      ? `${deliveryText(s)}\nSections (read_context): ${directory(xs)
          .map((x) => `${x.resourceId} ${x.title}`)
          .join(" | ")}`
      : deliveryText(s)
  }
  /** Deliver up to 8 resources: read_context's handler, and the host's on the decision path (session.ts lookup). */
  const read = (refs: readonly string[]) => {
    const ids = [...new Set(refs)]
    const selected: Resource[] = []
    for (const id of ids) {
      const r = resources.find((r) => r.resourceId === id && open(r))
      if (!r)
        return {
          ok: false as const,
          code: "unavailable_resource",
          message: `${id}: unavailable; search for accessible resources.`,
        }
      // A section supplements its entry, never goes on alone: an entry not in the request comes first (§3).
      const face = r.of === undefined ? undefined : resources.find((x) => x.resourceId === r.of)
      if (face && unheld(face) && !ids.includes(face.resourceId) && !selected.includes(face)) selected.push(face)
      selected.push(r)
    }
    if (selected.length > 8)
      return {
        ok: false as const,
        code: "too_many_refs",
        message: "Read at most 8 resources per call; a section's entry counts when it is not resident.",
      }
    const results = selected.map((r) => {
      const previous = held.get(r.resourceId)
      if (previous?.revision === r.revision) return { resourceId: r.resourceId, revision: r.revision, resident: true }
      const snapshot = freeze(r, previous)
      held.set(r.resourceId, snapshot)
      delivered.push(snapshot)
      disclosures.push(...r.disclosures)
      return snapshot
    })
    // an entry's unread sections ride on its result, after the whole call, never on the frozen snapshot
    return {
      ok: true as const,
      value: results.map((x) => {
        const xs = sectionsOf(x.resourceId)
        return xs.length ? { ...x, sections: directory(xs) } : x
      }),
    }
  }
  /** The catalog view of this request (`Catalog`); `query` is the input, matched only when the pool does not fit. */
  /** The readable entries as catalog lines (`Unit`), whatever their number. */
  const units = (): Unit[] =>
    readable().map((r) => {
      const xs = sectionsOf(r.resourceId)
      return {
        resourceId: r.resourceId,
        title: r.title.slice(0, 160),
        ...(unheld(r) ? {} : { resident: true as const }),
        ...(xs.length ? { sections: directory(xs) } : {}),
      }
    })
  const catalog = (query: string): Catalog => {
    const pool = readable()
    const all = units()
    const n = all.reduce((n, u) => n + (u.resident ? 0 : 1) + (u.sections?.length ?? 0), 0)
    if (n <= CATALOG_UNITS && all.map(lineOf).join("\n").length <= CATALOG_CHARS) return { complete: true, units: all }
    const counts: Partial<Record<Source, number>> = {}
    for (const r of pool) counts[r.source] = (counts[r.source] ?? 0) + 1
    return { complete: false, counts, matched: query.trim() ? search(query) : [] }
  }
  const tools = {
    search_context: stageTool(
      Schema.Struct({ query: Schema.String, scope: Schema.optionalKey(Scope) }),
      "Search unlocked, model-readable context not listed in full above. Pass space-separated keywords in Chinese or English (names, places, topics), not a sentence. Returns at most 8 summaries, excluding resident revisions. An entry may list `sections` (deeper text, read by their resourceId); `resident: true` means only its sections are left to read.",
      async ({ query, scope }) => ({ ok: true, value: search(query, scope) }),
    ),
    read_context: stageTool(
      Schema.Struct({ refs: Schema.Array(Schema.String) }),
      "Read up to 8 resource IDs, as listed under Available or returned by search_context. Full frozen snapshots are delivered to the narrator. Already resident revisions need no repeat read. A result's `sections` are its entry's deeper text, read only when the turn needs them.",
      async ({ refs }) => read(refs),
    ),
  }
  return { tools, readable, units, search, catalog, read, told, delivered, disclosures }
}

/** Materialize unlocked lore, pack entries and recalled rows before applying reader permissions. */
export const resourcesAt = ({
  lore: I,
  state: s,
  seen,
  packs,
  products,
  chronicle = {},
}: {
  lore: Lore<Paths, readonly string[]>
  state: WorldState & Paths
  seen: readonly Disclosure[]
  packs: readonly PackEntry[]
  products: readonly Product[]
  chronicle?: Record<string, unknown>
}): Resource[] => {
  const entries: Resource[] = I.entries.flatMap((e) => {
    const depth = I.current(e, s, seen)
    if (!depth) return []
    return [loreResource(e, depth), ...sectionResources(e, depth)]
  })
  entries.push(...packs.map((e) => loreResource({ ...e, source: "pack", layers: [e.text] }, 1)))
  const ps = products.filter((p) => p.on && p.recall !== undefined)
  const memory: Resource[] = ps.flatMap((p) => {
    const value = p.role === "world" ? worldValue(p, s.world[p.id]) : chronicle[p.id]
    if (!Array.isArray(value)) return []
    return value.flatMap((item): Resource[] => {
      if (p.shape.kind === "table" && p.shape.filter && !holds(p.shape.filter, item)) return []
      const identity =
        p.role === "world" && p.shape.kind === "table"
          ? item.entityId
          : typeof p.fold === "object"
            ? item[p.fold.key]
            : revision(item)
      const text = itemText(item)
      return [
        {
          resourceId: `memory:${p.id}/${encodeURIComponent(String(identity))}`,
          revision: revision(item),
          title: p.shape.kind === "table" ? String(item[p.recall as string]) : String(item),
          text,
          source: "memory",
          ...policy("memory"),
          product: p.id,
          disclosures: [],
        },
      ]
    })
  })
  return [...new Map([...entries, ...memory].map((r) => [r.resourceId, r])).values()]
}

/** Feed rows are already held through Current, so lookup does not ask for them again. */
export const fedResources = (resources: readonly Resource[], products: readonly Product[]) =>
  resources.filter((r) => r.product && products.some((p) => p.id === r.product && p.id !== "notes" && p.on && p.feed))
