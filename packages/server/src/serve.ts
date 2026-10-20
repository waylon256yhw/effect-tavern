// The wire adapter at the session's seam: one process, one session, no logic of its own.
//   POST /        an Action (src/session.ts `Action`, decoded at this boundary) → the events it causes, as SSE, one
//                 `event:` per kind; a failure is an `error` event. Closing the response is the stop: before the first
//                 character of a draft it interrupts the action (nothing is saved, the model request aborts); once a
//                 delta was sent it halts the prose where it is and the turn finishes into a `stopped` node.
//   GET  /nodes   every node's projection, for a client that just opened.
//   GET  /rules   the card's rules as data (field bounds, options, action ids): what the client needs to draw state.
// `inspect` keeps the request messages on `call` events; they carry the card's fragment bodies, so a player client
// gets phase, answer and usage only.
import { decodeAction, perform, type Event, type Session } from "@effect-tavern/runtime/src/session.ts"
import { Cause, Deferred, Effect, Fiber, Stream } from "effect"
import { createServer, type IncomingMessage } from "node:http"

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

export const serve = (session: Session, { inspect = false } = {}) =>
  createServer(async (req, res) => {
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(v))
    }
    if (req.method === "GET" && req.url === "/rules") return json(200, session.rules)
    if (req.method === "GET" && req.url === "/nodes")
      return json(
        200,
        session.nodes().map((t) => session.node(t.id)),
      )
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
    const shown = (e: Event) => (inspect || e.kind !== "call" ? e : { ...e, msgs: [] })
    const stop = Effect.runSync(Deferred.make<void>())
    const fiber = Effect.runFork(
      Stream.runForEach(perform(session, action, Deferred.await(stop)), (e) =>
        Effect.sync(() => {
          // Each draft starts over: a stop before its first character withdraws the turn, even on the correction rewrite.
          if (e.kind === "stage" && e.phase === "narrate") narrating = false
          if (e.kind === "delta") narrating = true
          send(e.kind, shown(e))
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
  })
