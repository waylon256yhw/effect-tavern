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
import { fields, openings, view } from "../src/view.ts"
import { cardNames, loadCard, player } from "./cards/index.ts"

// A real turn on 盐道 from its second greeting, with 局势 set on the greeting node: every call's messages kept.
const yandao = await loadCard("yandao")
const answers: Record<string, string> = {
  lookup: '{"read":[]}',
  direct: '{"must":[],"may":[],"tone":""}',
  check: '{"fired":[],"violated":[]}',
  record: '{"notes":[],"options":[],"answers":{"tension":"same"}}',
}
const scripted = fake((o) => ({
  text: (o.responseFormat?.type === "json" && answers[o.responseFormat.name!]) || "PROSE",
}))
const model = () => scripted
const S = makeSession({ card: yandao, player, model })
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
assert.deepEqual(sent("narrate").slice(0, 8), head)
// lookup and record: the same document but for the last message (the session's note and prose; view's are empty)
assert.deepEqual(sent("lookup").slice(0, -1), at("lookup").doc.map(text).slice(0, -1))
assert.match(sent("lookup").join("\n"), /Index: yandao=盐道之争已经半年/)
const r = at("record")
assert.deepEqual(sent("record").slice(0, -1), r.doc.map(text).slice(0, -1))
for (const line of r.sections[2]!.text.split("\n")) assert.ok(sent("record").join("\n").includes(line), line)

// a card whose readouts are all gated off at this state: no Questions line in either document
const gated: Card = {
  ...yandao,
  rules: {
    ...yandao.rules,
    readouts: yandao.rules.readouts!.map((q) => ({ ...q, when: { path: "局势", op: "lt", value: 0 } as const })),
  },
}
const G = makeSession({ card: gated, player, model })
calls.clear()
await Effect.runPromise(
  Stream.runForEach(G.act(G.greet(gated.greetings[0]!).node!.id, { text: "", note: "继续" }), (e) =>
    Effect.sync(() => void (e.kind === "call" && calls.set(e.phase, e.msgs))),
  ),
)
const quiet = view(gated, player, { stage: "record" }).doc.map(text)
assert.ok(!quiet.some((t) => t.startsWith("Questions:")))
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
assert.match(missing.stderr.toString(), /nope\.yaml/)
const help = run("--help")
assert.equal(help.exitCode, 0)
assert.match(help.stdout.toString(), /SUBCOMMANDS\n {2}check .*\n {2}view /)
console.log("view: ok")
