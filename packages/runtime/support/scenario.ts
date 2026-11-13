// Offline contract runner. Every model comes from fake(); no connection or credentials are read.
import assert from "node:assert/strict"
import { fake, type FakeReply } from "@effect-tavern/provider"
import { Effect, Schema, Stream } from "effect"
import { makeCard, type Card } from "../src/card.ts"
import { makeSession, type Phase } from "../src/session.ts"
import { plain } from "./cards.ts"
import { defaultAnswer, readStage } from "./script.ts"

const Expect = Schema.Struct({
  state: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String, Schema.Boolean]))),
  events: Schema.optionalKey(Schema.Array(Schema.String)),
  windows: Schema.optionalKey(Schema.Array(Schema.String)),
  lore: Schema.optionalKey(Schema.Array(Schema.String)),
  end: Schema.optionalKey(Schema.Literals(["end", "over", "cap", "stopped"])),
  products: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})
const Scenario = Schema.Struct({
  seed: Schema.optionalKey(Schema.Int),
  greeting: Schema.optionalKey(Schema.Int),
  steps: Schema.Array(
    Schema.Struct({
      text: Schema.optionalKey(Schema.String),
      note: Schema.optionalKey(Schema.String),
      invoke: Schema.optionalKey(Schema.Array(Schema.String)),
      replies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Unknown))),
      expect: Schema.optionalKey(Expect),
    }),
  ),
})
export const runScenario = async (card: Card, value: unknown = { steps: [{ text: "继续" }] }) => {
  const scenario = Schema.decodeUnknownSync(Scenario)(value, { onExcessProperty: "error" })
  let replies: Record<string, unknown[]> = {}
  const model = fake((call): FakeReply => {
    const doc = readStage(call)
    const queue = replies[doc.phase]
    if (queue) {
      if (!queue.length) throw new Error(`script exhausted: ${doc.phase}`)
      const reply = queue.shift()
      if (doc.phase === "narrate") {
        if (typeof reply !== "string") throw new Error("narrate reply must be text")
        return { text: reply }
      }
      if (doc.phase === "record") return defaultAnswer(doc, reply as Record<string, unknown>)
      return { text: JSON.stringify(reply) }
    }
    return defaultAnswer(doc, { notes: "", options: [] })
  })
  // the player the run stands in for has a name, at the lowest rank: a card that leaves `user` to the player still runs
  const rows = { harness: { ...plain.harness!, names: { user: "阿青" } } }
  const session = makeSession({ card, rows: () => rows, model: () => model, seed: scenario.seed })
  if (scenario.greeting !== undefined) {
    const greeting = card.greetings[scenario.greeting]
    if (!greeting) throw new Error(`unknown greeting ${scenario.greeting}`)
    session.greet(greeting)
  }
  const rpg = makeCard(card.rules)
  const results = []
  for (const [i, step] of scenario.steps.entries()) {
    try {
      replies = Object.fromEntries(Object.entries(step.replies ?? {}).map(([phase, queue]) => [phase, [...queue]]))
      for (const phase of Object.keys(replies))
        if (!["lookup", "decide", "direct", "narrate", "check", "polish", "record"].includes(phase as Phase))
          throw new Error(`unknown phase ${phase}`)
      await Effect.runPromise(
        Stream.runDrain(session.act(session.log.head, { text: step.text ?? "", note: step.note, invoke: step.invoke })),
      )
      for (const [phase, queue] of Object.entries(replies)) assert.equal(queue.length, 0, `unused ${phase} replies`)
      assert.notEqual(session.log.head, null, "turn was not committed")
      const node = session.node(session.log.head!)
      assert.equal(node.turn.settlementStatus, "committed", node.turn.settlementError ?? "record did not commit")
      rpg.validate(node.state)
      const actual = {
        state: node.state,
        events: node.events,
        end: node.turn.end,
        windows: node.turn.opportunities.map((d) => `${d.id}#${d.layer}`),
        lore: [...node.turn.read, ...node.turn.fired].map((d) => `${d.id}#${d.layer}`),
        products: node.turn.products,
      }
      const expected = step.expect ?? {}
      for (const [key, value] of Object.entries(expected)) {
        if (key === "state" || key === "products") {
          for (const [field, want] of Object.entries(value as Record<string, unknown>))
            assert.deepEqual(actual[key][field], want, `${key}.${field}`)
        } else assert.deepEqual(actual[key as keyof typeof actual], value, key)
      }
      results.push(actual)
    } catch (e) {
      throw new Error(`step ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return results
}
