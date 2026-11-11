import assert from "node:assert/strict"
import { responseError, responseValue } from "../src/response.ts"
const busy = () => new Response(JSON.stringify({ error: "story is busy", code: "busy" }), { status: 409 })
const streamError = await responseError(busy())
assert.equal(streamError.message, "story is busy")
assert.equal(streamError.code, "busy")
await assert.rejects(
  responseValue(busy()),
  (e: Error & { code?: string }) => e.message === streamError.message && e.code === "busy",
)
assert.equal(
  (await responseError(new Response("upstream unavailable", { status: 502 }))).message,
  "upstream unavailable",
)
assert.equal((await responseError(new Response("", { status: 503 }))).message, "HTTP 503")
assert.deepEqual(await responseValue(new Response('{"ok":true}')), { ok: true })
console.log("response ok")
