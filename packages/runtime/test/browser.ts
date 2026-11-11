// Build the browser entry and execute without Node/Bun globals, including the resource hash used by preview.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { runInNewContext } from "node:vm"
import { checkValue } from "../src/author.ts"
import { revision } from "../src/context.ts"
import { loadCard, player } from "./cards/index.ts"

const built = await Bun.build({
  entrypoints: [new URL("./browser-entry.ts", import.meta.url).pathname],
  target: "browser",
  format: "iife",
})
assert.ok(built.success, built.logs.map((log) => log.message).join("\n"))
const browser = runInNewContext(`${await built.outputs[0]!.text()}; authoring`, {
  TextEncoder,
  TextDecoder,
  structuredClone,
  AbortController,
  AbortSignal,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
}) as import("./browser-entry.ts").Authoring
for (const value of ["中文 👩‍👧", { z: 1, a: { y: 2, x: [true, "词条"] } }, { a: 1, b: 2 }]) {
  const canonical = JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  )
  const expected = createHash("sha256").update(canonical).digest("hex")
  assert.equal(revision(value), expected)
  assert.equal(browser.revision(value), expected)
}
assert.equal(browser.revision({ b: 2, a: 1 }), browser.revision({ a: 1, b: 2 }))
const card = await loadCard("wuxia")
// Cross-realm objects have different prototypes; compare their wire value.
assert.equal(JSON.stringify(browser.checkValue(card, player)), JSON.stringify(checkValue(card, player)))
assert.ok(browser.checkValue({ ...card, rules: null }).diagnostics.some((d) => d.level === "error"))
assert.equal(browser.applyCompile(card, { cap: 7, bindings: [] }).rules.cap, 7)
assert.equal(typeof browser.applySort, "function")
console.log("browser authoring: ok")
