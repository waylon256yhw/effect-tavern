import { DatabaseSync } from "node:sqlite"
import assert from "node:assert/strict"
import { LLMock } from "@copilotkit/aimock"
import { decodeCard } from "@effect-tavern/runtime/src/card.ts"
import { scaffold } from "@effect-tavern/runtime/support/author.ts"
import { open } from "../src/data.ts"
import { library, Routing } from "../src/library.ts"
import { shelf } from "../src/tavern.ts"
import { app, handle } from "../src/serve.ts"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"

const mock = new LLMock({ port: 0 })
await mock.start()
const card = decodeCard(Bun.YAML.parse(scaffold("workshop", "chat")))
const data = open(":memory:")
const configure = (db: typeof data) => {
  db.secrets.put({ id: "k", name: "K", type: "api_key", value: "test-key" })
  db.providers.put({
    id: "p",
    name: "P",
    enabled: true,
    secret: "k",
    defaultFormat: "openai-compatible",
    endpoints: { "openai-compatible": { url: mock.url } },
    models: [{ id: "author-model" }],
  })
  db.routing.write(Schema.decodeUnknownSync(Routing)({ stages: { author: { provider: "p", model: "author-model" } } }))
}
configure(data)
const lib = library({ data, cards: shelf([card]) })
const server = createServer(app(handle(lib)))
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const request = (path: string, method = "GET", value?: unknown) =>
  fetch(url + "/api" + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  })
const fixture = (value: unknown) => {
  mock.reset()
  mock.on({ model: "author-model" }, { content: JSON.stringify(value) })
}
const input = { card, select: ["fiction.setting"], intent: "mechanism" }
const good = {
  fields: [{ path: "bond", type: "int", initial: 0, min: 0, max: 10 }],
  actions: [{ id: "close", do: [{ path: "bond", add: 1 }] }],
  bindings: [],
}
const dir = mkdtempSync(join(tmpdir(), "workshop-"))
try {
  // Normal compile leaves only author-owned blanks; no repair is spent on empty-text.
  fixture(good)
  const result = await lib.author.compile(input)
  assert.equal(result.candidate.rules.actions[0]!.text, "")
  assert.ok(result.diagnostics.some((d) => d.rule === "empty-text"))
  assert.equal(mock.getRequests().length, 1)
  const privateCard = {
    ...card,
    guard: ["private guard"],
    greetings: [{ note: "private opening" }],
    products: [
      {
        id: "aside",
        role: "theater" as const,
        text: "private question",
        shape: { kind: "text" as const },
        initial: "private initial",
      },
    ],
    rules: { ...card.rules, actions: [{ id: "old", text: "private rubric" }] },
    fiction: [...card.fiction, { id: "private", text: "unselected prose" }],
  }
  fixture(good)
  await lib.author.compile({ ...input, card: privateCard })
  const sent = JSON.stringify(mock.getRequests())
  for (const text of [
    "private guard",
    "private rubric",
    "unselected prose",
    "private opening",
    "private question",
    "private initial",
  ])
    assert.ok(!sent.includes(text))
  fixture({ ...good, actions: [{ id: "bad", text: "model prose" }] })
  assert.equal((await lib.author.compile(input)).candidate.rules.actions[0]!.text, "")
  // Structural repair receives diagnostics but never the empty rubric diagnostics.
  mock.reset()
  mock.on({ userMessage: /"previous"/ }, { content: JSON.stringify(good) })
  mock.on(
    { model: "author-model" },
    { content: JSON.stringify({ actions: [{ id: "close", do: [{ path: "missing", add: 1 }] }], bindings: [] }) },
  )
  const repaired = await lib.author.compile(input)
  assert.equal(mock.getRequests().length, 2)
  assert.ok(repaired.diagnostics.every((d) => d.level !== "error" || d.rule === "empty-text"))
  assert.ok(!JSON.stringify(mock.getRequests()[1]).includes("empty-text"))
  fixture({ actions: [{ id: "close", do: [{ path: "missing", add: 1 }] }], bindings: [] })
  assert.ok((await lib.author.compile(input)).diagnostics.some((d) => d.rule === "unknown-path"))
  assert.equal(mock.getRequests().length, 2)
  // Three sort fixtures: normal, out-of-range/duplicate, and an extra text field.
  fixture([{ paragraphs: [1, 0], to: "fiction.new" }])
  assert.equal(
    (await lib.author.sort({ card, source: "  one  \n\ntwo" })).candidate.fiction.at(-1)!.text,
    "  one  \n\ntwo",
  )
  assert.equal(
    (await lib.author.sort({ card, source: "ignored", paragraphs: [" a ", " b "] })).candidate.fiction.at(-1)!.text,
    " a \n\n b ",
  )
  for (const paragraphs of [[2], [0, 0]]) {
    fixture([{ paragraphs, to: "fiction.new" }])
    await assert.rejects(lib.author.sort({ card, source: "one" }))
  }
  fixture([{ paragraphs: [0], to: "fiction.new", text: "rewritten" }])
  assert.equal((await lib.author.sort({ card, source: "one" })).candidate.fiction.at(-1)!.text, "one")
  // Three review fixtures: real paths, invented paths, and forbidden severity.
  const warning = { rule: "review:consistency", level: "warn", path: "fiction.setting.text", message: "Check intent" }
  fixture([warning])
  assert.deepEqual((await lib.author.review({ card })).diagnostics, [warning])
  data.routing.write({ default: { provider: "p", model: "author-model" } })
  assert.deepEqual((await lib.author.review({ card })).diagnostics, [warning])
  configure(data)
  fixture([{ ...warning, path: "fiction.missing" }])
  assert.deepEqual((await lib.author.review({ card })).diagnostics, [])
  fixture([{ ...warning, level: "error" }])
  await assert.rejects(lib.author.review({ card }))
  // Direct and HTTP installation have the same gate; failed installs retain the draft.
  lib.drafts.put(card.id, { card: result.candidate })
  assert.equal(lib.drafts.get(card.id).draft, true)
  assert.throws(() => lib.cards.put(result.candidate), /empty-text/)
  const rejected = await request(`/cards/${card.id}`, "PUT", result.candidate)
  assert.equal(rejected.status, 400)
  assert.deepEqual(await rejected.json(), { error: "error empty-text rules.actions.close.text: author text is empty" })
  assert.equal(lib.drafts.get(card.id).draft, true)
  const invalidInitial = {
    ...card,
    rules: { fields: [{ path: "x", type: "int", min: 0, max: 1, initial: 2 }], actions: [] },
  }
  assert.throws(() => lib.cards.put(invalidInitial))
  assert.equal((await request(`/cards/${card.id}`, "PUT", invalidInitial)).status, 400)
  assert.equal((await request(`/cards/${card.id}/draft`)).status, 200)
  assert.equal((await request(`/cards/${card.id}/draft`, "PUT", { card: result.candidate })).status, 200)
  assert.equal((await request(`/cards/${card.id}/draft`, "PUT", { card: { ...card, id: "wrong" } })).status, 400)
  assert.equal((await request(`/cards/${card.id}`, "PUT", card)).status, 200)
  assert.deepEqual(await (await request(`/cards/${card.id}/draft`)).json(), { card, draft: false })
  await request(`/cards/${card.id}/draft`, "PUT", { card: result.candidate })
  assert.equal((await request(`/cards/${card.id}/draft`, "DELETE")).status, 200)
  assert.equal(lib.drafts.get(card.id).draft, false)
  assert.equal((await request("/cards/missing/draft")).status, 404)
  // Canvas updates merge independently of content edits and survive both install and discard.
  const layout = {
    rows: [
      {
        h: 2,
        items: [
          { id: "fiction", w: 3 },
          { id: "rules", w: 1 },
        ],
      },
    ],
  }
  const draftUrl = `/cards/${card.id}/draft`
  assert.equal((await request(draftUrl, "PUT", { layout })).status, 200)
  assert.deepEqual(lib.drafts.get(card.id), { card, draft: false, layout })
  await request(draftUrl, "PUT", { card: result.candidate })
  assert.deepEqual(lib.drafts.get(card.id), { card: result.candidate, draft: true, layout })
  const moved = { rows: [{ h: 1, items: [{ id: "fiction", w: 1 }] }] }
  await request(draftUrl, "PUT", { layout: moved })
  const editing = { card: result.candidate, draft: true, layout: moved }
  assert.deepEqual(lib.drafts.get(card.id), editing)
  for (const value of [
    {},
    { layout: null },
    { layout: { rows: [{ h: 0, items: [] }] } },
    { layout: { rows: [{ h: 1, items: [{ id: "fiction", w: -1 }] }] } },
    { card: { ...card, id: "wrong" }, layout },
  ]) {
    assert.equal((await request(draftUrl, "PUT", value)).status, 400)
    assert.deepEqual(lib.drafts.get(card.id), editing)
  }
  assert.equal((await request(`/cards/${card.id}`, "PUT", result.candidate)).status, 400)
  assert.deepEqual(lib.drafts.get(card.id), editing)
  await request(`/cards/${card.id}`, "PUT", card)
  assert.deepEqual(lib.drafts.get(card.id), { card, draft: false, layout: moved })
  assert.deepEqual(data.drafts.get(card.id), { layout: moved })
  await request(draftUrl, "PUT", { card: result.candidate })
  await request(draftUrl, "DELETE")
  assert.deepEqual(lib.drafts.get(card.id), { card, draft: false, layout: moved })
  await request(draftUrl, "PUT", { layout: { rows: [] } })
  assert.deepEqual(lib.drafts.get(card.id).layout, { rows: [] })
  // CLI runs the same fixtures through both local SQLite routing and --url HTTP.
  const local = open(join(dir, "tavern.db"))
  configure(local)
  local.drafts.put(card.id, { card, layout })
  local.close()
  const legacy = { ...card, id: "legacy" }
  const sql = new DatabaseSync(join(dir, "tavern.db"))
  sql.prepare("insert into draft (id, json) values (?, ?)").run(legacy.id, JSON.stringify(legacy))
  sql.close()
  const reopened = open(join(dir, "tavern.db"))
  assert.deepEqual(reopened.drafts.get(card.id), { card, layout })
  assert.deepEqual(reopened.drafts.get(legacy.id), { card: legacy })
  reopened.drafts.del(card.id)
  reopened.drafts.del(legacy.id)
  assert.deepEqual(reopened.drafts.get(card.id), { layout })
  assert.equal(reopened.drafts.get(legacy.id), undefined)
  reopened.close()
  rmSync(join(dir, "tavern.db.lock"))
  const file = join(dir, "card.yaml"),
    source = join(dir, "notes.md"),
    out = join(dir, "candidate.yaml")
  writeFileSync(file, Bun.YAML.stringify(card))
  writeFileSync(source, "Paragraph one.")
  writeFileSync(join(dir, "card.scenario.yaml"), "steps: []")
  const bin = new URL("../bin/tavern.ts", import.meta.url).pathname
  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, bin, "card", ...args], {
      env: { ...process.env, DATA: dir, MODEL: "", CARDS: "" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    assert.equal(code, 0, stderr)
    if (args[0] === "compile") assert.match(stderr, /scenario: (PASS|FAIL)/)
    return stdout
  }
  for (const remote of [[], ["--url", url]]) {
    // A failed scenario remains advisory: the remote candidate is still written.
    if (remote.length) writeFileSync(join(dir, "card.scenario.yaml"), "steps: invalid")
    fixture(good)
    await run(
      "compile",
      file,
      "--select",
      "fiction.setting",
      "--select",
      "greetings[0]",
      "--intent",
      "mechanism",
      "-o",
      out,
      ...remote,
    )
    assert.equal(decodeCard(Bun.YAML.parse(await Bun.file(out).text())).rules.actions[0]!.text, "")
    fixture([{ paragraphs: [0], to: "fiction.new" }])
    assert.equal(
      decodeCard(Bun.YAML.parse(await run("sort", file, source, ...remote))).fiction.at(-1)!.text,
      "Paragraph one.",
    )
    fixture([warning])
    assert.deepEqual(JSON.parse(await run("review", file, "--json", ...remote)), [warning])
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  data.close()
  await mock.stop()
  rmSync(dir, { recursive: true, force: true })
}
console.log("workshop host: ok")
