// The loop (test/harness.ts) on a scripted model: every stage's request shape and the node's contents are asserted.
// The script answers by phase name and by what the request says; reveals, kills and cuts are queued per turn.
import { fake, fakeText } from "@effect-tavern/provider"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { deliveredOn, prose } from "../src/journal.ts"
import { chat, full, player } from "./cards/wuxia.ts"
import {
  L,
  calls,
  chain,
  demand,
  edit,
  eventsOf,
  greet,
  history,
  initial,
  journal,
  msgText,
  pick,
  pin,
  productsOf,
  prompts,
  reword,
  run,
  setField,
  stateAt,
  str,
  summaries,
  useCard,
  useModel,
} from "./harness.ts"

// ───────── Scripted model ─────────
const narrations: Array<"plain" | "fire" | "kill" | "cut"> = []
const warmths: string[] = [] // scripted readout answers; default "flat"
let n = 0
function script(o: Parameters<Parameters<typeof fake>[0]>[0]): { text: string; cut?: boolean } {
  const text = o.prompt.map(fakeText).join("\n")
  const phase = o.responseFormat?.type === "json" ? (o.responseFormat.name ?? "narrate") : "narrate"
  const last = o.prompt.at(-1)!
  const want = fakeText(last)
  const open =
    text
      .match(/Open: ([\w,=]*)/)?.[1]
      .split(/[,|]/)
      .map((x) => x.split("=")[0].trim())
      .filter(Boolean) ?? []
  let out: string
  let reason: "stop" | "length" = "stop"
  switch (phase) {
    case "lookup":
      // Index entries are `id` (lore) or `id=hook` (a recall product's item); the script reads "about <hook>".
      out = JSON.stringify({
        read: text
          .match(/Index: (.*)/)![1]
          .split(", ")
          .map((e) => e.split("="))
          .filter(([id, hook]) => want.toLowerCase().includes(`about ${(hook ?? id)!.toLowerCase()}`))
          .map(([id]) => id),
      })
      break
    case "decide": {
      const k = (text.match(/So far: (.*)/)![1].match(/strike/g) ?? []).length
      out = JSON.stringify({ next: /strike/.test(want) && k < 2 ? "strike" : "end", again: true }) // the script's "strike B" means twice
      break
    }
    case "direct":
      out = JSON.stringify({ must: [], may: open, tone: `TONE#${n}` })
      break
    case "check": {
      out = JSON.stringify({
        fired: /tattoo/.test(want) ? open : [],
        violated: /KILL/.test(want) ? ["B does not die"] : [],
      })
      break
    }
    case "record": {
      // Questions arrive as "<id>: <text> [<opt>: <text> | ...]" lines; answer each from the script, else "flat".
      const qs = [...text.matchAll(/^(?:Questions: )?(\w+): [^[\n]*\[([^\]]*)\]$/gm)]
      const answers = Object.fromEntries(
        qs.map(([, id, opts]) => {
          const ids = opts.split(" | ").map((o) => o.split(":")[0].trim())
          const want = warmths.shift() ?? "flat"
          return [id, ids.includes(want) ? want : ids[0]]
        }),
      )
      // Products arrive as "<id>: <question>" lines after Known / Current; the script knows the wuxia card's shapes.
      const asked = [...text.matchAll(/^(\w+): (?!.*\[)/gm)]
        .map(([, id]) => id!)
        .filter((id) => !["Known", "Current", "Questions"].includes(id))
      // Notes repeat the first Known item on purpose: the harness drops what the path already holds.
      const canned: Record<string, unknown> = {
        notes: [
          `NOTE#${n}`,
          ...(text
            .match(/^Known: (.*)/m)?.[1]
            ?.split("; ")
            .slice(0, 1)
            .filter(Boolean) ?? []),
        ],
        options: ["O1", "O2", "O3", "O4", "O5"], // five: the cap cuts to four
        scene: { place: `P#${n}`, present: [{ name: "B", mood: "calm" }] },
        people: /^ask about li/i.test(want) ? [{ name: "Li", note: `N#${n}` }] : [],
        inner: `INNER#${n}`,
      }
      const products = Object.fromEntries(asked.map((id) => [id, canned[id]]))
      out = JSON.stringify(qs.length ? { ...products, answers } : products)
      break
    }
    default: {
      if (last.role === "assistant") {
        out = " …and the rest."
        break
      } // resumed after a cut
      const how = narrations.shift() ?? "plain"
      const mayReveal = /MAY reveal|MUST reveal/.test(text)
      out = `PROSE#${++n}${how === "fire" && mayReveal ? " the sleeve tears, a crane tattoo" : ""}${how === "kill" ? " KILL" : ""}`
      if (how === "cut") {
        out += " partial"
        reason = "length"
      }
    }
  }
  return { text: out, cut: reason === "length" }
}

useCard(full)
useModel({ ...fake((o) => script(o)), prefill: true })
const since = (i: number) => calls.slice(i)
const lastNarr = () => prompts.narrate.at(-1)!

const program = Effect.gen(function* () {
  const c0 = yield* run(chat, player, null, { text: "hello" })
  assert.deepEqual(calls, ["narrate", "record"])
  assert.deepEqual([c0.read, c0.beats, c0.brief, c0.fired], [[], [], { must: [], may: [] }, []])
  assert.deepEqual(c0.answers, {}) // no readouts declared: record only takes the products
  assert.ok(!/Questions/.test(str(prompts.record[0])))
  // Products: the default `inner` stays off; `options` (switched on by the card) is capped by code to four; the feed
  // record `scene` is stored whole; `people` is an empty table this turn.
  assert.deepEqual(Object.keys(c0.products).sort(), ["notes", "options", "people", "scene"])
  assert.deepEqual(c0.products.options, ["O1", "O2", "O3", "O4"])
  assert.deepEqual(c0.products.scene, { place: "P#1", present: [{ name: "B", mood: "calm" }] })
  assert.ok(
    /^notes: Notes are the record/m.test(str(prompts.record[0])) &&
      /^scene: Where the scene/m.test(str(prompts.record[0])),
  )

  let i = calls.length
  const t1 = yield* run(full, player, null, { text: "ask about li" })
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record"])
  assert.deepEqual(t1.read, [{ id: "li", layer: 1 }])
  assert.ok(str(lastNarr()).includes(L.entries[0].layers[0]) && !str(lastNarr()).includes("B is Li"))
  // Readout: asked at record, answered by enum, no number anywhere the prose stages can see.
  assert.deepEqual(t1.answers, { warmth: "flat" })
  const rec1 = str(prompts.record.at(-1)!)
  assert.ok(/Questions: warmth: how A treated/.test(rec1) && !/bond|State:/.test(rec1))
  assert.ok(str(lastNarr()).includes("arm's length") && !/bond/.test(str(lastNarr())))
  assert.deepEqual(t1.products.people, [{ name: "Li", note: "N#2" }]) // a recall row: readable by later lookups
  assert.deepEqual(t1.products.notes, ["NOTE#2"]) // the echoed Known item is dropped; only the new fact is kept

  // Turn 2: lookup lists only t1's people row (li#1 already on the path) and the input reads nothing; strikes settle,
  // window opens, director, reveal fired. The narrator gets the feed record as `Current:` after the outcome.
  i = calls.length
  narrations.push("fire")
  warmths.push("warm")
  const t2 = yield* run(full, player, t1.id, { text: "strike B", aside: "ASIDE#2" })
  assert.deepEqual([t2.answers, stateAt(chain(t2.id)).bond], [{ warmth: "warm" }, 4])
  assert.deepEqual(since(i), ["lookup", "decide", "decide", "decide", "direct", "narrate", "check", "record"])
  assert.equal(str(prompts.lookup.at(-1)!).split("\n")[0], `Index: people@${t1.id}#0=Li`)
  assert.deepEqual(t2.read, [])
  assert.ok(/^Current: scene=place: P#2; present: name=B, mood=calm$/m.test(str(lastNarr())))
  assert.ok(/^Current: scene=/m.test(str(prompts.record.at(-1)!)) && !/^Current/m.test(str(prompts.direct.at(-1)!)))
  assert.equal(t2.beats.length, 2)
  const ev2 = eventsOf(chain(t2.id), t2)
  assert.ok(ev2.includes("strike:hit"))
  assert.deepEqual([t2.brief.may, t2.fired], [["li"], [{ id: "li", layer: 2 }]])
  assert.ok(
    /MAY reveal: B is Li/.test(str(lastNarr())) &&
      str(lastNarr()).includes("ASIDE#2") &&
      str(lastNarr()).includes(`Tone: TONE#`),
  )
  // The window reads post-settlement events: the same input with all-miss seeds opens nothing.
  assert.deepEqual(L.offers(initial, deliveredOn(chain(t1.id)), ["strike:miss", "strike:miss"]), [])
  // The k-th decide saw the first k events.
  const decides = prompts.decide.slice(-3).map(str)
  assert.ok(
    /So far: -/.test(decides[0]) &&
      /So far: strike:\w+$/m.test(decides[1]) &&
      /So far: strike:\w+,strike:\w+$/m.test(decides[2]),
  )
  // Director never saw prose; narrator never saw the ledger.
  assert.ok(!/PROSE#/.test(str(prompts.direct.at(-1)!)) && !/Ledger/.test(str(lastNarr())))

  // Turn 3: history carries both lore layers; the previous aside and tone are gone; head is byte-identical. The input
  // asks about Li: lookup delivers t1's people row like a lore layer, and it lands in the tail as text.
  i = calls.length
  warmths.push("warm")
  const t3 = yield* run(full, player, t2.id, { text: "speak about Li" })
  const v3 = str(lastNarr())
  assert.deepEqual(t3.read, [{ id: `people@${t1.id}#0`, layer: 1 }])
  assert.ok(v3.includes("name=Li, note=N#2"))
  assert.ok(v3.includes("B is Li") && v3.includes(L.entries[0].layers[0]) && v3.includes(prose(t2)))
  assert.ok(!v3.includes("ASIDE#2") && !v3.includes(t2.brief.tone!))
  assert.ok(v3.includes("arm's length")) // bond was 4 when this head was built; the answer lands after the prose
  assert.equal(stateAt(chain(t3.id)).bond, 8)
  assert.deepEqual(prompts.narrate.at(-1)!.slice(0, 3), prompts.narrate.at(-2)!.slice(0, 3))
  assert.deepEqual(prompts.narrate.at(-1)!.slice(0, 3).map(msgText), [
    "Write in Chinese.",
    "Frame: wuxia",
    "A: swordsman",
  ]) // player zone → frame → fiction
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record"])
  assert.deepEqual(t3.brief, { must: [], may: [] }) // no beat event this turn, t2's readout emitted none: no window
  // Cache breakpoints: the head's last message and the last history message (t2's reply, what next turn resends
  // verbatim) carry markers; this turn's input and tail do not.
  const marks = prompts.narrate
    .at(-1)!
    .map((m) => (m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl !== undefined)
  const at = (i: number) => msgText(prompts.narrate.at(-1)![i]!)
  assert.deepEqual(
    [marks.at(-1), marks.filter(Boolean).length, at(marks.indexOf(true)), at(marks.lastIndexOf(true))],
    [false, 2, "A keeps the player at arm's length.", prose(t2)],
  )

  // Truncation: one node, prose concatenated, two narrate calls, second prompt ends with the partial as assistant.
  i = calls.length
  narrations.push("cut")
  const t4 = yield* run(chat, player, c0.id, { text: "more" })
  assert.deepEqual(since(i), ["narrate", "narrate", "record"])
  assert.ok(prose(t4).endsWith("partial …and the rest."))
  const resumed = prompts.narrate.at(-1)!.at(-1)!
  assert.equal(resumed.role, "assistant")
  assert.equal(journal.size, 5)

  // Guardrail: a draft that kills B is re-asked once with the broken rule in the tail; the correction never enters history.
  i = calls.length
  narrations.push("kill", "plain")
  warmths.push("close")
  const t5 = yield* run(full, player, t3.id, { text: "finish him" })
  assert.deepEqual(since(i), ["decide", "narrate", "check", "narrate", "check", "record"])
  assert.ok(str(prompts.narrate.at(-1)!).includes('Previous draft broke: rule "B does not die"'))
  assert.deepEqual(t5.violated, [])
  // The band switched: bond reached 8 at t3's record, so t5's head reads the warm fragment and not the cool one.
  const v5 = str(lastNarr())
  assert.ok(v5.includes("A trusts the player.") && !v5.includes("arm's length"))
  assert.deepEqual(prompts.narrate.at(-1)!.slice(0, 3), prompts.narrate.at(-3)!.slice(0, 3)) // prefix intact
  i = calls.length
  const t6 = yield* run(full, player, t5.id, { text: "rest" })
  assert.ok(!str(lastNarr()).includes("Previous draft broke"))
  // A readout option can emit an event. It shows in the ledger the structured stages read next turn, and it opens a
  // window on that next turn: t5's "close" is carried into t6's gate, li's third layer is offered, the director runs.
  assert.ok(eventsOf(chain(t5.id), t5).includes("warmth:close") && /warmth:close/.test(str(prompts.decide.at(-1)!)))
  assert.deepEqual(since(i), ["decide", "direct", "narrate", "check", "record"])
  assert.deepEqual(t6.brief.may, ["li"])
  assert.ok(str(lastNarr()).includes(`MAY reveal: ${L.entries[0].layers[2]}`))
  assert.equal(stateAt(chain(t6.id)).bond, 16)

  // Compression in the loop: at 4 turns on the path, the first block (t1, t2) is folded.
  const v6 = str(lastNarr())
  assert.ok(
    v6.includes("Summary:") &&
      !v6.includes(prose(t1)) &&
      !v6.includes(prose(t2)) &&
      v6.includes(prose(t3)) &&
      v6.includes(prose(t5)),
  )
  assert.ok(v6.includes("B is Li") && v6.includes(L.entries[0].layers[0])) // lore delivered inside the folded range survives in the fold
  const s6 = summaries.summaryFor(chain(t6.id))!
  assert.deepEqual([s6.from, s6.to], [t1.id, t2.id])
  // Boundary moves in blocks: one more turn keeps the same summary object; lore dedupe still sees the folded deliveries.
  i = calls.length
  const t7 = yield* run(full, player, t6.id, { text: "wait" })
  assert.deepEqual(since(i), ["decide", "narrate", "check", "record"]) // li fully delivered on the folded nodes → nothing to look up
  assert.equal(summaries.summaryFor(chain(t7.id)), s6)
  assert.equal(summaries.size, 1)
  const t8 = yield* run(full, player, t7.id, { text: "wait more" })
  const s8 = summaries.summaryFor(chain(t8.id))!
  assert.deepEqual([s8.from, s8.to, summaries.size], [t1.id, t5.id, 2])
  assert.ok(s8.text.includes("name=Li, note=N#2")) // a recalled product row delivered inside the folded range survives like lore
  assert.ok(!str(lastNarr()).includes(prose(t3)) && str(lastNarr()).includes(prose(t6)))
  // The view is a function of (path, policy), not of what other branches have cached: re-rendering the shorter path
  // at t6 still folds only the first block, even though a longer summary now sits in the table.
  const again = history(chain(t6.id), "narrate")
    .map((m) => m.content as string)
    .join("\n")
  assert.ok(again.includes(prose(t3)) && again.includes(s6.text) && !again.includes(s8.text))

  // reword: narrate, check, record only; read/beats/brief kept; sibling under the same parent. Replay calls nothing.
  // The card overrides one of the harness's own asks by id; the rest keep their defaults.
  i = calls.length
  const w = yield* reword({ ...full, asks: [{ id: "product.notes", text: "ASK#notes" }] }, player, t2)
  assert.deepEqual(since(i), ["narrate", "check", "record"])
  assert.ok(/^notes: ASK#notes$/m.test(str(prompts.record.at(-1)!)))
  assert.ok(/Notes are the record/.test(str(prompts.record.at(-2)!)))
  assert.deepEqual([w.parent, w.read, w.beats, w.brief], [t2.parent, t2.read, t2.beats, t2.brief])

  // A greeting with an opening: its effects fold into the state before the first turn (the head reads the warm band,
  // not the initial cool one), and its events are carried into that turn's gate like a readout's: li's second layer is
  // offered on turn 1 of this branch without a single beat.
  const g = greet({ text: "G", do: [{ path: "bond", set: 8 }, { event: "warmth:close" }] })
  assert.equal(stateAt(chain(g.id)).bond, 8)
  i = calls.length
  const t9 = yield* run(full, player, g.id, { text: "wait" })
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record"])
  assert.deepEqual([t9.beats, t9.brief.may], [[], ["li"]])
  assert.ok(str(lastNarr()).includes("A trusts the player.") && str(lastNarr()).includes("G"))
  i = calls.length
  for (const t of journal.values()) stateAt(chain(t.id))
  assert.equal(calls.length, i)

  // A player action on a node: demand a product that is off (inner) over t3's scene. One record call, no new node, the
  // answer kept on t3 beside the turn's own products; the player's toggle alone could have switched it on for every turn.
  const size = journal.size
  const d = yield* demand(full, player, t3.id, "inner")
  assert.deepEqual(since(i), ["record"])
  assert.ok(/^INNER#\d+$/.test(d.products.inner as string) && d.products.notes !== undefined)
  assert.equal(journal.size, size)
  assert.equal(chain(t5.id)[2]!.products.inner, d.products.inner) // the amended node is what the path sees
  assert.deepEqual(
    Object.keys(productsOf({ ...player, products: { inner: true } }, full).filter((p) => p.on)).length,
    5,
  )

  // ───────── Player actions on a node (docs/card-reading-2.md §8 item 8) ─────────
  // edit: the player's prose stands as the reply of a sibling of t2; check and record run over it, narrate never does.
  // The edited text mentions the tattoo, so the reveal that was open at t2 fires from the player's own words.
  i = calls.length
  const e = yield* edit(full, player, t2, "EDITED: the sleeve tears, a crane tattoo")
  assert.deepEqual(since(i), ["check", "record"])
  assert.deepEqual(
    [e.parent, e.read, e.beats, e.brief, prose(e)],
    [t2.parent, t2.read, t2.beats, t2.brief, "EDITED: the sleeve tears, a crane tattoo"],
  )
  assert.deepEqual(e.fired, [{ id: "li", layer: 2 }])
  assert.ok(str(prompts.check.at(-1)!).includes("EDITED"))

  // setField: an effect kept on t3 and folded last; every descendant's state moves with it (t6 was 16: t5's +8 on 20), no call made.
  // A value outside the field is refused and the node is untouched.
  i = calls.length
  assert.throws(() => setField(t3.id, [{ path: "bond", set: 999 }]), /bond/)
  assert.equal(journal.get(t3.id).adjust, undefined)
  setField(t3.id, [{ path: "bond", set: 20 }])
  assert.deepEqual([stateAt(chain(t3.id)).bond, stateAt(chain(t6.id)).bond, calls.length], [20, 28, i])

  // pin: on t9's branch li's first layer is visible but was never read; pinning delivers it on t9 without a call. The
  // next turn has nothing left to look up, and the narrator reads the pinned text in history. Pinning it again is an error.
  const p9 = pin(t9.id, "li")
  assert.deepEqual([p9.pinned, calls.length], [[{ id: "li", layer: 1 }], i])
  assert.throws(() => pin(t9.id, "li"), /nothing to pin/)
  const t10 = yield* run(full, player, t9.id, { text: "wait" })
  assert.deepEqual(since(i), ["decide", "narrate", "check", "record"]) // no lookup: nothing readable remains
  assert.ok(str(lastNarr()).includes(L.entries[0].layers[0]) && t10.read.length === 0)

  // pick: an option recorded on c0 becomes the player's next act, a child of c0 with that text as the input.
  const t11 = yield* pick(chat, player, c0.id, 1)
  assert.deepEqual([t11.parent, t11.input], [c0.id, { text: "O2" }])
  assert.throws(() => pick(chat, player, c0.id, 9), /no option/)

  // ───────── Derived lore counters in the window (§8 item 4) ─────────
  // A recurring entry: offered when it has not reached the narrator for two turns and has been shown fewer than twice.
  // Never shown counts as Infinity, so it opens on the first turn; shown there, it waits one turn, then opens again.
  const echo = {
    id: "echo",
    layers: ["E1", "E2", "E3"],
    unlock: { all: [] },
    offer: {
      all: [
        { path: "lore.echo.since", op: "gte", value: 2 },
        { path: "lore.echo.shown", op: "lt", value: 2 },
      ],
    },
  } as const
  useCard({ ...full, lore: [...full.lore, echo] })
  narrations.push("fire", "plain", "fire")
  const a = yield* run(full, player, null, { text: "wait" })
  assert.deepEqual([a.brief.may, a.fired], [["echo"], [{ id: "echo", layer: 2 }]])
  const b = yield* run(full, player, a.id, { text: "wait" })
  assert.deepEqual(b.brief.may, []) // since = 1
  const c = yield* run(full, player, b.id, { text: "wait" })
  assert.deepEqual([c.brief.may, c.fired], [["echo"], [{ id: "echo", layer: 3 }]]) // since = 2, shown = 1
  console.log(str(lastNarr()))
})

await Effect.runPromise(program)
console.log("ok")
