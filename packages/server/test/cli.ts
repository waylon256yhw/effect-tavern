import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scaffold } from "@effect-tavern/runtime/support/author.ts"
import { staticRoot } from "../src/start.ts"
import { app } from "../src/serve.ts"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { readEvents } from "../src/cli-host.ts"
import type { CliEvent } from "../src/cli-host.ts"

const dir = mkdtempSync(join(tmpdir(), "tavern-cli-"))
const bin = new URL("../bin/tavern.ts", import.meta.url).pathname
const env = { ...process.env, DATA: dir, MODEL: "fake", CARDS: "" }
const run = async (...args: string[]) => {
  const child = Bun.spawn(["bun", bin, ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" })
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, out, err }
}
const ok = async (...args: string[]) => {
  const result = await run(...args)
  assert.equal(result.code, 0, result.err)
  return result.out
}
const file = join(dir, "cli.yaml")
writeFileSync(file, scaffold("cli", "chat"))
let server: ReturnType<typeof Bun.spawn> | undefined
try {
  await ok("card", "check", file)
  assert.deepEqual(JSON.parse(await ok("card", "install", file, "--json")), { id: "cli", installed: true })
  const { id: story } = JSON.parse(await ok("story", "new", "cli", "--json"))
  assert.equal(JSON.parse(await ok("story", "list", "--json"))[0].id, story)
  const missing = await run("play", "999999", "--input", "hello")
  assert.equal(missing.code, 1)
  assert.match(missing.err, /no story 999999/)
  const numericFile = join(dir, "numeric.yaml")
  writeFileSync(numericFile, scaffold(String(story), "chat"))
  await ok("card", "install", numericFile)
  const numericEvents = (await ok("play", String(story), "--card", "--input", "/greet", "--jsonl"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
  const numericId = numericEvents.find((e) => e.kind === "story").id
  assert.notEqual(numericId, story)
  assert.equal(JSON.parse(await ok("story", "export", String(numericId), "--json")).card.id, String(story))
  assert.deepEqual(JSON.parse(await ok("story", "drop", String(numericId), "--json")), { id: numericId, deleted: true })
  assert.match(await ok("story", "show", String(story)), /Story .*head root/)
  const events = (await ok("play", String(story), "--input", "hello", "--model", "fake", "--jsonl"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
  assert.ok(events.some((e) => e.kind === "delta"))
  assert.ok(events.some((e) => e.kind === "change" && e.node?.settlementStatus === "committed"))
  const saved = JSON.parse(await ok("story", "export", String(story), "--format", "json"))
  assert.equal(saved.snapshot.nodes.length, 1)
  assert.match(await ok("story", "export", String(story)), /hello world/)
  await ok("play", String(story), "--input", "/greet")
  const before = JSON.parse(await ok("story", "show", String(story), "--json"))

  server = Bun.spawn(["bun", bin, "serve", "--headless", "--port", "0"], {
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const reader = (server.stderr as ReadableStream<Uint8Array>).getReader()
  let address = ""
  const ready = async () => {
    while (!address.includes("/api")) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`serve exited: ${address}`)
      address += new TextDecoder().decode(value)
    }
    reader.releaseLock()
    return address
      .trim()
      .split("\n")
      .find((line) => line.startsWith("http://"))!
  }
  const url = await ready()
  assert.equal((await fetch(url.replace(/\/api$/, "/"))).status, 404)
  const busy = await run("story", "list")
  assert.equal(busy.code, 1)
  assert.match(busy.err, /--url/)
  // Remote requests never open local DATA, even though this library is locked.
  assert.deepEqual(JSON.parse(await ok("story", "show", String(story), "--json", "--url", url)), before)
  await ok("card", "install", file, "--url", url)
  const remote = Number(await ok("story", "new", "cli", "--url", url))
  await ok("play", String(remote), "--url", url, "--input", "remote hello", "--jsonl")
  assert.match(await ok("story", "export", String(remote), "--url", url), /remote hello/)
  await ok("play", String(remote), "--url", url, "--input", "/checkout root", "--jsonl")
  await ok("play", String(remote), "--url", url, "--input", "/tree", "--jsonl")
  await ok("play", String(remote), "--url", url, "--input", "/context", "--jsonl")
  await ok("play", String(remote), "--url", url, "--input", "/detail 0", "--jsonl")
  assert.deepEqual(JSON.parse(await ok("story", "delete", String(remote), "--url", url, "--json")), {
    id: remote,
    deleted: true,
  })
  assert.equal((await run("story", "show", String(remote), "--url", url)).code, 1)
  const invalid = await fetch(`${url}/cards/bad`, { method: "PUT", body: JSON.stringify({ id: "bad" }) })
  assert.equal(invalid.status, 400)
  server.kill("SIGTERM")
  assert.equal(await server.exited, 0)
  server = undefined
  assert.equal(JSON.parse(await ok("story", "list", "--json")).length, 1)
  // The terminal loop accepts a pipe; no raw-mode input is needed.
  const child = Bun.spawn(["bun", bin, "play", String(story), "--jsonl"], {
    cwd: dir,
    env,
    stdin: new Blob(["/note continue\n/tree\n/quit\n"]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  assert.equal(code, 0, err)
  assert.ok(
    out
      .split("\n")
      .filter(Boolean)
      .map((s) => JSON.parse(s))
      .some((e) => e.kind === "tree"),
  )
  // A failing piped line stops all already-buffered later mutations, for command and turn failures.
  for (const bad of ["/badcmd", "/pin card:missing"]) {
    const prior = JSON.parse(await ok("story", "show", String(story), "--json"))
    const pipe = Bun.spawn(["bun", bin, "play", String(story), "--jsonl"], {
      cwd: dir,
      env,
      stdin: new Blob([`/act before\n${bad}\n/act AFTER-ERROR\n`]),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [status, output, error] = await Promise.all([
      pipe.exited,
      new Response(pipe.stdout).text(),
      new Response(pipe.stderr).text(),
    ])
    assert.equal(status, 1, error)
    assert.match(error, bad === "/badcmd" ? /unknown command/ : /not invocable/)
    assert.doesNotMatch(output, /AFTER-ERROR/)
    const after = JSON.parse(await ok("story", "show", String(story), "--json"))
    assert.equal(after.nodes.length, prior.nodes.length + 1)
  }
  // Missing client build gives pure API routing; a built index opts static serving in.
  const dist = join(dir, "client-dist")
  assert.equal(staticRoot(dist), undefined)
  const api = createServer(
    app(async (_req, res) => {
      res.end("api")
    }, staticRoot(dist)),
  )
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve))
  try {
    const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
    assert.equal(await (await fetch(origin + "/api")).text(), "api")
    assert.equal(await (await fetch(origin + "/")).text(), "not found")
    assert.equal((await fetch(origin + "/missing.js")).status, 404)
  } finally {
    await new Promise<void>((resolve) => api.close(() => resolve()))
  }
  mkdirSync(dist)
  writeFileSync(join(dist, "index.html"), "built")
  assert.equal(staticRoot(dist), dist)
} finally {
  server?.kill()
  if (server) await server.exited
  rmSync(dir, { recursive: true, force: true })
}
// A byte at a time, including a multibyte character, CRLF and an attach snapshot.
const bytes = new TextEncoder().encode(
  'event: attach\r\ndata: {"phase":null,"draft":null}\r\n\r\nevent: error\ndata: {"kind":"error","phase":"narrate","message":"错误"}\n\n',
)
const got: CliEvent[] = []
await readEvents(
  new Response(
    new ReadableStream({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]))
        c.close()
      },
    }),
  ),
  (e) => got.push(e),
)
assert.equal(got[0]?.kind, "attach")
assert.equal(got[1]?.kind === "error" && got[1].message, "错误")
await assert.rejects(
  readEvents(new Response('data: {"kind":"change"}'), () => {}),
  /incomplete/,
)
console.log("cli ok")
