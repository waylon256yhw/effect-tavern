// Non-optimistic edits queue transformations, not documents computed before a preceding blur has saved.
import assert from "node:assert/strict"
import type { Player } from "@effect-tavern/runtime/src/fragment.ts"
import { player, registry } from "../src/store.ts"
import { putPlayer } from "../src/wire.ts"
import { setGlobalAt, setGlobalText } from "../src/requirements.ts"

const initial: Player = { global: [{ id: "voice", text: "old" }], forCard: {} }
registry.set(player, initial)
const requests: { body: Player; reply: (response: Response) => void }[] = []
let notify: (() => void) | undefined
const requested = () =>
  new Promise<void>((resolve) => {
    notify = resolve
  })
globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
  assert.equal(typeof init.body, "string")
  const body = JSON.parse(init.body as string) as Player
  const response = new Promise<Response>((reply) => requests.push({ body, reply }))
  notify?.()
  return response
}) as typeof fetch

let sent = requested()
const text = putPlayer((p) => setGlobalText(p, 0, "new"))
const position = putPlayer((p) => setGlobalAt(p, 0, "tail"))
await sent
assert.equal(requests.length, 1)
assert.equal(registry.get(player), initial)
sent = requested()
requests[0]!.reply(Response.json(requests[0]!.body))
await text
await sent
assert.equal(requests[1]!.body.global[0]!.text, "new")
assert.equal(requests[1]!.body.global[0]!.at, "tail")
requests[1]!.reply(Response.json(requests[1]!.body))
await position

// A rejected write stays rejected, but does not block the next edit or enter its unacknowledged fields.
const saved = registry.get(player)
sent = requested()
const failed = assert.rejects(
  putPlayer((p) => ({ ...p, writing: { pov: "third" } })),
  /offline/,
)
const following = putPlayer((p) => ({ ...p, persona: { card: "me" } }))
await sent
sent = requested()
requests[2]!.reply(Response.json({ error: "offline" }, { status: 500 }))
await failed
await sent
assert.equal(registry.get(player), saved)
assert.equal(requests[3]!.body.writing, undefined)
assert.equal(requests[3]!.body.global[0]!.text, "new")
requests[3]!.reply(Response.json(requests[3]!.body))
await following
assert.deepEqual(registry.get(player)?.persona, { card: "me" })
console.log("player ok")
