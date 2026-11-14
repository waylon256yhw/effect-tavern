// `vp run verify:ui`: the controls fixture (test/controls.tsx) in headless Chrome, which posts its result back here.
// Not in `verify`: it needs a browser. CHROME names the binary when it is not the macOS default.
import assert from "node:assert/strict"
import { existsSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { $ } from "bun"

const chrome = process.env["CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
assert.ok(existsSync(chrome), `no Chrome at ${chrome}; set CHROME`)
const page = (await $`bun test/build-browser.ts test/controls.tsx`.text()).trim()
const result = Promise.withResolvers<{ failures: string[]; snapshot: unknown[] }>()
const server = Bun.serve({
  port: 0,
  fetch: async (req) => {
    if (req.method !== "POST") return new Response(Bun.file(page))
    result.resolve(await req.json())
    return new Response()
  },
})
const browser = Bun.spawn([chrome, "--headless=new", "--disable-gpu", `http://localhost:${server.port}/`], {
  stdout: "ignore",
  stderr: "ignore",
})
const timer = setTimeout(() => result.reject(new Error("the fixture posted no result in 30s")), 30_000)
try {
  const { failures, snapshot } = await result.promise
  assert.deepEqual(failures, [])
  console.log("ui: the controls and dialogs answer the agent bridge, " + snapshot.length + " still on the page")
} finally {
  clearTimeout(timer)
  browser.kill()
  void server.stop(true)
  rmSync(dirname(page), { recursive: true, force: true })
}
