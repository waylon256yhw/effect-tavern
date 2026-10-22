// The adapter on a scripted session over a real socket: an action goes in as JSON, its events come back as SSE in the
// session's order, a bad body is a 400, a bad action is an `error` event, and `inspect` decides whether `call` events
// carry the request.
import { fake, fakeText } from "@effect-tavern/provider"
import { makeSession, type Event } from "@effect-tavern/runtime/src/session.ts"
import { chat, player } from "@effect-tavern/runtime/test/cards/wuxia.ts"
import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
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
const session = makeSession({ card: chat, player, model })

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
  const server = serve(session, { inspect }).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const post = (v: unknown, signal?: AbortSignal) => fetch(base, { method: "POST", body: JSON.stringify(v), signal })
  try {
    assert.deepEqual(await (await fetch(`${base}/nodes`)).json(), wired(session.nodes().map((t) => session.node(t.id))))
    assert.equal(((await (await fetch(`${base}/card`)).json()) as { input: string }).input, "act") // undeclared = act

    const r = await post({ kind: "act", parent: null, input: { text: "hi" } })
    assert.equal(r.headers.get("content-type"), "text/event-stream")
    const evs = sse(await r.text())
    assert.deepEqual(
      evs.map((e) => e.event),
      ["stage", "delta", "delta", "call", "stage", "call", "node"],
    )
    const calls = evs.filter((e) => e.event === "call").map((e) => e.data as Extract<Event, { kind: "call" }>)
    assert.deepEqual(
      calls.map((c) => c.msgs.length > 0),
      [inspect, inspect],
    )
    const node = (evs.at(-1)!.data as Extract<Event, { kind: "node" }>).node
    assert.equal(node.turn.input.text, "hi")
    assert.deepEqual(node, wired(session.node(node.turn.id))) // the wire carries the projection whole
    // the trace stays on the server, by node, stripped the same way as the stream; every call carries its duration
    const trace = (await (await fetch(`${base}/calls`)).json()) as Record<string, Extract<Event, { kind: "call" }>[]>
    assert.deepEqual(trace[node.turn.id], wired(calls))
    assert.deepEqual(
      calls.map((c) => typeof c.ms === "number" && c.ms >= 0),
      [true, true],
    )

    const picked = sse(await (await post({ kind: "pick", node: node.turn.id, option: 1 })).text())
    assert.equal((picked.at(-1)!.data as Extract<Event, { kind: "node" }>).node.turn.input.text, "B")

    // stop: the client closes the response once the prose streams; the turn finishes into a `stopped` node it reads back.
    const ac = new AbortController()
    const size = session.size
    const slow = await post({ kind: "act", parent: null, input: { text: "slow" } }, ac.signal)
    const reader = slow.body!.getReader()
    let got = ""
    while (!/event: delta/.test(got)) got += new TextDecoder().decode((await reader.read()).value)
    ac.abort()
    while (session.size === size) await new Promise((r) => setTimeout(r, 10))
    const stopped = session.nodes().at(-1)!
    const kept = (stopped.reply[0] as { text: string }).text
    assert.deepEqual([stopped.input.text, stopped.end, kept.length > 0 && kept.length < 240], ["slow", "stopped", true])
    assert.equal(((await (await fetch(`${base}/nodes`)).json()) as unknown[]).length, session.size)

    const bad = await post({ kind: "fly" })
    assert.equal(bad.status, 400)
    assert.equal((await post("{")).status, 400)

    const err = sse(await (await post({ kind: "setField", node: 0, effects: [{ path: "x", set: 1 }] })).text())
    assert.deepEqual([err.length, err[0]!.event, /x/.test(err[0]!.data.message!)], [1, "error", true])
    // A parent that does not exist is a defect on the stream, not a new root (it once became its own parent and spun).
    const orphan = sse(await (await post({ kind: "act", parent: 99, input: { text: "hi" } })).text())
    assert.deepEqual([orphan.length, orphan[0]!.event, /99/.test(orphan[0]!.data.message!)], [1, "error", true])
  } finally {
    server.close()
  }
}
await run(true)
await run(false)
console.log("ok")
