import assert from "node:assert/strict"
import { breakpoint, wire, type Message } from "../src/call.ts"

// [sys, usr, sys, asst, sys]; the last one carries a cache breakpoint, which must survive the role change
const sys = (content: string): Message => ({ role: "system", content })
const seq: Message[] = [
  sys("head"),
  { role: "user", content: "line" },
  sys("directive"),
  { role: "assistant", content: "prose" },
  breakpoint(sys("lore")),
]
const roles = (ms: Message[]) => ms.map((m) => m.role)

// anthropic: only the system directly after the assistant becomes user
assert.deepEqual(roles(wire("anthropic", seq)), ["system", "user", "system", "assistant", "user"])
// gemini: the leading system stays, both mid systems become user
assert.deepEqual(roles(wire("gemini", seq)), ["system", "user", "user", "assistant", "user"])
// openai-compatible: unchanged
assert.deepEqual(wire("openai-compatible", seq), seq)

// content and the breakpoint marker ride through the role change
for (const f of ["anthropic", "gemini"] as const) {
  const last = wire(f, seq)[4]!
  assert.equal(last.content, "lore")
  assert.deepEqual(last.providerOptions, seq[4]!.providerOptions)
}
// a list of system messages only stays system on gemini
assert.deepEqual(roles(wire("gemini", [sys("a"), sys("b")])), ["system", "system"])
console.log("wire ok")
