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
// set at runtime on a popup by @ui-sdk (its styling contract), not design constants
const runtime = new Set(["--anchor-width", "--available-height"])
const missing = [...used].filter(([t]) => !defined.has(t) && !runtime.has(t))
assert.deepEqual(missing, [], `undefined tokens: ${missing.map(([t, f]) => `${t} (${f})`).join(", ")}`)
const unused = [...defined].filter(
  (t) => !used.has(t) && !readFileSync(join(src, "tokens.css"), "utf8").includes(`var(${t})`),
)
console.log(`tokens: ${defined.size} defined, ${used.size} used, ${unused.length} not yet used`)

// Radius and spacing come off the rulers: no px or rem literal in a border-radius, padding, margin or gap outside tokens.css.
const ruled =
  /(?<![\w-])(border(?:-[a-z]+)*-radius|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:([^;{}]*)/g
const literal = /(?<![\w.-])-?(\d*\.)?\d+(px|rem)\b/
const off: string[] = []
for (const f of readdirSync(src)) {
  if (f === "tokens.css" || !f.endsWith(".css")) continue
  // blank comments out, keeping newlines so line numbers hold
  const text = readFileSync(join(src, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
  for (const m of text.matchAll(ruled)) {
    if (!literal.test(m[2]!)) continue
    const line = text.slice(0, m.index).split("\n").length
    off.push(`${f}:${line} ${m[0].replace(/\s+/g, " ").trim()}`)
  }
}
assert.deepEqual(off, [], `radius or spacing off the token rulers:\n${off.join("\n")}`)

// An anchored box names an anchor that exists: without one it falls to the viewport's corner (the jump to the latest
// turn did, when the composer's menu stopped needing the box's name).
const css = readdirSync(src)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(src, f), "utf8"))
  .join("\n")
const anchors = new Set([...css.matchAll(/anchor-name:\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))
const adrift = [...css.matchAll(/position-anchor:\s*(--[a-z0-9-]+)/g)].map((m) => m[1]!).filter((a) => !anchors.has(a))
assert.deepEqual(adrift, [], `position-anchor without an anchor-name: ${adrift.join(", ")}`)
