import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodeCard, rollOf, type Card } from "../src/card.ts"
import type { Rows } from "../src/layer.ts"
import { view } from "../src/view.ts"
import { checkCard, scaffold, templates } from "../support/author.ts"
import { runScenario } from "../support/scenario.ts"

const bin = new URL("../bin/card.ts", import.meta.url).pathname
const dir = mkdtempSync(join(tmpdir(), "author-"))
const run = (...args: string[]) => Bun.spawnSync(["bun", bin, ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" })
try {
  for (const template of templates) {
    const source = scaffold(template, template)
    assert.deepEqual(checkCard(source).diagnostics, [])
    await runScenario(decodeCard(Bun.YAML.parse(source)))
  }
  assert.equal(run("init", "chat", "--template", "chat").exitCode, 0)
  const original = readFileSync(join(dir, "chat.yaml"), "utf8")
  assert.equal(run("init", "chat").exitCode, 1)
  assert.equal(readFileSync(join(dir, "chat.yaml"), "utf8"), original)
  assert.equal(run("test", "chat.yaml").exitCode, 0)
  await runScenario(decodeCard(Bun.YAML.parse(original)), {
    steps: [
      {
        text: "continue",
        replies: { record: [{ notes: "arrived", options: ["A", "B"] }] },
        expect: { products: { notes: "arrived", options: ["A", "B"] } },
      },
    ],
  })
  for (const source of [
    "foo: [",
    "id: only",
    scaffold("bad", "chat").replace("fields: []", "fields: [{path: x, type: int, initial: wrong}]"),
  ]) {
    writeFileSync(join(dir, "bad.yml"), source)
    const result = run("check", "bad.yml", "--json")
    assert.equal(result.exitCode, 1)
    assert.equal(JSON.parse(result.stdout.toString()).diagnostics[0].rule, "schema")
  }
  assert.equal(JSON.parse(run("check", "missing.yml", "--json").stdout.toString()).diagnostics[0].rule, "io")
  const card: Card = {
    ...decodeCard(Bun.YAML.parse(scaffold("contract", "chat"))),
    director: true,
    rules: {
      fields: [{ path: "hp", type: "int", initial: 1, min: 0, max: 2 }],
      actions: [{ id: "win", text: "Win", roll: 1, hit: [{ path: "hp", add: 10 }, { event: "won" }] }],
      over: { path: "hp", is: 2 },
    },
    lore: [
      {
        id: "secret",
        layers: ["Public.", "Secret."],
        unlock: { all: [] },
        offer: { all: [{ event: "won" }, { path: "hp", is: 2 }] },
        access: { model: true, player: true },
      },
    ],
  }
  const scenario = {
    seed: 42,
    greeting: 0,
    steps: [
      {
        text: "win",
        replies: { decide: [{ next: "win", again: true }], check: [{ fired: ["secret"], violated: [] }] },
        expect: {
          state: { hp: 2 },
          events: ["won"],
          windows: ["secret#2"],
          lore: ["secret#1", "secret#2"],
          end: "over",
        },
      },
    ],
  }
  // A nontrivial roll observes the supplied seed, not a hard-coded fake outcome.
  const chanceCard: Card = {
    ...card,
    lore: [],
    rules: {
      ...card.rules,
      actions: [
        {
          id: "win",
          text: "Try",
          roll: 0.5,
          hit: [{ path: "hp", set: 2 }],
          miss: [{ path: "hp", set: 0 }],
        },
      ],
    },
  }
  for (const seed of [0, 42, 123]) {
    const rolled = await runScenario(chanceCard, {
      seed,
      steps: [{ text: "try", replies: { decide: [{ next: "win" }] } }],
    })
    assert.equal(rolled[0]!.state.hp, rollOf(seed + 1) < 0.5 ? 2 : 0)
  }
  assert.throws(
    () => view({ ...card, lore: card.lore.map((e) => ({ ...e, access: undefined })) }, {}, { pin: "secret" }),
    /not available/,
  )
  const result = await runScenario(card, scenario)
  assert.deepEqual(await runScenario(card, scenario), result)
  await assert.rejects(
    runScenario(card, { steps: [{ text: "continue", expect: { state: { hp: 9 } } }] }),
    /step 1: state.hp/,
  )
  await assert.rejects(
    runScenario(card, { steps: [{ text: "continue", replies: { decide: [{ next: "end" }, { next: "win" }] } }] }),
    /unused decide/,
  )
  const v = view(card, {}, { state: { hp: "2" }, events: ["won"], stage: "direct", pin: "secret" })
  assert.deepEqual(v.windows, ["secret→2"])
  assert.match(v.text, /Open: secret=Secret/)
  assert.match(view(card, {}).text, /lore.secret.offer.0: false/)
  assert.match(view(card, {}).text, /current hp=1/)
  assert.throws(() => view(card, {}, { pin: "missing" }), /not available/)
  // Pack and card share an id but retain independent identities, text and access.
  const collision: Card = {
    ...card,
    lore: [
      {
        id: "p/secret",
        layers: ["CARD BODY"],
        unlock: { all: [] },
        offer: { any: [] },
        activation: "always",
      },
    ],
  }
  const rows: Rows = {
    local: { id: "local", name: "Local", card: collision.id, mounts: ["p"] },
    packs: [{ id: "p", name: "P", entries: [{ id: "secret", text: "PACK BODY" }] }],
  }
  const preview = view(collision, rows, { pin: "pack:p/secret" })
  const document = JSON.stringify(preview.doc)
  assert.match(document, /\[card:p\/secret revision=.*CARD BODY/)
  assert.match(document, /\[pack:p\/secret revision=.*PACK BODY/)
  assert.throws(() => view(collision, rows, { pin: "card:p/secret" }), /not available/)
  const locked = {
    ...collision,
    lore: collision.lore.map((e) => ({ ...e, unlock: { any: [] }, access: { player: true, model: true } })),
  }
  assert.throws(() => view(locked, rows, { pin: "card:p/secret" }), /not available/)
  assert.doesNotMatch(JSON.stringify(view(locked, rows, { pin: "pack:p/secret" }).doc), /CARD BODY/)
  assert.match(JSON.stringify(view(collision, rows, { stage: "lookup", pin: "pack:p/secret" }).doc), /PACK BODY/)

  const when = { path: "hp", is: 2 }
  const gated: Card = {
    ...card,
    frame: [
      { id: "style", text: "Frame", when },
      { id: "tail", text: "Tail", at: "tail", when },
    ],
    fiction: [
      { id: "conditional", text: "Fiction", when },
      { id: "plain", text: "Plain" },
    ],
    rules: {
      ...card.rules,
      actions: [{ id: "act", text: "Act", when }],
      readouts: [{ id: "q", text: "Question", when, options: [{ id: "yes", text: "Yes", do: [] }] }],
    },
    products: [{ id: "options", on: true, when }],
  }
  const gates = view(gated, {}).sections.find((s) => s.name === "gates")!.text
  for (const path of [
    "frame.style.when",
    "tail.tail.when",
    "fiction.conditional.when",
    "actions.act.when",
    "readouts.q.when",
    "products.options.when",
    "rules.over",
  ])
    assert.ok(gates.includes(`${path}: false`), path)
  assert.doesNotMatch(gates, /fiction.plain/)

  writeFileSync(join(dir, "contract.yml"), Bun.YAML.stringify(card))
  writeFileSync(join(dir, "scenario.yaml"), Bun.YAML.stringify(scenario))
  assert.match(run("check", "wuxia").stdout.toString(), /hint:/)
  const tested = run("test", "contract.yml", "scenario.yaml")
  assert.equal(tested.exitCode, 0, tested.stderr.toString())
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log("author: ok")

// Workshop boundaries: no generated prose, existing rubric preserved, sort copies bytes.
const { applyCompile, applySort, CompileOutput, SortOutput, ReviewOutput } = await import("../support/workshop.ts")
const { Schema } = await import("effect")
const base = decodeCard(Bun.YAML.parse(scaffold("workshop", "chat")))
const wiring = {
  fields: [{ path: "bond", type: "int" as const, initial: 0, min: 0, max: 10 }],
  actions: [{ id: "close", do: [{ path: "bond", add: 1 }] }],
  readouts: [{ id: "warmth", options: [{ id: "yes", do: [{ path: "bond", add: 1 }] }] }],
  bindings: [{ to: "fiction.setting.when", when: { path: "bond", op: "gte" as const, value: 1 } }],
}
const candidate = applyCompile(base, wiring)
assert.equal(candidate.fiction[0]!.text, base.fiction[0]!.text)
assert.equal(candidate.rules.actions[0]!.text, "")
assert.equal(candidate.rules.readouts![0]!.options[0]!.text, "")
assert.ok(
  checkCard(Bun.YAML.stringify(candidate))
    .diagnostics.filter((d) => d.level === "error")
    .every((d) => d.rule === "empty-text"),
)
const authored = {
  ...candidate,
  rules: {
    ...candidate.rules,
    actions: [{ ...candidate.rules.actions[0]!, text: "Author rubric", roll: { judge: "Author odds" } }],
  },
}
assert.equal(applyCompile(authored, wiring).rules.actions[0]!.text, "Author rubric")
assert.deepEqual(applyCompile(authored, wiring).rules.actions[0]!.roll, { judge: "Author odds" })
const decodeCompile = Schema.decodeUnknownSync(CompileOutput)
assert.equal(
  applyCompile(base, decodeCompile({ ...wiring, actions: [{ ...wiring.actions[0]!, text: "injected" }] })).rules
    .actions[0]!.text,
  "",
)
assert.throws(() => decodeCompile({ ...wiring, fields: [{ ...wiring.fields[0]!, path: "two words" }] }))
assert.deepEqual(decodeCompile({ bindings: [], text: "injected" }), { bindings: [] })
assert.equal(
  applySort(
    base,
    ["Author paragraph"],
    Schema.decodeUnknownSync(SortOutput)([{ paragraphs: [0], to: "fiction.new", text: "injected" }]),
  ).fiction.at(-1)!.text,
  "Author paragraph",
)
assert.throws(() =>
  Schema.decodeUnknownSync(ReviewOutput)([{ rule: "review:consistency", level: "error", path: "$", message: "x" }]),
)
const source = ["  First paragraph.\nSame paragraph.  ", "第二段。", "Third."]
const sorted = applySort(base, source, [
  { paragraphs: [2, 0], to: "fiction.new" },
  { paragraphs: [1], to: "lore.letter.layers[0]" },
])
assert.equal(sorted.fiction.at(-1)!.text, source[0] + "\n\n" + source[2])
assert.equal(sorted.lore[0]!.layers[0], source[1])
assert.deepEqual(sorted.lore[0]!.unlock, { all: [] })
assert.deepEqual(sorted.lore[0]!.offer, { any: [] })
assert.deepEqual(base, decodeCard(Bun.YAML.parse(scaffold("workshop", "chat"))))
for (const placements of [
  [{ paragraphs: [3], to: "fiction.new" }],
  [{ paragraphs: [0, 0], to: "fiction.new" }],
  [{ paragraphs: [0], to: "fiction.setting" }],
  [{ paragraphs: [0], to: "lore.new.layers[1]" }],
  [{ paragraphs: [0], to: "greetings[0]" }],
  [{ paragraphs: [0], to: "frame.persona" }],
])
  assert.throws(() => applySort(base, source, placements))
assert.equal(
  applySort({ ...base, frame: [{ id: "voice" }] }, source, [{ paragraphs: [0], to: "frame.voice" }]).frame[0]!.text,
  source[0],
)
const emptyEverywhere = {
  ...candidate,
  frame: [{ id: "voice", text: " " }],
  fiction: [{ id: "new", text: "" }],
  asks: [{ id: "ask", text: "" }],
  greetings: [{ text: "" }],
  guard: [""],
  lore: [{ id: "l", layers: [""], unlock: { all: [] }, offer: { any: [] } }],
  products: [{ id: "custom", text: "", shape: { kind: "text" }, role: "theater" }],
  rules: { ...candidate.rules, actions: [{ id: "a", text: "", roll: { judge: "" } }] },
}
assert.equal(
  checkCard(Bun.YAML.stringify(emptyEverywhere)).diagnostics.filter((d) => d.rule === "empty-text").length,
  11,
)
// Every binding family and every newly created rubric stays on the mechanical side.
const layered = {
  ...base,
  lore: [{ id: "letter", layers: ["Hook.", "Secret."], unlock: { all: [] }, offer: { any: [] } }],
}
const linked = applyCompile(layered, {
  bindings: [
    { to: "lore.letter.unlock[1]", when: { path: "bond", is: 2 } },
    { to: "lore.letter.offer", when: { event: "letter:open" } },
    { to: "greetings[0].do", do: [{ event: "letter:open" }] },
  ],
  slots: ["fiction.unwritten", "greetings[1]", "lore.unwritten.layers[0]"],
  actions: [{ id: "judge", roll: { judged: true } }],
  products: [{ id: "custom", role: "theater", shape: { kind: "text" } }],
})
assert.deepEqual(linked.lore[0]!.layers, layered.lore[0]!.layers)
assert.deepEqual(linked.lore[0]!.unlock, [{ all: [] }, { path: "bond", is: 2 }])
assert.deepEqual(linked.lore[0]!.offer, { event: "letter:open" })
assert.deepEqual(linked.greetings[0]!.do, [{ event: "letter:open" }])
assert.equal(linked.greetings[0]!.text, base.greetings[0]!.text)
assert.equal(linked.fiction.at(-1)!.text, "")
assert.equal(linked.greetings[1]!.text, "")
assert.equal(linked.lore[1]!.layers[0], "")
assert.equal(linked.products![0]!.text, "")
assert.deepEqual(linked.rules.actions[0]!.roll, { judge: "" })
assert.throws(() =>
  decodeCompile({
    bindings: [],
    products: [{ id: "p", role: "theater", shape: { kind: "table", columns: [{ key: "two words", type: "text" }] } }],
  }),
)
assert.throws(() => applyCompile(base, { bindings: [{ to: "fiction.missing.when", when: { all: [] } }] }))
