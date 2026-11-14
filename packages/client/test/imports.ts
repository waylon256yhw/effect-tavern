// What the client pulls into a browser: every module reachable from src/ through value imports, across the runtime and
// provider packages, must be free of Node (`node:*`) and must not be the provider's index, which re-exports the whole
// package (the ai-sdk drivers, the local key reader). bun runs such a graph without complaint and Vite serves each
// module; only the browser fails, with a white page (#180: a threshold imported from runtime decision.ts, which had
// gained a value import of the provider). `import type` is erased and does not count.
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const packages = resolve(import.meta.dir, "../..")
const INDEX = join(packages, "provider/src/index.ts")
const at = (from: string, spec: string): string | undefined => {
  if (spec === "@effect-tavern/provider") return INDEX
  const m = /^@effect-tavern\/(runtime|provider)\/(.+)$/.exec(spec)
  if (m) return join(packages, m[1]!, m[2]!)
  if (spec.startsWith(".")) return resolve(dirname(from), spec)
  return undefined // a dependency: Vite's to bundle
}
/** A file's value imports and re-exports: [specifier]. */
const imports = (file: string): string[] =>
  [
    ...readFileSync(file, "utf8").matchAll(/^(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm),
  ].map((m) => m[1]!)

const seen = new Map<string, string>() // file → the file that imported it
const queue = readdirSync(join(import.meta.dir, "../src"), { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => join(import.meta.dir, "../src", f))
for (const f of queue) seen.set(f, "")
const chain = (f: string): string => {
  const out = [f]
  for (let x = seen.get(f); x; x = seen.get(x)) out.push(x)
  return out.map((x) => x.slice(packages.length + 1)).join(" ← ")
}
while (queue.length) {
  const file = queue.pop()!
  for (const spec of imports(file)) {
    assert.ok(!spec.startsWith("node:"), `${spec} reaches the browser: ${chain(file)}`)
    const next = at(file, spec)
    if (!next || !/\.tsx?$/.test(next) || !existsSync(next) || seen.has(next)) continue
    seen.set(next, file)
    assert.notEqual(next, INDEX, `the provider's index reaches the browser: ${chain(next)}`)
    queue.push(next)
  }
}
console.log(`imports ok: ${seen.size} modules`)
