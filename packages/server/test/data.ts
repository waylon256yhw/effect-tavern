// The library (src/data.ts) in memory: a story's store is log.ts's Store, written change by change and read back as
// the same log, with head and next kept so a dropped id never returns; deleting a story takes its nodes with it; the
// local rows round-trip their JSON; the old player row migrates once.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { open, traced } from "../src/data.ts"

type Row = Record<string, unknown>

interface N extends L.Noded {
  text: string
  input?: { text: string; note?: string; invoke?: readonly string[] } // a turn's player input, what `turns` counts
  reply?: { type: string; text: string }[] // the model's parts; the text ones are the prose the search reads
}
const data = open(":memory:")

// Store: the authority commits, a fresh holder over the same rows equals it, and the next id is the stored one.
const story = data.stories.create("wuxia")
assert.deepEqual({ ...data.stories.get(story) }, { id: story, card: "wuxia", persona: null })
assert.equal(data.stories.get(999), undefined)
const store = data.store<N>(story)
const h = L.hold<N>(store)
h.commit(L.add(h.log, { parent: null, text: "r" }))
h.commit(L.add(h.log, { parent: 0, text: "c" }))
h.commit(L.amend(h.log, 1, { text: "c'" }))
h.commit(L.drop(h.log, 1))
const back = L.hold<N>(data.store<N>(story))
assert.deepEqual(L.snapshot(back.log), { nodes: [{ id: 0, parent: null, text: "r" }], head: 0, next: 2 })
assert.equal(back.commit(L.add(back.log, { parent: 0, text: "d" })).node!.id, 2)
assert.throws(() => data.store<N>(99).read(), /no story 99/)
// a node written before #76 §二 holds an `aside` part: read back without it
back.commit(
  L.amend(back.log, 0, {
    reply: [
      { type: "text", text: "p" },
      { type: "aside", text: "a" },
    ],
  }),
)
assert.deepEqual(data.store<N>(story).read()!.nodes[0]!.reply, [{ type: "text", text: "p" }])
back.commit(L.amend(back.log, 0, { reply: undefined }))

// Calls: filed under a node in order, read back by node; gone with the node, and with the story.
const trace = data.calls(story)
trace.add(0, [{ phase: "narrate" }, { phase: "record" }])
trace.add(2, [{ phase: "lookup" }])
back.commit(L.amend(back.log, 0, { text: "r'" })) // an amend updates the node in place (never cascades to its calls)
trace.add(0, [{ phase: "record" }]) // and appends its own call
assert.deepEqual(trace.list(), {
  0: [{ phase: "narrate" }, { phase: "record" }, { phase: "record" }],
  2: [{ phase: "lookup" }],
})
back.commit(L.drop(back.log, 2))
assert.deepEqual(Object.keys(trace.list()), ["0"])

// Only a story's last `traced` nodes keep their calls, last by newest call: the oldest go on each add, and an amended
// old node is recent again (its earlier calls already gone), taking the slot of the then-oldest.
{
  const long = data.stories.create("trim")
  const t = L.hold<N>(data.store<N>(long))
  const calls = data.calls(long)
  const count = traced + 5
  for (let i = 0; i < count; i++) {
    const n = t.commit(L.add(t.log, { parent: i ? i - 1 : null, text: String(i) })).node!
    calls.add(n.id, [{ node: n.id }, { node: n.id, phase: "record" }])
  }
  const ids = (from: number) => Array.from({ length: count - from }, (_, k) => String(from + k))
  assert.deepEqual(Object.keys(calls.list()), ids(5))
  assert.deepEqual(calls.list()[5], [{ node: 5 }, { node: 5, phase: "record" }])
  calls.add(0, [{ node: 0, again: true }])
  assert.deepEqual(Object.keys(calls.list()), ["0", ...ids(6)])
  assert.deepEqual(calls.list()[0], [{ node: 0, again: true }])
  data.calls(story).add(0, [{ phase: "other story" }]) // another story's trim leaves this one alone
  assert.equal(Object.keys(calls.list()).length, traced)
  data.stories.del(long)
}

// Stories list newest first per card, each with its turns: on the head's line, the nodes with a player line or a note
// to the narrator; a root without input (a greeting) and a node whose input is blank are none, and a swipe (a sibling
// with the parent's input) is the one turn it versions. Deleting one cascades to its nodes.
back.commit(L.add(back.log, { parent: 0, text: "said", input: { text: "hello" } }))
back.commit(L.add(back.log, { parent: 3, text: "noted", input: { text: "", note: "slower" } }))
back.commit(L.add(back.log, { parent: 4, text: "blank", input: { text: "" } }))
assert.equal(data.stories.list("wuxia")[0]!.turns, 2) // the root "r" has no input, "blank" an empty one
back.commit(L.add(back.log, { parent: 0, text: "said again", input: { text: "hello" } })) // a swipe of node 3: head 6
assert.equal(data.stories.list("wuxia")[0]!.turns, 1) // the line is 6 → 0: one turn, the other line's not counted
back.commit(L.checkout(back.log, 3)) // back on the first line, at its newest leaf
assert.equal(data.stories.list("wuxia")[0]!.turns, 2)
const second = data.stories.create("wuxia") // made after the commits above: newest, so first
assert.deepEqual(
  data.stories.list("wuxia").map((s) => [s.id, s.turns]),
  [
    [second, 0],
    [story, 2],
  ],
)
assert.equal(data.stories.list("other").length, 0)
// The row's `last` is the input of the line's last turn (the note-only one here), null on the fresh story; a star is
// a flag on the row, off by default and leaving `updated` alone.
assert.deepEqual(
  data.stories.list("wuxia").map((s) => [s.starred, s.last]),
  [
    [false, null],
    [false, { text: "", note: "slower" }],
  ],
)
data.stories.star(story, true)
assert.deepEqual(
  data.stories.list("wuxia").map((s) => [s.id, s.starred]),
  [
    [second, false],
    [story, true],
  ],
)
// The search: the head's line only (node 6, the swipe off the line, never hits), the earliest hit node first with the
// field that hit (the line, then the note, then the prose) cut to a window, numbered by the turns up to it (the
// greeting is turn 0), and the count of hit nodes; ASCII case folds; blank hits nothing.
back.commit(L.amend(back.log, 0, { reply: [{ type: "text", text: "An opening scene." }] }))
back.commit(
  L.add(back.log, {
    parent: 5,
    text: "rain",
    input: { text: "look up" },
    reply: [
      { type: "reasoning", text: "hidden hello" },
      { type: "text", text: "A rainy night " },
      { type: "text", text: "on Bamboo Ridge." },
    ],
  }),
)
const hits = (q: string) => data.stories.search("wuxia", q)
assert.deepEqual(hits("hello"), [{ id: story, turn: 1, kind: "input", text: "hello", count: 1 }])
assert.deepEqual(hits("SLOWER"), [{ id: story, turn: 2, kind: "note", text: "slower", count: 1 }])
assert.deepEqual(hits("Ärger"), []) // only ASCII folds, on both sides: Ä stays Ä (SQLite's lower()), so the query must match as typed
back.commit(L.add(back.log, { parent: 7, text: "umlaut", input: { text: "Ärger im İstanbul" } }))
assert.deepEqual(hits("Ärger"), [{ id: story, turn: 4, kind: "input", text: "Ärger im İstanbul", count: 1 }])
assert.deepEqual(hits("ärger"), [])
assert.equal(hits("stan")[0]!.text, "Ärger im İstanbul") // the fold keeps the length: the window is cut where it was found
back.commit(L.drop(back.log, 8))
assert.deepEqual(hits("bamboo"), [
  { id: story, turn: 3, kind: "reply", text: "A rainy night on Bamboo Ridge.", count: 1 },
])
assert.deepEqual(hits("opening"), [{ id: story, turn: 0, kind: "reply", text: "An opening scene.", count: 1 }])
assert.deepEqual(hits("n"), [{ id: story, turn: 0, kind: "reply", text: "An opening scene.", count: 2 }]) // the root and node 7
assert.deepEqual([hits("hidden"), hits(""), hits("  ")], [[], [], []]) // a reasoning part is not prose
assert.deepEqual(data.stories.search("other", "hello"), [])

{
  const long = `${"x".repeat(50)}needle${"y".repeat(200)}`
  back.commit(L.add(back.log, { parent: 7, text: "long", input: { text: long } }))
  assert.equal(hits("needle")[0]!.text, `…${"x".repeat(30)}needle${"y".repeat(90)}…`)
  back.commit(L.drop(back.log, 9))
}
// A batch delete takes the card's own among the ids given in one go, answering them; another card's and a stranger's
// are skipped. The listing narrows to one story by id, none for another card's. Without a card the listing and the
// search are every card's, each row naming its card, and one story is found by id alone.
{
  const [x, y, z] = [data.stories.create("wuxia"), data.stories.create("wuxia"), data.stories.create("other")]
  assert.deepEqual(
    data.stories.list("wuxia", y).map((s) => s.id),
    [y],
  )
  assert.deepEqual([data.stories.list("wuxia", z), data.stories.list("wuxia", 9999)], [[], []])
  assert.deepEqual(
    data.stories.list(undefined, z).map((s) => [s.id, s.card]),
    [[z, "other"]],
  )
  assert.deepEqual(
    data.stories.list().map((s) => s.card),
    ["other", "wuxia", "wuxia", "wuxia", "wuxia"],
  )
  assert.deepEqual(data.stories.search(undefined, "hello"), data.stories.search("wuxia", "hello")) // "other" has none
  // the one row, its line walked alone, equal to its row in the whole listing
  assert.deepEqual(
    data.stories.list("wuxia", story)[0],
    data.stories.list("wuxia").find((s) => s.id === story),
  )
  assert.deepEqual(data.stories.delMany("wuxia", [x, y, z, 9999]), [x, y])
  assert.equal(data.stories.list("other").length, 1)
  data.stories.del(z)
  assert.deepEqual(
    data.stories.list("wuxia").map((s) => s.id),
    [story, second], // the commits above made `story` the newer
  )
}
// A chip-only input is a player turn in both shelf counts and search result numbering.
{
  const id = data.stories.create("chips")
  const h = L.hold<N>(data.store<N>(id))
  const g = h.commit(L.add(h.log, { parent: null, text: "greeting", input: { text: "" } })).node!
  const n = h.commit(
    L.add(h.log, {
      parent: g.id,
      text: "chip",
      input: { text: "", invoke: ["pack:p/guide"] },
      reply: [{ type: "text", text: "CHIP ONLY RESPONSE" }],
    }),
  ).node!
  assert.equal(data.stories.list("chips", id)[0]!.turns, 1)
  assert.equal(data.stories.search("chips", "CHIP ONLY RESPONSE")[0]!.turn, 1)
  assert.deepEqual(data.stories.list("chips", id)[0]!.last, n.input)
  data.stories.del(id)
}
data.stories.del(story)
assert.deepEqual(
  data.stories.list("wuxia").map((s) => s.id),
  [second],
)
assert.throws(() => data.store<N>(story).read(), /no story/)
assert.deepEqual(trace.list(), {})

// A library made before `story.starred` existed gets the column on open, its rows unstarred.
{
  const dir = mkdtempSync(join(tmpdir(), "tavern-old-"))
  const file = join(dir, "tavern.db")
  const old = new DatabaseSync(file)
  old.exec(`create table story (id integer primary key autoincrement, card text not null, title text, head integer,
    next integer not null default 0, updated integer not null);
    insert into story (card, updated) values ('wuxia', 1), ('other', 2);
    create table player (id integer primary key check (id = 1), json text not null);
    insert into player (id, json) values (1, '{"persona":{"wuxia":"monk"}}');`)
  old.close()
  const opened = open(file)
  assert.deepEqual(
    opened.stories.list("wuxia").map((s) => [s.starred, s.turns, s.last]),
    [[false, 0, null]],
  )
  // `story.persona` arrives with the card's pick as it stood: a running story keeps its persona through the upgrade
  assert.deepEqual(
    opened.stories.list().map((s) => [s.card, s.persona]),
    [
      ["other", null],
      ["wuxia", "monk"],
    ],
  )
  opened.stories.star(1, true)
  assert.equal(opened.stories.list("wuxia")[0]!.starred, true)
  opened.close()
  rmSync(dir, { recursive: true, force: true })
}

// A library whose story table predates `autoincrement` is rebuilt on open: the rows and their nodes kept under the
// same ids, and a deleted story's id never handed to the next one made (the client tells the placeholder from the
// story it was on by the id).
{
  const dir = mkdtempSync(join(tmpdir(), "tavern-noinc-"))
  const file = join(dir, "tavern.db")
  const old = new DatabaseSync(file)
  old.exec(`create table story (id integer primary key, card text not null, title text, head integer,
    next integer not null default 0, updated integer not null);
    create table node (story integer not null references story (id) on delete cascade, id integer not null,
    parent integer, json text not null, primary key (story, id));
    insert into story (id, card, head, updated) values (1, 'wuxia', 0, 1), (3, 'wuxia', 0, 2);
    insert into node (story, id, parent, json) values (1, 0, null, '{}'), (3, 0, null, '{}');`)
  old.close()
  const opened = open(file)
  assert.deepEqual(
    opened.stories.list("wuxia").map((s) => s.id),
    [3, 1],
  )
  opened.stories.del(3)
  assert.equal(opened.stories.create("wuxia"), 4) // not 3 again
  opened.close()
  const after = new DatabaseSync(file)
  assert.match(
    String((after.prepare("select sql from sqlite_master where name = 'story'").get() as { sql: string }).sql),
    /autoincrement/i,
  )
  // 3's node cascaded with its story (foreign keys back on after the rebuild), 1's kept through it
  assert.deepEqual(
    (after.prepare("select story, id from node order by story").all() as Row[]).map((r) => [r["story"], r["id"]]),
    [[1, 0]],
  )
  after.close()
  rmSync(dir, { recursive: true, force: true })
}

// Personas by name; the player row: JSON in, the same out (which persona is on which card is the player's).
data.personas.put({ id: "friend", name: "旧友", text: "你是替故人送还遗物的旧友。" })
data.personas.put({ id: "monk", name: "行脚僧", text: "你是路过的行脚僧。" })
assert.deepEqual(
  data.personas.list().map((p) => [p.id, p.text]),
  [
    ["friend", "你是替故人送还遗物的旧友。"],
    ["monk", "你是路过的行脚僧。"],
  ],
) // byte order: 旧 (U+65E7) before 行 (U+884C)
data.personas.del("monk")
assert.deepEqual(
  data.personas.list().map((p) => p.id),
  ["friend"],
)
// Hats: the row's id and name, the rest in the json column, the same hat back.
const hat = { id: "h", name: "续写", narrate: { head: [{ role: "user" as const, text: "U" }] }, review: { head: [] } }
data.hats.put(hat)
assert.deepEqual(data.hats.list(), [hat])
data.hats.del("h")
assert.deepEqual(data.hats.list(), [])
// Secrets and providers: the same named-row shape; routing: one row, JSON in, the same out.
const secret = { id: "s", name: "Key", type: "api_key" as const, value: "sk-0123456789abcdef" }
data.secrets.put(secret)
assert.deepEqual(data.secrets.list(), [secret])
const provider = {
  id: "p",
  name: "Relay",
  enabled: true,
  defaultFormat: "anthropic" as const,
  endpoints: { anthropic: { url: "https://relay.example/v1", exactPrefix: true } },
  secret: "s",
  proxy: false as const,
  models: [{ id: "m", format: "openai-compatible" as const, capabilities: { prefill: true } }],
}
data.providers.put(provider)
assert.deepEqual(data.providers.list(), [provider])
data.providers.del("p")
data.secrets.del("s")
assert.deepEqual([data.providers.list(), data.secrets.list()], [[], []])
assert.equal(data.routing.read(), undefined)
const routing = { default: { provider: "p", model: "m" }, stages: { lookup: { provider: "p", model: "n" } } }
data.routing.write(routing)
assert.deepEqual(data.routing.read(), routing)
assert.equal(data.locals.get("wuxia"), undefined)
const here = { id: "local", name: "wuxia", card: "wuxia", persona: "friend", mounts: ["k"] }
data.locals.put(here)
assert.deepEqual(data.locals.get("wuxia"), here)
assert.deepEqual(data.locals.list(), [here])
data.close()

// The player row of a library from before layer.ts (docs/packs-brief.md §九 §4, §十 §3): once, on open, into the overlay and a local
// row per card, a pack's `theaters` into its product patches; then the table is gone and a second open changes nothing.
{
  const dir = mkdtempSync(join(tmpdir(), "tavern-player-"))
  const file = join(dir, "tavern.db")
  const old = new DatabaseSync(file)
  const player = {
    writing: { pov: "second", echo: true, polish: false, lexicon: [{ pattern: "x", hint: "h" }] },
    global: [
      { id: "language", text: "L" }, // no mode: a global fragment yielded
      { id: "style", text: "S", mode: "override", when: { all: [] }, role: "user" },
    ],
    forCard: { wuxia: [{ id: "voice", text: "V" }], other: [] },
    persona: { wuxia: "monk" },
    packs: { wuxia: ["kit", "gone"] },
    names: { wuxia: { char: "C" } },
    tags: { yandao: ["t"] },
    asks: [{ id: "lookup", text: "ASK" }, { id: "slotless" }],
    products: { options: true, inner: false },
    theaters: [{ id: "town", label: "T", text: "gossip", on: true }],
    snippets: [{ name: "q", text: "Q" }],
    format: [{ label: "k", text: "K" }],
  }
  old.exec(`create table player (id integer primary key check (id = 1), json text not null);
    create table pack (id text primary key, name text not null, json text not null);`)
  old.prepare("insert into player (id, json) values (1, ?)").run(JSON.stringify(player))
  old
    .prepare("insert into pack (id, name, json) values (?, ?, ?)")
    .run(
      "kit",
      "Kit",
      JSON.stringify({ theaters: [{ id: "town", text: "pack" }], snippets: [{ name: "p", text: "P" }] }),
    )
  old
    .prepare("insert into pack (id, name, json) values (?, ?, ?)")
    .run("older", "Older", JSON.stringify({ products: { options: false } })) // before §七: a map that did nothing
  old.close()
  const toggles = [
    { id: "options", on: true },
    { id: "inner", on: false },
  ]
  const check = (d: ReturnType<typeof open>) => {
    assert.deepEqual(
      d.packs
        .list()
        .map((p) => p.id)
        .sort(),
      ["harness", "kit", "older"],
    )
    const [overlay, kit, older] = ["harness", "kit", "older"].map((id) => d.packs.list().find((p) => p.id === id)!)
    assert.deepEqual(overlay, {
      id: "harness",
      name: "内置",
      fragments: [
        { id: "language", text: "L", mode: "yield" }, // the old default written down
        { id: "style", text: "S", mode: "override" }, // no Cond and no role below the card
      ],
      switches: { pov: "second", echo: true, polish: false },
      asks: [{ id: "lookup", text: "ASK" }],
      products: [{ id: "town", label: "T", text: "gossip", on: true }, ...toggles],
      lexicon: [{ pattern: "x", hint: "h" }],
      snippets: [{ name: "q", text: "Q" }],
      format: [{ label: "k", text: "K" }],
    })
    assert.deepEqual(kit, {
      id: "kit",
      name: "Kit",
      products: [{ id: "town", text: "pack" }],
      snippets: [{ name: "p", text: "P" }],
    })
    assert.deepEqual(older, { id: "older", name: "Older" })
    assert.deepEqual(d.locals.get("wuxia"), {
      id: "local",
      name: "wuxia",
      card: "wuxia",
      fragments: [{ id: "voice", text: "V" }],
      products: toggles,
      names: { char: "C" },
      mounts: ["kit", "gone"],
      persona: "monk",
    })
    assert.deepEqual(d.locals.get("yandao"), {
      id: "local",
      name: "yandao",
      card: "yandao",
      products: toggles,
      tags: ["t"],
    })
    assert.deepEqual(d.locals.get("other"), { id: "local", name: "other", card: "other", products: toggles })
  }
  const first = open(file)
  check(first)
  first.packs.put({ id: "kit", name: "Kit" }) // an edit after the migration must survive the next open
  first.close()
  const probe = new DatabaseSync(file)
  assert.equal(probe.prepare("select 1 from sqlite_master where name = 'player'").get(), undefined)
  probe.close()
  const second = open(file)
  assert.deepEqual(
    second.packs.list().find((p) => p.id === "kit"),
    { id: "kit", name: "Kit" },
  )
  second.close()
  rmSync(dir, { recursive: true, force: true })
}

// The `base` row of a library from before §十: once, on open, into the overlay, then gone. Lists the overlay's first, the
// base's copy standing on a shared key (it was the higher rank), switches and product patches by key with the base's on
// top; a base fragment with no mode overrode the card, and says so now. With no overlay stored, it becomes one.
{
  const dir = mkdtempSync(join(tmpdir(), "tavern-base-"))
  const file = join(dir, "tavern.db")
  const put = (d: DatabaseSync, id: string, name: string, json: unknown) =>
    d.prepare("insert into pack (id, name, json) values (?, ?, ?)").run(id, name, JSON.stringify(json))
  const old = new DatabaseSync(file)
  old.exec("create table pack (id text primary key, name text not null, json text not null)")
  put(old, "harness", "内置", {
    fragments: [
      { id: "a", text: "OVER-A" },
      { id: "s", text: "OVER-S" },
    ],
    switches: { pov: "second", verbosity: "concise" },
    asks: [{ id: "lookup", text: "OVER" }],
    products: [{ id: "notes", label: "OVER", text: "OVER" }],
    lexicon: [{ pattern: "o" }],
    snippets: [{ name: "q", text: "OVER" }],
  })
  put(old, "base", "全局基底", {
    fragments: [
      { id: "s", text: "BASE-S" },
      { id: "b", text: "BASE-B", mode: "yield" },
    ],
    switches: { pov: "third" },
    asks: [
      { id: "lookup", text: "BASE" },
      { id: "direct", text: "BASE-D" },
    ],
    products: [
      { id: "notes", text: "BASE", on: false },
      { id: "town", text: "gossip" },
    ],
    lexicon: [{ pattern: "b" }],
    entries: [{ id: "e", text: "E." }],
    format: [{ label: "k", text: "K" }],
    names: { place: "B" },
  })
  put(old, "kit", "Kit", {})
  old.close()
  const merged = {
    id: "harness",
    name: "内置",
    fragments: [
      { id: "a", text: "OVER-A" },
      { id: "s", text: "BASE-S", mode: "override" },
      { id: "b", text: "BASE-B", mode: "yield" },
    ],
    switches: { pov: "third", verbosity: "concise" },
    asks: [
      { id: "lookup", text: "BASE" },
      { id: "direct", text: "BASE-D" },
    ],
    products: [
      { id: "notes", label: "OVER", text: "BASE", on: false },
      { id: "town", text: "gossip" },
    ],
    entries: [{ id: "e", text: "E." }],
    lexicon: [{ pattern: "o" }, { pattern: "b" }],
    snippets: [{ name: "q", text: "OVER" }],
    format: [{ label: "k", text: "K" }],
    names: { place: "B" },
  }
  const ids = (d: ReturnType<typeof open>) =>
    d.packs
      .list()
      .map((p) => p.id)
      .sort()
  const first = open(file)
  assert.deepEqual(ids(first), ["harness", "kit"])
  assert.deepEqual(
    first.packs.list().find((p) => p.id === "harness"),
    merged,
  )
  first.close()
  const second = open(file)
  assert.deepEqual(
    second.packs.list().find((p) => p.id === "harness"),
    merged,
  ) // the second open changes nothing
  second.close()

  const lone = join(dir, "lone.db")
  const had = new DatabaseSync(lone)
  had.exec("create table pack (id text primary key, name text not null, json text not null)")
  put(had, "base", "全局基底", { names: { n: "N" } })
  had.close()
  const alone = open(lone)
  assert.deepEqual(alone.packs.list(), [{ id: "harness", name: "内置", names: { n: "N" } }])
  alone.close()

  const nil = join(dir, "nil.db")
  const none = new DatabaseSync(nil)
  none.exec("create table pack (id text primary key, name text not null, json text not null)")
  put(none, "base", "全局基底", {})
  none.close()
  const blank = open(nil)
  assert.deepEqual(blank.packs.list(), []) // nothing in it: no row
  blank.close()
  rmSync(dir, { recursive: true, force: true })
}

// Nodes written before Step 2/3 (holding `reply` and `products` without `settlementStatus`/`changes`/`deliveries`/`opportunities`)
// are upgraded once on open: world records/tables move to `changes`, chronicle/theater stay in `products`.
{
  const dir = mkdtempSync(join(tmpdir(), "tavern-nodes-"))
  const file = join(dir, "tavern.db")
  const old = new DatabaseSync(file)
  old.exec(`create table story (id integer primary key autoincrement, card text not null, title text, head integer,
    next integer not null default 0, updated integer not null, starred integer not null default 0, persona text);
    create table node (story integer not null references story (id) on delete cascade, id integer not null,
    parent integer, json text not null, primary key (story, id));`)
  old.prepare("insert into story (id, card, head, next, updated) values (1, 'wuxia', 0, 1, 1)").run()
  old.prepare("insert into node (story, id, parent, json) values (1, 0, null, ?)").run(
    JSON.stringify({
      id: 0,
      parent: null,
      input: { text: "hi" },
      read: [],
      beats: [],
      answers: {},
      end: "end",
      brief: { must: [], may: [] },
      reply: [{ type: "text", text: "prose" }],
      fired: [],
      violated: [],
      products: {
        notes: "N",
        scene: { place: "亭", present: [] },
        people: [{ name: "李鹤", note: "故人" }],
      },
    }),
  )
  old.close()
  const opened = open(file)
  const snap = opened.store<Record<string, unknown> & L.Noded>(1).read()!
  const migrated = snap.nodes[0]!
  assert.equal(migrated["settlementStatus"], "committed")
  assert.equal(migrated["settlementVersion"], 0)
  assert.deepEqual(migrated["deliveries"], [])
  assert.deepEqual(migrated["opportunities"], [])
  assert.deepEqual(migrated["products"], { notes: "N" })
  assert.deepEqual(migrated["changes"], [
    { kind: "replace", product: "scene", value: { place: "亭", present: [] } },
    { kind: "insert_entity", collection: "people", entityId: "e_0_1", data: { name: "李鹤", note: "故人" } },
  ])
  opened.close()
  rmSync(dir, { recursive: true, force: true })
}

// The lock: one process per library file. A lock naming a live process (here our parent) is not ours: opening fails or isolates into
// a fresh library only with explicit isolateOnBusy; a dead owner is taken over, and on exit the lock goes.
{
  const dir = mkdtempSync(join(tmpdir(), "tavern-lock-"))
  const file = join(dir, "tavern.db")
  writeFileSync(`${file}.lock`, String(process.ppid))
  assert.throws(
    () => open(file),
    (e: Error) => e.message.includes(file) && e.message.includes(String(process.ppid)),
  )
  const other = open(file, { isolateOnBusy: true })
  assert.equal(other.file, join(dir, String(process.pid), "tavern.db"))
  assert.equal(readFileSync(`${other.file}.lock`, "utf8"), String(process.pid))
  assert.equal(readFileSync(`${file}.lock`, "utf8"), String(process.ppid)) // the owner's lock untouched
  other.close()
  writeFileSync(`${file}.lock`, String(spawnSync("true").pid)) // exited: a stale lock
  const taken = open(file)
  assert.equal(taken.file, file)
  assert.equal(readFileSync(`${file}.lock`, "utf8"), String(process.pid))
  assert.equal(open(file).file, file) // our own lock (Vite re-evaluating the module): the same library
  taken.close()
  process.on("exit", () => {
    assert.ok(!existsSync(`${file}.lock`))
    rmSync(dir, { recursive: true })
  })
}
console.log("ok")
