// src/view.ts against the real thing: the documents a session sends for a turn, captured off a scripted model, hold
// exactly the head fragments, the lookup index and the record asks view prints for the same state. Then bin/card.ts
// through a process: check's exit code on the template cards and on a bad one, an unknown card, and --help.
import { fake, type Message } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Card } from "../src/card.ts"
import { makeSession } from "../src/session.ts"
import { defaultAnswer, readStage } from "../support/script.ts"
import { fields, openings, view } from "../src/view.ts"
import { cardNames, loadCard, player } from "./cards/index.ts"

// A real turn on 盐道 from its second greeting, with 局势 set on the greeting node: every call's messages kept.
const yandao = await loadCard("yandao")
const answers: Record<string, string> = {
  lookup: '{"read":[],"more":false}',
  direct: '{"must":[],"may":[],"tone":""}',
  check: '{"fired":[],"violated":[]}',
  record: '{"notes":"","options":[],"answers":{"tension":"same"}}',
}
const scripted = fake((o) =>
  readStage(o).phase === "record"
    ? defaultAnswer(readStage(o), { notes: "", options: [], answers: { tension: "same" } })
    : {
        text: (o.responseFormat?.type === "json" && answers[o.responseFormat.name!]) || "PROSE",
      },
)
const model = () => scripted
const S = makeSession({ card: yandao, rows: () => player, model })
const root = S.greet(yandao.greetings[1]!).node!.id
S.setField(root, [{ path: "局势", set: 8 }])
const calls = new Map<string, readonly Message[]>()
await Effect.runPromise(
  Stream.runForEach(S.act(root, { text: "", note: "继续" }), (e) =>
    Effect.sync(() => void (e.kind === "call" && calls.set(e.phase, e.msgs))),
  ),
)
const text = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")
const sent = (phase: string) => calls.get(phase)!.map(text)
const at = (stage: "narrate" | "lookup" | "record") =>
  view(yandao, player, { greeting: 1, state: { 局势: "8" }, stage })

// narrate: the fragments view prints as on, in order, are the first messages the narrator got
const n = at("narrate")
assert.deepEqual(n.state, { 局势: 8, 起点: "血案" })
const on = n.sections[0]!.text.split(/\n(?=\[)/).filter((f) => !/\((off|slot, empty)\)$/.test(f.split("\n")[0]!))
const head = on.map((f) =>
  f
    .split("\n")
    .slice(1)
    .map((l) => l.slice(4))
    .join("\n"),
)
assert.equal(head.length, 8) // language, pov, style; town, sides, now, tense (局势 ≥ 6), blood (起点 血案)
// after narrate.role: the frame as one message (no persona or setting here to tag), the fiction as one <fiction>
assert.deepEqual(sent("narrate").slice(1, 3), [
  head.slice(0, 3).join("\n\n"),
  `<fiction>\n${head.slice(3).join("\n\n")}\n</fiction>`,
])
// lookup and record: preview has no path ledger; the final message is the session's note/prose (empty in preview).
assert.deepEqual(
  sent("lookup")
    .filter((m) => !m.startsWith("Ledger:"))
    .slice(0, -1),
  at("lookup").doc.map(text).slice(0, -1),
)
assert.match(sent("lookup").join("\n"), /search_context/)
const r = at("record")
assert.equal(r.sections[0]!.text, "") // yandao declares only pov and style: head (record) shows worldOf, never writing lines
assert.deepEqual(sent("record").slice(0, -1), r.doc.map(text).slice(0, -1))
for (const line of r.sections.find((x) => x.name === "record")!.text.split("\n"))
  assert.ok(sent("record").join("\n").includes(line), line)

// a card whose readouts are all gated off at this state: no Questions line in either document
const gated: Card = {
  ...yandao,
  rules: {
    ...yandao.rules,
    readouts: yandao.rules.readouts!.map((q) => ({ ...q, when: { path: "局势", op: "lt", value: 0 } as const })),
  },
}
const G = makeSession({ card: gated, rows: () => player, model })
calls.clear()
await Effect.runPromise(
  Stream.runForEach(G.act(G.greet(gated.greetings[0]!).node!.id, { text: "", note: "继续" }), (e) =>
    Effect.sync(() => void (e.kind === "call" && calls.set(e.phase, e.msgs))),
  ),
)
const quiet = view(gated, player, { stage: "record" }).doc.map(text)
assert.ok(!quiet.join("\n").includes("Questions:"))
assert.deepEqual(sent("record").slice(0, -1), quiet.slice(0, -1))

// the band ↔ readout section puts the band on 局势 directly above the readout that moves it
assert.match(n.sections[3]!.text, /^tension moves 局势\n {2}band tense [^]*\n {2}readout: [^]*\n {4}worse: /)
// openings: one line per greeting with what its `do` puts in play. ri's third opening sits on the confession threshold:
// the window is open and the readout is asked on turn 1, before the player has said a word (#83, read here, not live).
assert.deepEqual(openings(await loadCard("ri"), player), [
  "greeting 0  好感度=15 恋人=false 哥哥=false  bands: band--100  windows: -  readouts: affinity",
  "greeting 1  好感度=0 恋人=false 哥哥=false  bands: band--100  windows: -  readouts: affinity",
  "greeting 2  好感度=60 恋人=false 哥哥=false  bands: band-60  windows: kokuhaku→2  readouts: affinity, confession",
])
// fields: what the client draws each shown field as; ri's 好感度 is a scale cut by its six bands, hidden switches stay out
assert.deepEqual(fields(await loadCard("ri")), ["field 好感度  scale -30..100  cuts 0 20 40 60 80 90"])
assert.deepEqual(fields(await loadCard("wuxia")), [
  "field hp  gauge 0..100",
  "field foe  value",
  "field bond  scale -30..100  cuts 0 8",
])
assert.deepEqual(fields(await loadCard("yandao")), ["field 局势  gauge 0..10  cuts 6", "field 起点  steps 平静 | 血案"])
assert.deepEqual(openings(await loadCard("banxing"), player), [
  "greeting 0  (no fields)  bands: -  windows: -  readouts: -",
])
assert.throws(() => view(yandao, player, { state: { 起点: "fight" } }))
assert.throws(() => view(yandao, player, { greeting: 5 }), /greeting 5/)

// the bin, as a process: exit codes and help
const bin = new URL("../bin/card.ts", import.meta.url).pathname
const run = (...args: string[]) => Bun.spawnSync(["bun", bin, ...args], { stdout: "pipe", stderr: "pipe" })
for (const name of cardNames) assert.equal(run("check", name).exitCode, 0, name)
assert.match(run("check", "yandao").stdout.toString(), /^greeting 1 {2}局势=7 起点=血案 {2}bands: tense, blood/m)
const bad: Card = {
  id: "bad",
  frame: [],
  fiction: [],
  greetings: [{ text: "开场。" }],
  rules: { fields: [], actions: [] },
  lore: [{ id: "x", layers: ["一层。"], unlock: { all: [] }, offer: { event: "nobody" } }],
  guard: [],
}
const file = join(mkdtempSync(join(tmpdir(), "card-")), "bad.yaml")
writeFileSync(file, Bun.YAML.stringify(bad))
const failed = run("check", file)
assert.equal(failed.exitCode, 1)
assert.match(failed.stdout.toString(), /error orphan-event lore\.x\.offer/)
const missing = run("view", "nope")
assert.equal(missing.exitCode, 1)
assert.match(missing.stderr.toString(), /nope/)

// Lore noise: an entry fully unlocked with no window is one count line, its constant gates are not explained, and a
// stage that reads no lore (record) prints neither the list nor the lore gates.
const open: Card = {
  ...yandao,
  lore: [...yandao.lore, { id: "plain", layers: ["常识。"], unlock: { all: [] }, offer: { any: [] } }],
}
const section = (v: ReturnType<typeof view>, name: string) => v.sections.find((x) => x.name === name)?.text
const narrated = view(open, player)
assert.match(
  section(narrated, "lore")!,
  /^yandao {2}layer 1\/2[^]*\n\(1 more fully unlocked, no window; --lore lists them\)$/,
)
assert.match(section(view(open, player, { lore: true }), "lore")!, /\nplain {2}layer 1\/1/)
assert.match(section(narrated, "gates")!, /lore\.yandao\./)
assert.doesNotMatch(section(narrated, "gates")!, /lore\.plain\./)
const recorded = view(open, player, { stage: "record" })
assert.equal(section(recorded, "lore"), undefined)
assert.doesNotMatch(section(recorded, "gates")!, /lore\./)
// sections: the lore row counts them with their hooks; the lookup preview lists them under the always-on face as the
// session does, the narrate preview never.
{
  const card: Card = {
    ...yandao,
    lore: [
      {
        id: "keeper",
        layers: ["The keeper of the salt road."],
        sections: [{ id: "past", text: "The keeper's years before the road. Long." }],
        activation: "always",
        unlock: { all: [] },
        offer: { any: [] },
      },
    ],
  }
  const preview = (stage: "narrate" | "lookup") => view(card, player, { stage })
  assert.match(
    preview("lookup").sections.find((s) => s.name === "lore")!.text,
    /^keeper {2}layer 1\/1 {2}1 sections.*\n {4}The keeper of the salt road\.\n {4}#past The keeper's years before the road\.$/m,
  )
  assert.match(
    preview("lookup").doc.map(text).join("\n"),
    /\nSections \(read_context\): card:keeper#past The keeper's years/,
  )
  const narrated = preview("narrate").doc.map(text).join("\n")
  assert.ok(narrated.includes("The keeper of the salt road.") && !narrated.includes("#past"))
}
// Empty-history preview uses the same world, permissions and state-expanded asks as a real turn.
{
  const card: Card = {
    ...yandao,
    products: [
      {
        id: "scene",
        role: "world",
        on: true,
        feed: true,
        text: "At {{world.scene.place}}, score {{fields.局势}}",
        shape: { kind: "record", keys: [{ key: "place", type: "text" }] },
        initial: { place: "inn" },
      },
    ],
    lore: [
      {
        id: "manual",
        layers: ["PLAYER ONLY"],
        access: { model: false, player: true },
        unlock: { all: [] },
        offer: { any: [] },
      },
      { id: "quiet", layers: ["SEARCHABLE"], unlock: { all: [] }, offer: { any: [] } },
      { id: "auto", layers: ["AUTOMATIC"], activation: "always", unlock: { all: [] }, offer: { any: [] } },
      { id: "missing", layers: ["{{unknown_name}}"], unlock: { all: [] }, offer: { any: [] } },
    ],
  }
  const preview = (stage: "narrate" | "lookup" | "record", pin?: string) =>
    view(card, player, { stage, pin, lore: true })
  const listed = section(preview("lookup"), "lore")!
  assert.match(listed, /quiet  layer 1\/1  in the index/)
  assert.doesNotMatch(listed, /manual[^\n]*in the index|auto[^\n]*in the index|missing/)
  assert.doesNotMatch(preview("narrate").doc.map(text).join("\n"), /PLAYER ONLY/)
  assert.match(preview("record", "manual").doc.map(text).join("\n"), /PLAYER ONLY/)
  // the entry with the open hole is the preview's to drop; a session on it would refuse the turn (session.ts `ready`)
  const runtime = makeSession({
    card: { ...card, lore: card.lore.filter((e) => e.id !== "missing") },
    rows: () => player,
    model,
  })
  calls.clear()
  await Effect.runPromise(
    Stream.runForEach(
      runtime.act(runtime.greet(card.greetings[0]!).node!.id, { text: "", note: "继续", invoke: ["card:manual"] }),
      (e) => Effect.sync(() => void (e.kind === "call" && calls.set(e.phase, e.msgs))),
    ),
  )
  for (const stage of ["lookup", "record"] as const) {
    const actual = sent(stage)
      .filter((m) => !m.startsWith("Ledger:"))
      .slice(0, -1)
    assert.deepEqual(actual, preview(stage, "manual").doc.map(text).slice(0, -1))
  }
  for (const stage of ["lookup", "narrate", "record"] as const) {
    const current = preview(stage)
      .doc.map(text)
      .join("\n")
      .split("\n")
      .find((x) => x.startsWith("Current:"))!
    assert.match(current, /scene=.*inn/)
    assert.ok(sent(stage).join("\n").includes(current))
  }
  assert.match(preview("record").doc.map(text).join("\n"), /scene: At inn, score 2/)
}
const help = run("--help")
assert.equal(help.exitCode, 0)
assert.match(help.stdout.toString(), /SUBCOMMANDS\n {2}init .*\n {2}check .*\n {2}view /)
console.log("view: ok")
