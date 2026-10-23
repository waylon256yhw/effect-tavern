// The wire adapter at the session's seam: one process, one session, no logic of its own.
//   POST /        an Action (src/session.ts `Action`, decoded at this boundary) → the events it causes, as SSE, one
//                 `event:` per kind; a failure is an `error` event. Closing the response is the stop: before the first
//                 character of a draft it interrupts the action (nothing is saved, the model request aborts); once a
//                 delta was sent it halts the prose where it is and the turn finishes into a `stopped` node.
//   GET  /nodes   the snapshot: every node's projection and head, for a client that just opened.
//   DELETE /nodes/<id>  the node and everything under it gone (a thread is a root's subtree); the reply is the Change.
//   GET  /calls   the `call` events of recent turns by node id: the inspector's trace. They evaporate with the SSE
//                 (a stop closes it before record's call), so the adapter keeps them in memory; the journal stays
//                 outputs-only, and a restart starts the trace over.
//   GET  /card    what a client draws the card by: id, title and summary, the default channel, the rules as data (field
//                 bounds, options, action ids), the openings whole, the products' shapes, the quick inputs (snippets),
//                 the format keys, the fiction's modules without their text, the guard and lore as counts, and what
//                 the card's text costs each turn, estimated.
//                 Fragment bodies, guard lines and lore never leave the server.
// `inspect` keeps the request messages on `call` events; they carry the card's fragment bodies, so a player client
// gets phase, answer and usage only.
import { decodeAction, perform, type Event, type Session } from "@effect-tavern/runtime/src/session.ts"
import { Cause, Deferred, Effect, Fiber, Stream } from "effect"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const body = (req: IncomingMessage, limit = 1 << 20) =>
  new Promise<string>((resolve, reject) => {
    let s = ""
    req.setEncoding("utf8")
    req.on("data", (c: string) => {
      s += c
      if (s.length > limit) {
        reject(new Error("body too large"))
        req.destroy()
      }
    })
    req.on("end", () => resolve(s))
    req.on("error", reject)
  })
const reason = (c: Cause.Cause<unknown>) => {
  const e = Cause.squash(c)
  return e instanceof Error ? e.message : String(e)
}

export type Call = Extract<Event, { kind: "call" }>
const KEEP = 200 // ponytail: nodes whose calls stay in memory; a ring over the journal if a long story needs more

export const handle = (s: Session, { inspect = false } = {}) => {
  const calls = new Map<number, Call[]>() // insertion order = age; an amend (demand, pin) appends to its node
  const shown = (e: Event) => (inspect || e.kind !== "call" ? e : { ...e, msgs: [] })
  return async (req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(v))
    }
    if (req.method === "GET" && req.url === "/card")
      return json(200, {
        ...s.meta,
        greetings: s.greetings,
        fiction: s.fiction,
        rules: s.rules,
        products: s.products,
        snippets: s.snippets,
        format: s.format,
      })
    if (req.method === "GET" && req.url === "/nodes") return json(200, s.snapshot())
    const dropping = req.method === "DELETE" && /^\/nodes\/(\d+)$/.exec(req.url ?? "")
    if (dropping) {
      let c
      try {
        c = s.drop(Number(dropping[1]))
      } catch (e) {
        return json(404, { error: e instanceof Error ? e.message : String(e) })
      }
      for (const id of c.dropped ?? []) calls.delete(id)
      return json(200, c)
    }
    if (req.method === "GET" && req.url === "/calls") return json(200, Object.fromEntries(calls))
    if (req.method !== "POST" || req.url !== "/") return json(404, { error: "not found" })
    let action
    try {
      action = decodeAction(JSON.parse(await body(req)))
    } catch (e) {
      return json(400, { error: e instanceof Error ? e.message : String(e) })
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    let closed = false
    let narrating = false
    const send = (name: string, v: unknown) => {
      if (!closed) res.write(`event: ${name}\ndata: ${JSON.stringify(v)}\n\n`)
    }
    const made: Call[] = [] // this action's calls, filed under its node once the node exists
    const stop = Effect.runSync(Deferred.make<void>())
    const fiber = Effect.runFork(
      Stream.runForEach(perform(s, action, Deferred.await(stop)), (e) =>
        Effect.sync(() => {
          // Each draft starts over: a stop before its first character withdraws the turn, even on the correction rewrite.
          if (e.kind === "stage" && e.phase === "narrate") narrating = false
          if (e.kind === "delta" && e.part.type === "text-delta") narrating = true // reasoning is not prose: the client counts the same
          const v = shown(e)
          if (v.kind === "call") made.push(v)
          if (v.kind === "change" && v.node) {
            const id = v.node.id
            calls.set(id, [...(calls.get(id) ?? []), ...made.splice(0)])
            for (const k of calls.keys()) if (calls.size > KEEP) calls.delete(k)
          }
          send(e.kind, v)
        }),
      ).pipe(
        Effect.catchCause((c) => Effect.sync(() => send("error", { message: reason(c) }))),
        Effect.ensuring(Effect.sync(() => void (closed || res.end()))),
      ),
    )
    // `req` "close" means the request body was consumed (Node ≥ 16), not that the client went away; the response's does.
    res.on("close", () => {
      if (res.writableFinished) return
      closed = true
      if (narrating) Effect.runSync(Deferred.succeed(stop, undefined))
      else Effect.runFork(Fiber.interrupt(fiber))
    })
  }
}
export const serve = (session: Session, opts?: { inspect?: boolean }) => createServer(handle(session, opts))
