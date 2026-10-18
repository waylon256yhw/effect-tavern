// Tests for src/lore.ts: layered, state-gated knowledge (§14). Entries' text is data (editor contract), gates are code.
// Replaces the ad-hoc `lore` in turn.ts and `threads` in brief.ts. Windows here read the player's input.
import { Schema } from "effect"
import assert from "node:assert/strict"
import { makeLore, type Disclosure, type Entry } from "../src/lore.ts"

interface State {
  chapter: number
}
const EntryData = Schema.Struct({ id: Schema.String, layers: Schema.NonEmptyArray(Schema.String) })
const data = Schema.decodeUnknownSync(Schema.Array(EntryData))([
  {
    id: "li",
    layers: ["Li is A's friend who vanished ten years ago. A crane tattoo marks his left shoulder.", "B is Li."],
  },
  {
    id: "heir",
    layers: ["Rumour says the old emperor had a son.", "The heir was hidden in the north.", "Li is the heir."],
  },
  { id: "sect", layers: ["The Black Lotus sect runs the city's guilds."] },
])
const gates: Record<string, Pick<Entry<State, string>, "unlock" | "offer">> = {
  li: { unlock: () => 1, offer: (_, input) => /sword/.test(input) },
  heir: { unlock: (s) => (s.chapter >= 2 ? 1 : 0), offer: (_, input) => /throne/.test(input) },
  sect: {}, // never unlocked, never offered
}
const L = makeLore<State, string>(data.map((d) => ({ ...d, ...gates[d.id] })))
const { index, read, offers, current, text } = L
const byId = new Map(L.entries.map((e) => [e.id, e]))

// ───────── Path: what each turn delivered into context and what it revealed ─────────
interface Node {
  id: number
  parent: number | null
  s: State
  delivered: readonly Disclosure[]
}
const tree = new Map<number, Node>()
const add = (parent: number | null, s: State, delivered: Disclosure[] = [], revealed: Disclosure[] = []) => {
  const n: Node = { id: tree.size, parent, s, delivered: [...delivered, ...revealed] } // a reveal is in the prose, so it's delivered
  tree.set(n.id, n)
  return n.id
}
const path = (id: number): Node[] => {
  const out: Node[] = []
  for (let n = tree.get(id); n; n = n.parent === null ? undefined : tree.get(n.parent)) out.unshift(n)
  return out
}
const D = (p: readonly Node[]) => p.flatMap((n) => n.delivered)

// ───────── Checks ─────────
const ch1 = { chapter: 1 }
const root = add(null, ch1)

// 1. Hidden entry: not indexed, not readable, never offered.
assert.deepEqual(
  index(ch1, D(path(root))).map((x) => x.id),
  ["li"],
)
assert.equal(read(ch1, D(path(root)), "sect"), undefined)
assert.equal(read(ch1, D(path(root)), "heir"), undefined) // chapter 1: heir still at layer 0
assert.ok(offers(ch1, D(path(root)), "sword throne").every((o) => o.id !== "sect" && o.id !== "heir"))

// 2. Pull then push on one entry: read layer 1, then the duel offers layer 2, the narrator reveals it.
assert.deepEqual(index(ch1, D(path(root)))[0].hook, "Li is A's friend who vanished ten years ago.")
const r1 = read(ch1, D(path(root)), "li")!
assert.deepEqual(r1, [{ id: "li", layer: 1 }])
const t1 = add(root, ch1, r1) // lookup result appended to the log once
assert.deepEqual(read(ch1, D(path(t1)), "li"), [], "already in context: nothing to resend")
assert.deepEqual(L.readable(ch1, D(path(t1))), [], "nothing new to read → the lookup stage has no call to make")
assert.deepEqual(offers(ch1, D(path(t1)), "I draw my sword"), [{ id: "li", layer: 2, text: "B is Li." }])
const t2 = add(t1, ch1, [], [{ id: "li", layer: 2 }])
assert.equal(current(byId.get("li")!, ch1, D(path(t2))), 2)
assert.deepEqual(read(ch1, D(path(t2)), "li"), [])

// 3. A fork that skipped the lookup but got the reveal reads only what it lacks; a fork before the reveal never sees layer 2.
const f = add(root, ch1, [], [{ id: "li", layer: 2 }])
assert.deepEqual(read(ch1, D(path(f)), "li")!.map(text), [
  "Li is A's friend who vanished ten years ago. A crane tattoo marks his left shoulder.",
])
const g = add(t1, ch1)
assert.equal(current(byId.get("li")!, ch1, D(path(g))), 1)
assert.ok(offers(ch1, D(path(g)), "We talk by the fire").length === 0, "no window without the trigger")

// 4. Code floor + path: chapter 2 unlocks heir layer 1; offers go one layer at a time; knowledge stays if access drops.
const ch2 = { chapter: 2 }
const t3 = add(t2, ch2)
assert.deepEqual(read(ch2, D(path(t3)), "heir"), [{ id: "heir", layer: 1 }])
const o = offers(ch2, D(path(t3)), "Who sits on the throne?")
assert.deepEqual(o, [{ id: "heir", layer: 2, text: "The heir was hidden in the north." }])
assert.ok(!JSON.stringify(o).includes("Li is the heir."), "never more than the next layer")
const t4 = add(t3, ch2, [{ id: "heir", layer: 1 }], [{ id: "heir", layer: 2 }])
const ch1Again = { chapter: 1 } // e.g. a flashback chapter: the floor drops to 0
assert.equal(current(byId.get("heir")!, ch1Again, D(path(t4))), 2, "delivered knowledge persists")
assert.equal(current(byId.get("heir")!, ch1Again, D(path(t2))), 0, "a path that never learned it has no access")

// 5. Fully revealed entries are no longer offered.
assert.ok(offers(ch2, D(path(t4)), "I draw my sword").every((x) => x.id !== "li"))

// Monotonic along every path.
for (const n of tree.values()) {
  const p = path(n.id)
  for (const e of L.entries) {
    const layers = p.map((n, i) => current(e, n.s, D(p.slice(0, i + 1))))
    assert.deepEqual(
      layers,
      [...layers].sort((a, b) => a - b),
      `${e.id} on #${n.id}`,
    )
  }
}

// Derived counters for `offer`: turns since last shown (this turn = 0, never = Infinity) and how many turns shown.
assert.deepEqual(
  L.counters([
    [{ id: "li", layer: 1 }],
    [],
    [
      { id: "li", layer: 2 },
      { id: "heir", layer: 1 },
    ],
    [],
  ]),
  { li: { since: 1, shown: 2 }, heir: { since: 1, shown: 1 }, sect: { since: Infinity, shown: 0 } },
)
assert.deepEqual(L.counters([[{ id: "li", layer: 1 }]]).li, { since: 0, shown: 1 })

for (const n of tree.values()) {
  const p = path(n.id)
  console.log(
    `#${n.id}<${n.parent ?? "-"} ch${n.s.chapter} ${L.entries.map((e) => `${e.id}=${current(e, n.s, D(p))}`).join(" ")}  index=[${index(
      n.s,
      D(p),
    )
      .map((x) => x.id)
      .join(",")}]`,
  )
}
console.log("ok")
