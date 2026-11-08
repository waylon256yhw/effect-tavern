import type { TimelineNode } from "@effect-tavern/runtime/src/projection.ts"
export const timelineNode = (id: number, parent: number | null, prose: string, text = `in${id}`): TimelineNode => ({
  id,
  parent,
  prose,
  input: { text },
  invocations: [],
  theater: {},
  end: "end",
  settlementStatus: "committed",
  deliverySummary: [],
  changeSummary: { fields: 0, checks: 0, deliveries: 0, products: 0 },
})
export const token = (resourceId: string) => ({ resourceId, title: `Title ${resourceId}`, source: "pack" as const })
