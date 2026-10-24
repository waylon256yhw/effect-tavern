// The adapter on a scripted session over a real socket: an action goes in as JSON, its events come back as SSE in the
// session's order, a bad body is a 400, a bad action is an `error` event, and `inspect` decides whether `call` events
// carry the request. `greet` opens a new root, `checkout` moves head, DELETE /nodes/<id> drops a subtree and answers with the Change.
import { fake, fakeText } from "@effect-tavern/provider"
import type { Event } from "@effect-tavern/runtime/src/session.ts"
import { chat, player } from "@effect-tavern/runtime/test/cards/wuxia.ts"
import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { open } from "../src/data.ts"
import { library } from "../src/library.ts"
import { serve } from "../src/serve.ts"

const model = {
  ...fake((o) =>
    o.responseFormat?.type === "json"
      ? {
          text: JSON.stringify({
            notes: ["N1"],
            options: ["A", "B", "C", "D"],
            people: [],
            scene: { place: "P", present: [] },
          }),
        }
      : /slow/.test(fakeText(o.prompt.at(-1)!))
        ? { text: "hello world ".repeat(20), delay: 20 }
        : { text: "hello world" },
  ),
  prefill: false,
}
const lib = library({ data: open(":memory:"), card: { ...chat, greetings: [{ text: "G" }] }, player, model })

const wired = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown // what JSON keeps: no `undefined` keys
const sse = (text: string) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [ev, data] = block.split("\n")
      return { event: ev!.slice(7), data: JSON.parse(data!.slice(6)) as Event & { message?: string } }
    })

const run = async (inspect: boolean) => {
  const server = serve(lib, { inspect }).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const post = (v: unknown, signal?: AbortSignal) => fetch(base, { method: "POST", body: JSON.stringify(v), signal })
  try {
    assert.deepEqual(await (await fetch(`${base}/nodes`)).json(), wired(lib.session.snapshot()))
    const about = (await (await fetch(`${base}/card`)).json()) as Record<string, unknown>
    assert.equal(about["input"], "act") // undeclared = act
    // the card's projection: the openings whole, the fiction without its text, the guard and lore as counts
    assert.deepEqual(
      [about["greetings"], about["guard"], about["lore"], about["director"], about["fiction"]],
      [
        [{ text: "G" }],
        0,
        { entries: 0, layers: 0 },
        false,
        [
          { id: "pei", label: "裴青舟" },
          { id: "pei-cool", label: "裴青舟（戒备）", when: { path: "bond", op: "lt", value: 8 } },
          { id: "pei-warm", label: "裴青舟（松动）", when: { path: "bond", op: "gte", value: 8 } },
        ],
      ],
    )

    // the player layer: read whole, replaced whole; the card's quick inputs follow it at once, a bad body is a 400
    assert.deepEqual(await (await fetch(`${base}/player`)).json(), wired(player))
    const mine = { ...player, writing: { pov: "third" as const }, snippets: [{ name: "Q", text: "q" }] }
    const put = (v: unknown) => fetch(`${base}/player`, { method: "PUT", body: JSON.stringify(v) })
    assert.deepEqual(await (await put(mine)).json(), wired(mine))
    assert.equal(
      ((await (await fetch(`${base}/card`)).json()) as { snippets: { name: string }[] }).snippets[0]!.name,
      "Q",
    )
    assert.equal((await put({ global: "no" })).status, 400)
    assert.equal((await put(player)).status, 200)

    const r = await post({ kind: "act", parent: null, input: { text: "hi" } })
    assert.equal(r.headers.get("content-type"), "text/event-stream")
    const evs = sse(await r.text())
    assert.deepEqual(
      evs.map((e) => e.event),
      ["stage", "delta", "delta", "call", "stage", "call", "change"],
    )
    const calls = evs.filter((e) => e.event === "call").map((e) => e.data as Extract<Event, { kind: "call" }>)
    assert.deepEqual(
      calls.map((c) => c.msgs.length > 0),
      [inspect, inspect],
    )
    const node = (evs.at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.equal(node.turn.input.text, "hi")
    assert.deepEqual(node, wired(lib.session.node(node.id))) // the wire carries the projection whole
    assert.equal(lib.session.log.head, node.id)
    // the trace stays on the server, by node, stripped the same way as the stream; every call carries its duration
    const trace = (await (await fetch(`${base}/calls`)).json()) as Record<string, Extract<Event, { kind: "call" }>[]>
    assert.deepEqual(trace[node.turn.id], wired(calls))
    assert.deepEqual(
      calls.map((c) => typeof c.ms === "number" && c.ms >= 0),
      [true, true],
    )

    const picked = sse(await (await post({ kind: "pick", node: node.turn.id, option: 1 })).text())
    assert.equal((picked.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.turn.input.text, "B")

    // stop: the client closes the response once the prose streams; the turn finishes into a `stopped` node it reads back.
    const ac = new AbortController()
    const size = lib.session.log.nodes.size
    const slow = await post({ kind: "act", parent: null, input: { text: "slow" } }, ac.signal)
    const reader = slow.body!.getReader()
    let got = ""
    while (!/event: delta/.test(got)) got += new TextDecoder().decode((await reader.read()).value)
    ac.abort()
    while (lib.session.log.nodes.size === size) await new Promise((r) => setTimeout(r, 10))
    const stopped = [...lib.session.log.nodes.values()].at(-1)!
    const kept = (stopped.reply[0] as { text: string }).text
    assert.deepEqual([stopped.input.text, stopped.end, kept.length > 0 && kept.length < 240], ["slow", "stopped", true])
    assert.equal(
      ((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes.length,
      lib.session.log.nodes.size,
    )

    const bad = await post({ kind: "fly" })
    assert.equal(bad.status, 400)
    assert.equal((await post("{")).status, 400)

    const err = sse(
      await (await post({ kind: "setField", node: node.turn.id, effects: [{ path: "x", set: 1 }] })).text(),
    )
    assert.deepEqual([err.length, err[0]!.event, /x/.test(err[0]!.data.message!)], [1, "error", true])
    // A parent that does not exist is a defect on the stream, not a new root (it once became its own parent and spun).
    const orphan = sse(await (await post({ kind: "act", parent: 99, input: { text: "hi" } })).text())
    assert.deepEqual([orphan.length, orphan[0]!.event, /99/.test(orphan[0]!.data.message!)], [1, "error", true])

    // a new thread is a greeting root; dropping a root takes its subtree, the trace with it, and ids never come back
    const greeted = sse(await (await post({ kind: "greet" })).text())
    const g = (greeted.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.turn
    assert.deepEqual([g.parent, g.input.text, (g.reply[0] as { text: string }).text], [null, "", "G"])
    const noSuch = sse(await (await post({ kind: "greet", greeting: 3 })).text())
    assert.deepEqual([noSuch.length, noSuch[0]!.event], [1, "error"])
    const tree = [...lib.session.log.nodes.keys()]
    // checkout: head to a version's newest leaf (its follow-up comes back); act without a parent lands under head
    const back = sse(await (await post({ kind: "checkout", node: node.id })).text())
    assert.deepEqual(back.at(-1)!.data, { kind: "change", head: node.id + 1 }) // "hi" → its pick "B"
    const under = sse(await (await post({ kind: "act", input: { text: "under head" } })).text())
    const u = (under.at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.deepEqual([u.parent, lib.session.log.head], [node.id + 1, u.id])
    const hadTrace = Object.keys((await (await fetch(`${base}/calls`)).json()) as object).length
    const c = (await (await fetch(`${base}/nodes/${node.id}`, { method: "DELETE" })).json()) as {
      dropped: number[]
      head: number | null
    }
    assert.deepEqual(
      [c.dropped, c.head],
      [[node.id, node.id + 1, u.id], Math.max(...tree.filter((id) => id !== node.id && id !== node.id + 1))],
    ) // head was inside: the newest survivor
    assert.ok(Object.keys((await (await fetch(`${base}/calls`)).json()) as object).length < hadTrace)
    assert.equal((await fetch(`${base}/nodes/${node.id}`, { method: "DELETE" })).status, 404)
    const again = sse(await (await post({ kind: "act", parent: null, input: { text: "hi" } })).text())
    assert.equal((again.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.id, u.id + 1) // one past every id ever handed out, the dropped tail's included

    // The library on the wire: a persona by id; a new story opens with it (its text in the narrator's head, seen when
    // inspecting) and empty; switching back finds the first story's nodes; a story that is not there is a 404.
    const first = lib.story
    const persona = (id: string, v?: unknown) =>
      fetch(`${base}/personas/${id}`, {
        method: v === undefined ? "DELETE" : "PUT",
        body: v === undefined ? undefined : JSON.stringify(v),
      })
    const monk = { id: "monk", name: "行脚僧", text: "你是路过的行脚僧。" }
    assert.deepEqual(await (await persona("monk", { name: monk.name, text: monk.text })).json(), [monk])
    assert.equal((await persona("monk", { name: 1 })).status, 400)
    assert.deepEqual(await (await fetch(`${base}/personas`)).json(), [monk])
    const opened = (await (
      await fetch(`${base}/stories`, { method: "POST", body: JSON.stringify({ persona: "monk" }) })
    ).json()) as { current: number; stories: { id: number; persona: string | null }[] }
    assert.deepEqual([opened.current !== first, opened.stories.map((x) => x.persona)], [true, ["monk", null]])
    assert.deepEqual(((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes, [])
    const fresh = sse(await (await post({ kind: "act", parent: null, input: { text: "who am i" } })).text())
    const head = (fresh.find((e) => e.event === "call")!.data as Extract<Event, { kind: "call" }>).msgs
    assert.equal(JSON.stringify(head).includes(monk.text), inspect)
    assert.equal(
      ((await (await fetch(`${base}/stories/${first}`, { method: "PUT" })).json()) as { current: number }).current,
      first,
    )
    assert.equal(
      ((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes.length,
      lib.session.log.nodes.size,
    )
    assert.equal((await fetch(`${base}/stories/999`, { method: "PUT" })).status, 404)
    const left = (await (await fetch(`${base}/stories/${opened.current}`, { method: "DELETE" })).json()) as {
      current: number
      stories: unknown[]
    }
    assert.deepEqual([left.current, left.stories.length], [first, 1])
    assert.deepEqual(await (await persona("monk")).json(), [])
  } finally {
    server.close()
  }
}
await run(true)
await run(false)

// The library alone: deleting the open story opens the newest remaining one, or a new one when none is left.
const solo = library({ data: open(":memory:"), card: chat, player, model })
const a = solo.story
solo.stories.create()
const b = solo.story
solo.stories.del(b)
assert.equal(solo.story, a)
solo.stories.del(a)
assert.ok(solo.story !== a && solo.stories.list().length === 1)
console.log("ok")
