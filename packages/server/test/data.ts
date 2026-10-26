// The library (src/data.ts) in memory: a story's store is log.ts's Store, written change by change and read back as
// the same log, with head and next kept so a dropped id never returns; deleting a story takes its nodes with it; the
// player row round-trips its JSON.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { open, traced } from "../src/data.ts"

interface N extends L.Noded {
  text: string
}
const data = open(":memory:")

// Store: the authority commits, a fresh holder over the same rows equals it, and the next id is the stored one.
const story = data.stories.create("wuxia")
const store = data.store<N>(story)
const h = L.hold<N>(store)
h.commit(L.add(h.log, { parent: null, text: "r" }))
h.commit(L.add(h.log, { parent: 0, text: "c" }))
h.commit(L.amend(h.log, 1, { text: "c'" }))
h.commit(L.drop(h.log, 1))
const back = L.hold<N>(data.store<N>(story))
assert.deepEqual(L.snapshot(back.log), { nodes: [{ id: 0, parent: null, text: "r" }], head: 0, next: 2 })
assert.equal(back.commit(L.add(back.log, { parent: 0, text: "d" })).node!.id, 2)
assert.throws(() => data.store<N>(99).read(), /no story 99/)

// Calls: filed under a node in order, read back by node; gone with the node, and with the story.
const trace = data.calls(story)
trace.add(0, [{ phase: "narrate" }, { phase: "record" }])
trace.add(2, [{ phase: "lookup" }])
trace.add(0, [{ phase: "record" }]) // an amend appends
assert.deepEqual(trace.list(), {
  0: [{ phase: "narrate" }, { phase: "record" }, { phase: "record" }],
  2: [{ phase: "lookup" }],
})
back.commit(L.drop(back.log, 2))
assert.deepEqual(Object.keys(trace.list()), ["0"])

// Only a story's last `traced` nodes keep their calls, last by newest call: the oldest go on each add, and an amended
// old node is recent again (its earlier calls already gone), taking the slot of the then-oldest.
{
  const long = data.stories.create("trim")
  const t = L.hold<N>(data.store<N>(long))
  const calls = data.calls(long)
  const count = traced + 5
  for (let i = 0; i < count; i++) {
    const n = t.commit(L.add(t.log, { parent: i ? i - 1 : null, text: String(i) })).node!
    calls.add(n.id, [{ node: n.id }, { node: n.id, phase: "record" }])
  }
  const ids = (from: number) => Array.from({ length: count - from }, (_, k) => String(from + k))
  assert.deepEqual(Object.keys(calls.list()), ids(5))
  assert.deepEqual(calls.list()[5], [{ node: 5 }, { node: 5, phase: "record" }])
  calls.add(0, [{ node: 0, again: true }])
  assert.deepEqual(Object.keys(calls.list()), ["0", ...ids(6)])
  assert.deepEqual(calls.list()[0], [{ node: 0, again: true }])
  data.calls(story).add(0, [{ phase: "other story" }]) // another story's trim leaves this one alone
  assert.equal(Object.keys(calls.list()).length, traced)
  data.stories.del(long)
}

// Stories list newest first per card, each with its size and head node; deleting one cascades to its nodes.
const second = data.stories.create("wuxia")
assert.deepEqual(
  data.stories.list("wuxia").map((s) => [s.id, s.turns, s.head]),
  [
    [second, 0, null],
    [story, 1, { id: 0, parent: null, text: "r" }], // node 2 dropped above: head fell back to the root
  ],
)
assert.equal(data.stories.list("other").length, 0)
data.stories.del(story)
assert.deepEqual(
  data.stories.list("wuxia").map((s) => s.id),
  [second],
)
assert.throws(() => data.store<N>(story).read(), /no story/)
assert.deepEqual(trace.list(), {})

// Personas by name; the player row: JSON in, the same out (which persona is on which card is the player's).
data.personas.put({ id: "friend", name: "旧友", text: "你是替故人送还遗物的旧友。" })
data.personas.put({ id: "monk", name: "行脚僧", text: "你是路过的行脚僧。" })
assert.deepEqual(
  data.personas.list().map((p) => [p.id, p.text]),
  [
    ["friend", "你是替故人送还遗物的旧友。"],
    ["monk", "你是路过的行脚僧。"],
  ],
) // byte order: 旧 (U+65E7) before 行 (U+884C)
data.personas.del("monk")
assert.deepEqual(
  data.personas.list().map((p) => p.id),
  ["friend"],
)
// Hats: the row's id and name, the rest in the json column, the same hat back.
const hat = { id: "h", name: "续写", narrate: { head: [{ role: "user" as const, text: "U" }] }, review: { head: [] } }
data.hats.put(hat)
assert.deepEqual(data.hats.list(), [hat])
data.hats.del("h")
assert.deepEqual(data.hats.list(), [])
// Secrets and providers: the same named-row shape; routing: one row, JSON in, the same out.
const secret = { id: "s", name: "Key", type: "api_key" as const, value: "sk-0123456789abcdef" }
data.secrets.put(secret)
assert.deepEqual(data.secrets.list(), [secret])
const provider = {
  id: "p",
  name: "Relay",
  enabled: true,
  defaultFormat: "anthropic" as const,
  endpoints: { anthropic: { url: "https://relay.example/v1", exactPrefix: true } },
  secret: "s",
  proxy: false as const,
  models: [{ id: "m", format: "openai-compatible" as const, capabilities: { prefill: true } }],
}
data.providers.put(provider)
assert.deepEqual(data.providers.list(), [provider])
data.providers.del("p")
data.secrets.del("s")
assert.deepEqual([data.providers.list(), data.secrets.list()], [[], []])
assert.equal(data.routing.read(), undefined)
const routing = { default: { provider: "p", model: "m" }, stages: { lookup: { provider: "p", model: "n" } } }
data.routing.write(routing)
assert.deepEqual(data.routing.read(), routing)
assert.equal(data.player.read(), undefined)
data.player.write({ writing: { pov: "second" }, global: [], forCard: {}, persona: { wuxia: "friend" } })
assert.deepEqual(data.player.read(), {
  writing: { pov: "second" },
  global: [],
  forCard: {},
  persona: { wuxia: "friend" },
})
data.close()

// The lock: one process per library file. A lock naming a live process (here our parent) is not ours: open diverts to
// a fresh library at <dir>/<pid>/; a lock naming a dead process is taken over, and on exit the lock goes.
{
  const dir = mkdtempSync(join(tmpdir(), "tavern-lock-"))
  const file = join(dir, "tavern.db")
  writeFileSync(`${file}.lock`, String(process.ppid))
  const other = open(file)
  assert.equal(other.file, join(dir, String(process.pid), "tavern.db"))
  assert.equal(readFileSync(`${other.file}.lock`, "utf8"), String(process.pid))
  assert.equal(readFileSync(`${file}.lock`, "utf8"), String(process.ppid)) // the owner's lock untouched
  other.close()
  writeFileSync(`${file}.lock`, String(spawnSync("true").pid)) // exited: a stale lock
  const taken = open(file)
  assert.equal(taken.file, file)
  assert.equal(readFileSync(`${file}.lock`, "utf8"), String(process.pid))
  assert.equal(open(file).file, file) // our own lock (Vite re-evaluating the module): the same library
  taken.close()
  process.on("exit", () => {
    assert.ok(!existsSync(`${file}.lock`))
    rmSync(dir, { recursive: true })
  })
}
console.log("ok")
