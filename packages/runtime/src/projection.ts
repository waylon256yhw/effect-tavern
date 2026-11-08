// Public read contracts. The journal and complete path state never travel with a timeline.
import type { Beat, Check, Rules, State } from "./card.ts"
import type { DeliverySnapshot, Source } from "./context.ts"
import type { Node } from "./derived.ts"
import type { Turn } from "./journal.ts"
import type { Product } from "./product.ts"
import type { DomainChange, WorldState } from "./world.ts"
import type { Event } from "./session.ts"
import type { Change } from "./log.ts"

export interface InvocationToken {
  resourceId: string
  title: string
  source: Source
}
export interface PlayerCatalogItem extends InvocationToken {
  category: string
  summary: string
  available: boolean
}
export interface TimelineNode {
  id: number
  parent: number | null
  input: Turn<Beat>["input"]
  invocations: readonly InvocationToken[]
  prose: string
  theater: Record<string, unknown>
  heading?: string
  end: Turn<Beat>["end"]
  sibling?: Turn<Beat>["sibling"]
  settlementStatus: Turn<Beat>["settlementStatus"]
  settlementError?: string
  deliverySummary: readonly Omit<DeliverySnapshot, "text" | "residency" | "superseded">[]
  changeSummary: { fields: number; checks: number; deliveries: number; products: number }
}
export interface ProductChange {
  id: string
  change: "insert" | "patch" | "remove" | "replace"
  value: unknown
}
export interface TurnDetail {
  id: number
  checks: readonly Check[]
  deliveries: readonly DeliverySnapshot[]
  fieldChanges: readonly { path: string; was: State[string]; now: State[string] }[]
  changes: readonly DomainChange[]
  productChanges: readonly ProductChange[]
  events: readonly string[]
  beats: readonly Beat[]
  brief: Turn<Beat>["brief"]
  products: Record<string, unknown>
}
export interface ActiveContextView {
  worldState: WorldState
  products: Record<string, unknown>
  playerCatalog: readonly PlayerCatalogItem[]
}
export type InspectorTrace = readonly Extract<Event, { kind: "call" }>[]

export type TimelineEvent =
  | Exclude<Event, { kind: "call" | "change" }>
  | ({ kind: "change"; updated?: readonly TimelineNode[] } & Change<TimelineNode>)

const fieldChanges = (n: Node, before: State, rules: Rules) =>
  rules.fields
    .filter((f) => !f.hidden && before[f.path] !== n.state[f.path])
    .map((f) => ({ path: f.path, was: before[f.path]!, now: n.state[f.path]! }))

export const timelineNode = (n: Node, before: State, rules: Rules, products: readonly Product[]): TimelineNode => ({
  id: n.id,
  parent: n.parent,
  input: n.turn.input,
  invocations: (n.turn.input.invoke ?? []).flatMap((resourceId) => {
    const d = n.turn.deliveries.findLast((d) => d.resourceId === resourceId)
    return d ? [{ resourceId, title: d.title, source: d.source }] : []
  }),
  prose: n.turn.reply
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(""),
  theater: Object.fromEntries(
    products
      .filter((p) => p.role === "theater" && n.turn.products[p.id] !== undefined)
      .map((p) => [p.id, n.turn.products[p.id]]),
  ),
  heading: n.heading,
  end: n.turn.end,
  sibling: n.turn.sibling,
  settlementStatus: n.turn.settlementStatus,
  settlementError: n.turn.settlementError,
  deliverySummary: n.delivered.map(({ resourceId, title, source, revision }) => ({
    resourceId,
    title,
    source,
    revision,
  })),
  changeSummary: {
    fields: fieldChanges(n, before, rules).length,
    checks: n.checks.length,
    deliveries: n.delivered.length,
    products: n.turn.changes.length,
  },
})

export const turnDetail = (n: Node, before: State, rules: Rules): TurnDetail => ({
  id: n.id,
  checks: n.checks,
  deliveries: n.delivered,
  fieldChanges: fieldChanges(n, before, rules),
  changes: n.turn.changes,
  productChanges: n.turn.changes.map((c): ProductChange => ({
    id: "product" in c ? c.product : c.collection,
    change:
      c.kind === "insert_entity"
        ? "insert"
        : c.kind === "remove_entity"
          ? "remove"
          : c.kind === "replace"
            ? "replace"
            : "patch",
    value:
      c.kind === "insert_entity"
        ? [c.data]
        : c.kind === "patch_entity"
          ? [{ ...c.prev, ...c.patch }]
          : c.kind === "remove_entity"
            ? [c.prev]
            : c.kind === "patch_record"
              ? { ...c.prev, ...c.patch }
              : c.value,
  })),
  events: n.events,
  beats: n.turn.beats,
  brief: n.turn.brief,
  products: n.turn.products,
})
