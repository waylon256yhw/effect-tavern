// End-to-end transaction semantics through the session's public interface and native tool calls.
import assert from "node:assert/strict"
import { fake, type FakeReply } from "@effect-tavern/provider"
import { Effect, Fiber, Stream } from "effect"
import { makeSession, outcome, type Turn } from "../src/session.ts"
import { initialWorld, recordTransaction, worldOn } from "../src/world.ts"
import { holds } from "../src/cond.ts"
import type { Product } from "../src/product.ts"
import * as Log from "../src/log.ts"
import { chat } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

const people: Product = {
  id: "people",
  role: "world",
  text: "People",
  on: true,
  recall: "name",
  shape: {
    kind: "table",
    columns: [
      { key: "name", type: "text" },
      { key: "stance", type: "text" },
    ],
  },
}
const scene: Product = {
  id: "scene",
  role: "world",
  text: "Scene",
  on: true,
  feed: true,
  shape: {
    kind: "record",
    keys: [
      { key: "place", type: "text" },
      { key: "present", shape: { kind: "list" } },
    ],
  },
  initial: { place: "inn", present: [] },
}
const tool = (name: string, input: unknown) => ({ name, input })
const finish = () => tool("finish_record", { notes: "" })
let replies: FakeReply[] = []
let narrations = 0
const model = fake((o) => {
  const d = readStage(o)
  if (d.phase === "record") {
    const r = replies.shift()
    if (!r) throw new Error("scripted record failure")
    return r
  }
  if (d.phase === "narrate") narrations++
  return defaultAnswer(d)
})
let saved: Log.Snapshot<Turn> | undefined
const S = makeSession({
  card: { ...chat, products: [scene, people] },
  rows: () => ({}),
  model: () => model,
  store: {
    read: () => saved,
    write: (_, log) => {
      saved = Log.snapshot(log)
    },
  },
})
const go = () => Effect.runPromise(outcome(S.act(S.log.head, { text: "go" })))
replies = [
  {
    text: "",
    toolCalls: [
      tool("insert_people", { data: { name: "李鹤", stance: "警惕" } }),
      tool("patch_scene", { patch: { place: "woods" } }),
      finish(),
    ],
  },
]
const a = await go()
assert.equal(a.settlementStatus, "committed")
assert.deepEqual(a.products, { notes: "" })
assert.equal(a.changes.length, 2)
const entity = a.changes[0]!
assert.equal(entity.kind, "insert_entity")
if (entity.kind !== "insert_entity") throw new Error("expected insertion")
const id = entity.entityId
assert.notEqual(id, "李鹤")
assert.deepEqual(S.context(a.id).world.scene, { place: "woods", present: [] })
assert.ok(holds({ path: "world.scene.place", is: "woods" }, S.context(a.id)))
replies = [{ text: "", toolCalls: [tool("patch_people", { entityId: id, patch: { stance: "盟友" } }), finish()] }]
const b = await go()
assert.deepEqual((S.context(b.id).world.people as any)[id], { name: "李鹤", stance: "盟友" })
assert.deepEqual((S.context(a.id).world.people as any)[id], { name: "李鹤", stance: "警惕" })

// Successful writes followed by failure are discarded; prose was persisted before record started.
replies = [{ text: "", toolCalls: [tool("patch_scene", { patch: { place: "must not commit" } })] }]
await assert.rejects(go(), /scripted record failure/)
const failed = S.log.nodes.get(S.log.head!)!
assert.equal(failed.settlementStatus, "failed")
assert.ok(failed.reply.length)
assert.deepEqual(failed.changes, [])
assert.equal((S.context(failed.id).world.scene as any).place, "woods")
assert.equal(saved!.nodes.at(-1)!.settlementStatus, "failed")
await assert.rejects(go(), /parent settlement/)
const count = narrations
replies = [{ text: "", toolCalls: [tool("patch_scene", { patch: { place: "recovered" } }), finish()] }]
const retried = await Effect.runPromise(outcome(S.retryRecord(failed.id)))
assert.equal(retried.id, failed.id)
assert.equal(retried.settlementStatus, "committed")
assert.equal(narrations, count)
assert.equal((S.context(retried.id).world.scene as any).place, "recovered")

// Missing insert columns fail schema validation and can be corrected without creating a partial entity.
replies = [
  { text: "", toolCalls: [tool("insert_people", { data: { name: "同名" } }), finish()] },
  { text: "", toolCalls: [tool("insert_people", { data: { name: "同名", stance: "未知" } }), finish()] },
]
const repaired = await go()
assert.equal(repaired.changes.length, 1)
// Delete then insert a same-name person gets a different identity and never inherits old columns.
replies = [
  {
    text: "",
    toolCalls: [
      tool("remove_people", { entityId: id }),
      tool("insert_people", { data: { name: "李鹤", stance: "陌生" } }),
      finish(),
    ],
  },
]
const recreated = await go()
const newEntity = recreated.changes.find((c) => c.kind === "insert_entity")!
assert.ok(newEntity.kind === "insert_entity" && newEntity.entityId !== id)
assert.ok(!Object.hasOwn(S.context(recreated.id).world.people as object, id))

// Explicit skip keeps the node closed and cannot be overwritten by retry.
replies = []
await assert.rejects(go())
const skipId = S.log.head!
S.skipRecord(skipId)
assert.equal(S.log.nodes.get(skipId)!.settlementStatus, "skipped")
await assert.rejects(Effect.runPromise(outcome(S.retryRecord(skipId))), /already closed/)
replies = [{ text: "", toolCalls: [finish()] }]
await go()

// Branches use only ancestor changes.
S.checkout(a.id)
replies = [{ text: "", toolCalls: [tool("patch_scene", { patch: { place: "branch" } }), finish()] }]
const branch = await Effect.runPromise(outcome(S.act(a.id, { text: "branch" })))
assert.equal((S.context(branch.id).world.scene as any).place, "branch")
assert.deepEqual((S.context(branch.id).world.people as any)[id], { name: "李鹤", stance: "警惕" })
assert.equal((S.context(retried.id).world.scene as any).place, "recovered")

// An in-flight attempt cannot overwrite a skip. Cancelled attempts also persist failed status.
for (const mode of ["skip", "cancel", "adjust", "ancestor"]) {
  let entered!: () => void
  let release!: () => void
  const ready = new Promise<void>((r) => {
    entered = r
  })
  const wait = new Promise<void>((r) => {
    release = r
  })
  const slow = { ...model } // use the existing SDK model, wrapped at doGenerate
  const original = model.model as any
  slow.model = Object.assign(Object.create(original), {
    doGenerate: async (o: any) => {
      if (readStage(o).phase === "record") {
        entered()
        await wait
      }
      return original.doGenerate(o)
    },
  })
  const T = makeSession({ card: chat, rows: () => ({}), model: () => slow })
  replies = [{ text: "", toolCalls: [finish()] }]
  const parent = mode === "ancestor" ? T.greet({ text: "opening" }).node!.id : null
  const fiber = Effect.runFork(Stream.runCollect(T.act(parent, { text: "wait" })))
  await ready
  const node = T.log.head!
  assert.equal(T.log.nodes.get(node)!.settlementStatus, "pending")
  if (mode === "skip") T.skipRecord(node)
  else if (mode === "cancel") await Effect.runPromise(Fiber.interrupt(fiber))
  else T.setField(mode === "ancestor" ? parent! : node, [{ path: "hp", set: 20 }])
  release()
  await Effect.runPromise(Fiber.await(fiber))
  assert.equal(T.log.nodes.get(node)!.settlementStatus, mode === "skip" ? "skipped" : "failed")
}

// The transaction rejects missing entities; finish requires correction or explicit withdrawal.
{
  const tx = recordTransaction([scene, people], initialWorld([scene, people]))
  const ctx = { toolCallId: "x", signal: new AbortController().signal }
  assert.equal((await tx.tools.patch_people!.execute({ entityId: "absent", patch: { stance: "x" } }, ctx)).ok, false)
  assert.equal((await tx.tools.finish_record!.execute({}, ctx)).ok, false)
  assert.equal((await tx.tools.discard_error!.execute({ target: "people:absent" }, ctx)).ok, true)
  assert.equal((await tx.tools.finish_record!.execute({}, ctx)).ok, true)
  assert.deepEqual(tx.current(), initialWorld([scene, people]))
}
// Persist failures do not publish an in-memory commit.
{
  const held = Log.hold<Turn>({
    read: () => undefined,
    write: () => {
      throw new Error("disk full")
    },
  })
  assert.throws(() => held.commit(Log.add(held.log, { ...a, parent: null })), /disk full/)
  assert.equal(held.log.nodes.size, 0)
}
assert.deepEqual(worldOn([scene, people], []), initialWorld([scene, people]))
console.log("record transactions ok")

// The unified read tree has one phase boundary: record facts become visible on the following turn.
{
  const inWoods = { path: "world.scene.place", is: "woods" } as const
  const card = {
    ...chat,
    heading: "scene.place",
    products: [scene, { ...people, when: inWoods }],
    frame: [{ id: "setting", text: "PLACE={{world.scene.place}} SCORE={{fields.score}}" }],
    fiction: [{ id: "forest", text: "FOREST-ONLY", when: inWoods }],
    lore: [{ id: "trail", layers: ["Hidden trail."], unlock: inWoods, offer: { any: [] } }],
    rules: {
      fields: [{ path: "score", type: "int", initial: 0 }],
      actions: [{ id: "explore", text: "Explore", when: inWoods, do: [] }],
      readouts: [
        {
          id: "reward",
          text: "Reward",
          when: inWoods,
          options: [{ id: "yes", text: "Yes", do: [{ path: "score", add: 1 }] }],
        },
      ],
    },
  } as const
  const prompts: string[] = []
  const toolsets: string[][] = []
  const M = fake((o) => {
    const d = readStage(o)
    if (d.phase === "narrate") prompts.push(JSON.stringify(o.prompt))
    if (d.phase === "record") toolsets.push(d.tools)
    return defaultAnswer(d, { notes: "", scene: { place: "woods", present: [] } })
  })
  const T = makeSession({ card, rows: () => ({}), model: () => M })
  const one = await Effect.runPromise(outcome(T.act(null, { text: "enter" })))
  assert.ok(prompts[0]!.includes("PLACE=inn SCORE=0"))
  assert.ok(!prompts[0]!.includes("FOREST-ONLY"))
  assert.ok(!toolsets[0]!.includes("insert_people"))
  assert.deepEqual(one.answers, {})
  assert.equal(T.node(one.id).heading, "woods")
  assert.deepEqual(T.node(one.id).playerCatalog, []) // unlocked model lore is not a player command
  const two = await Effect.runPromise(outcome(T.act(one.id, { text: "explore" })))
  assert.ok(prompts[1]!.includes("PLACE=woods SCORE=0"))
  assert.ok(prompts[1]!.includes("FOREST-ONLY"))
  assert.ok(toolsets[1]!.includes("insert_people"))
  assert.deepEqual(two.answers, { reward: "yes" })
  assert.equal(T.context(two.id).fields.score, 1)
  assert.equal(T.context(one.id).fields.score, 0)
  assert.ok(!("world" in T.node(two.id))) // full world is fetched on demand, never copied into timeline nodes
  assert.equal(T.activeContext(two.id).worldState.fields.score, 1)
  const timeline = T.timeline()
  assert.deepEqual(
    timeline.nodes.map((n) => n.id),
    [one.id, two.id],
  )
  const light = T.timelineNode(two.id)
  assert.equal(light.heading, "woods")
  assert.equal(light.changeSummary.fields, 1)
  assert.deepEqual(T.detail(two.id).fieldChanges, [{ path: "score", was: 0, now: 1 }])
  for (const key of ["turn", "state", "changes", "checks", "delivered", "playerCatalog"])
    assert.ok(!(key in light), key)
  assert.ok(light.deliverySummary.every((d) => !("text" in d)))
  const heavy = T.node(two.id)
  const delivery = {
    resourceId: "pack:p/guide",
    title: "Guide",
    source: "pack" as const,
    revision: "v1",
    residency: "window" as const,
    text: "large body".repeat(10000),
  }
  const wire = T.projectTimeline({
    ...heavy,
    delivered: [delivery],
    turn: {
      ...heavy.turn,
      deliveries: [delivery],
      changes: [{ kind: "replace", product: "scene", value: { place: "large state".repeat(10000), present: [] } }],
    },
  })
  assert.ok(JSON.stringify(wire).length < 2048)
  assert.ok(!JSON.stringify(wire).includes("large body"))
  assert.ok(!JSON.stringify(wire).includes("large state"))

  T.setField(one.id, [{ path: "score", set: 5 }])
  assert.equal(T.activeContext(two.id).worldState.fields.score, 6)
  assert.deepEqual(T.detail(two.id).fieldChanges, [{ path: "score", was: 5, now: 6 }])
}

// Initialization rejects malformed fixed state; replacement and nested patch have different clearing semantics.
{
  assert.throws(() => initialWorld([{ ...people, initial: { e_bad: { name: "incomplete" } } }]))
  assert.throws(() => initialWorld([{ ...scene, initial: { place: "missing present" } }]))
  const nested: Product = {
    id: "nested",
    role: "world",
    text: "nested",
    shape: {
      kind: "record",
      keys: [
        {
          key: "details",
          shape: {
            kind: "record",
            keys: [
              { key: "a", type: "text" },
              { key: "b", type: "text" },
            ],
          },
        },
        { key: "list", shape: { kind: "list", max: 1 } },
      ],
    },
    initial: { details: { a: "a", b: "b" }, list: ["x"] },
  }
  const tx = recordTransaction([nested], initialWorld([nested]))
  const ctx = { toolCallId: "x", signal: new AbortController().signal }
  assert.equal((await tx.tools.patch_nested!.execute({ patch: { details: { a: "" }, list: [] } }, ctx)).ok, true)
  assert.deepEqual(tx.current().nested, { details: { a: "", b: "b" }, list: [] })
  assert.equal(
    (await tx.tools.replace_nested!.execute({ value: { details: { a: "new", b: "" }, list: ["x", "y"] } }, ctx)).ok,
    false,
  )
  assert.deepEqual(tx.current().nested, { details: { a: "", b: "b" }, list: [] })
}
