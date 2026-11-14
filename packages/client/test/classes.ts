// The Timeline page wears the Inspect page's chrome (`class="inspect timeline"`), so every `.inspect .x` rule reaches
// its markup. What the two pages share is this list and nothing else: a class the Timeline uses for a piece of its
// own must not be one inspector.css styles (a pre-check `.bar` once flattened the Timeline's title row).
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")
const shared = "bad cols dim icon inspect lbl meta node ok pane pill pipeline sechead seg spacer sums top v".split(" ")
const attrs = read("timeline.tsx").match(/class=(?:"[^"]*"|\{\{[^}]*\}\})/g) ?? []
const used = new Set(attrs.flatMap((a) => a.match(/(?<=["{,\s])[a-z][a-z0-9-]*(?=["\s:])/g) ?? []))
const css = read("inspector.css").replace(/\/\*[\s\S]*?\*\//g, "")
const styled = new Set(
  [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) =>
    m[1]!.includes(".inspect") ? m[1]!.match(/(?<=\.)[a-z][a-z0-9-]*/g)! : [],
  ),
)
const both = [...used].filter((c) => styled.has(c)).sort()
assert.deepEqual(both, shared, "timeline.tsx and inspector.css share exactly the Inspect chrome")
console.log(`classes: the Timeline shares ${both.length} with the Inspect page`)
