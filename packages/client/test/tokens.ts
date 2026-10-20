// Every var(--x) used under src must be defined in src/tokens.css: the token file is the one source of design constants.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const src = new URL("../src/", import.meta.url).pathname
const defined = new Set(
  [...readFileSync(join(src, "tokens.css"), "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
)
const used = new Map<string, string>()
for (const f of readdirSync(src)) {
  if (f === "tokens.css" || !/\.(css|tsx?)$/.test(f)) continue
  for (const m of readFileSync(join(src, f), "utf8").matchAll(/var\((--[a-z0-9-]+)/g)) used.set(m[1]!, f)
}
const missing = [...used].filter(([t]) => !defined.has(t))
assert.deepEqual(missing, [], `undefined tokens: ${missing.map(([t, f]) => `${t} (${f})`).join(", ")}`)
const unused = [...defined].filter(
  (t) => !used.has(t) && !readFileSync(join(src, "tokens.css"), "utf8").includes(`var(${t})`),
)
console.log(`tokens: ${defined.size} defined, ${used.size} used, ${unused.length} not yet used`)
