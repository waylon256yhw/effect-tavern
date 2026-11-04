// Non-optimistic edits queue transformations, not documents computed before a preceding blur has saved.
import assert from "node:assert/strict"
import type { Local } from "@effect-tavern/runtime/src/layer.ts"
import { locals, registry } from "../src/store.ts"
import { putLocal } from "../src/wire.ts"
import { setFragmentAt, setFragmentText } from "../src/requirements.ts"

const initial: Local = { id: "local", name: "local", card: "wuxia", fragments: [{ id: "voice", text: "old" }] }
registry.set(locals, { wuxia: initial })
const requests: { body: Local; reply: (response: Response) => void }[] = []
let notify: (() => void) | undefined
const requested = () =>
  new Promise<void>((resolve) => {
    notify = resolve
  })
globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
  assert.equal(typeof init.body, "string")
  const body = JSON.parse(init.body as string) as Local
  const response = new Promise<Response>((reply) => requests.push({ body, reply }))
  notify?.()
  return response
}) as typeof fetch

let sent = requested()
const text = putLocal("wuxia", (l) => setFragmentText(l, 0, "new"))
const position = putLocal("wuxia", (l) => setFragmentAt(l, 0, "tail"))
await sent
assert.equal(requests.length, 1)
assert.equal(registry.get(locals).wuxia, initial)
sent = requested()
requests[0]!.reply(Response.json(requests[0]!.body))
await text
await sent
assert.equal(requests[1]!.body.fragments![0]!.text, "new")
assert.equal(requests[1]!.body.fragments![0]!.at, "tail")
requests[1]!.reply(Response.json(requests[1]!.body))
await position

// A rejected write stays rejected, but does not block the next edit or enter its unacknowledged fields.
const saved = registry.get(locals).wuxia
sent = requested()
const failed = assert.rejects(
  putLocal("wuxia", (l) => ({ ...l, switches: { pov: "third" } })),
  /offline/,
)
const following = putLocal("wuxia", (l) => ({ ...l, persona: "me" }))
await sent
sent = requested()
requests[2]!.reply(Response.json({ error: "offline" }, { status: 500 }))
await failed
await sent
assert.equal(registry.get(locals).wuxia, saved)
assert.equal(requests[3]!.body.switches, undefined)
assert.equal(requests[3]!.body.fragments![0]!.text, "new")
requests[3]!.reply(Response.json(requests[3]!.body))
await following
assert.equal(registry.get(locals).wuxia?.persona, "me")
console.log("player ok")
