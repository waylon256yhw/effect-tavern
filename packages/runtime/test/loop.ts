// The session (src/session.ts) on a scripted model, through its interface only: actions in, events out, nodes read
// back. Every stage's request shape (from `call` events) and the node's contents are asserted. The script answers by
// phase name and by what the request says; reveals, kills and cuts are queued per turn.
import { fake, fakeText, type Message } from "@effect-tavern/provider"
import { Cause, Deferred, Effect, Stream } from "effect"
import assert from "node:assert/strict"
import { prose } from "../src/journal.ts"
import { makeSession, outcome, type Event } from "../src/session.ts"
import { chat, full, player } from "./cards/wuxia.ts"

// ───────── Scripted model ─────────
const narrations: Array<"plain" | "fire" | "kill" | "cut" | "long"> = []
const warmths: string[] = [] // scripted readout answers; default "flat"
let n = 0
function script(o: Parameters<Parameters<typeof fake>[0]>[0]): { text: string; cut?: boolean; delay?: number } {
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
  let delay: number | undefined
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
      // Notes repeat the first Known item on purpose: the session drops what the path already holds.
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
      if (how === "long") {
        out += " the road winds on through the bamboo".repeat(4)
        delay = 1
      }
    }
  }
  return { text: out, cut: reason === "length", delay } // delay: a stop needs the stream to still be running
}

// ───────── Through the interface: every event kept, the node read off the end ─────────
const model = { ...fake((o) => script(o)), prefill: true }
const S = makeSession({ card: full, player, model }) // the self-check RPG card
const C = makeSession({ card: chat, player, model }) // its stripped copy: no actions, no lore, no guard
const events: Event[] = []
const made = () => events.filter((e) => e.kind === "call")
const calls = () => made().map((e) => e.phase)
const prompts = (phase: string) =>
  made()
    .filter((e) => e.phase === phase)
    .map((e) => e.msgs)
const lastNarr = () => prompts("narrate").at(-1)!
const since = (i: number) => calls().slice(i)
const msgText = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("")
const str = (p: readonly Message[]) => p.map(msgText).join("\n")
const go = (s: Stream.Stream<Event, unknown>) =>
  outcome(s.pipe(Stream.tap((e) => Effect.sync(() => void events.push(e)))))

const program = Effect.gen(function* () {
  const c0 = yield* go(C.act(null, { text: "hello" }))
  assert.deepEqual(calls(), ["narrate", "record"])
  assert.deepEqual([c0.read, c0.beats, c0.brief, c0.fired], [[], [], { must: [], may: [] }, []])
  assert.deepEqual(c0.answers, {}) // no readouts declared: record only takes the products
  assert.ok(!/Questions/.test(str(prompts("record")[0]!)))
  // The event stream: a stage announced before each call, the prose streamed by part, the node last.
  assert.deepEqual(
    events.map((e) => e.kind),
    ["stage", ...Array(Math.ceil(prose(c0).length / 8)).fill("delta"), "call", "stage", "call", "node"],
  )
  assert.equal(
    events
      .filter((e) => e.kind === "delta")
      .map((e) => (e.part.type === "text-delta" ? e.part.text : ""))
      .join(""),
    prose(c0),
  )
  assert.deepEqual(events.at(-1), { kind: "node", node: C.node(c0.id) })
  // Products: the default `inner` stays off; `options` (switched on by the card) is capped by code to four; the feed
  // record `scene` is stored whole; `people` is an empty table this turn.
  assert.deepEqual(Object.keys(c0.products).sort(), ["notes", "options", "people", "scene"])
  assert.deepEqual(c0.products.options, ["O1", "O2", "O3", "O4"])
  assert.deepEqual(c0.products.scene, { place: "P#1", present: [{ name: "B", mood: "calm" }] })
  assert.ok(
    /^notes: Notes are the record/m.test(str(prompts("record")[0]!)) &&
      /^scene: Where the scene/m.test(str(prompts("record")[0]!)),
  )

  let i = calls().length
  const t1 = yield* go(S.act(null, { text: "ask about li" }))
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record"])
  assert.deepEqual(t1.read, [{ id: "li", layer: 1 }])
  assert.deepEqual(S.node(t1.id).delivered, [{ id: "li", layer: 1, text: full.lore[0]!.layers[0] }])
  assert.ok(str(lastNarr()).includes(full.lore[0]!.layers[0]!) && !str(lastNarr()).includes("B is Li"))
  // Readout: asked at record, answered by enum, no number anywhere the prose stages can see.
  assert.deepEqual(t1.answers, { warmth: "flat" })
  const rec1 = str(prompts("record").at(-1)!)
  assert.ok(/Questions: warmth: how A treated/.test(rec1) && !/bond|State:/.test(rec1))
  assert.ok(str(lastNarr()).includes("arm's length") && !/bond/.test(str(lastNarr())))
  assert.deepEqual(t1.products.people, [{ name: "Li", note: "N#2" }]) // a recall row: readable by later lookups
  assert.deepEqual(t1.products.notes, ["NOTE#2"]) // the echoed Known item is dropped; only the new fact is kept

  // Turn 2: lookup lists only t1's people row (li#1 already on the path) and the input reads nothing; strikes settle,
  // window opens, director, reveal fired. The narrator gets the feed record as `Current:` after the outcome.
  i = calls().length
  narrations.push("fire")
  warmths.push("warm")
  const t2 = yield* go(S.act(t1.id, { text: "strike B", aside: "ASIDE#2" }))
  assert.deepEqual([t2.answers, S.node(t2.id).state.bond], [{ warmth: "warm" }, 4])
  assert.deepEqual(since(i), ["lookup", "decide", "decide", "decide", "direct", "narrate", "check", "record"])
  assert.equal(str(prompts("lookup").at(-1)!).split("\n")[0], `Index: people@${t1.id}#0=Li`)
  assert.deepEqual(t2.read, [])
  assert.ok(/^Current: scene=place: P#2; present: name=B, mood=calm$/m.test(str(lastNarr())))
  assert.ok(
    /^Current: scene=/m.test(str(prompts("record").at(-1)!)) && !/^Current/m.test(str(prompts("direct").at(-1)!)),
  )
  assert.equal(t2.beats.length, 2)
  assert.ok(S.node(t2.id).events.includes("strike:hit"))
  assert.deepEqual([t2.brief.may, t2.fired], [["li"], [{ id: "li", layer: 2 }]])
  assert.ok(
    /MAY reveal: B is Li/.test(str(lastNarr())) &&
      str(lastNarr()).includes("ASIDE#2") &&
      str(lastNarr()).includes(`Tone: TONE#`),
  )
  // The k-th decide saw the first k events.
  const decides = prompts("decide").slice(-3).map(str)
  assert.ok(
    /So far: -/.test(decides[0]!) &&
      /So far: strike:\w+$/m.test(decides[1]!) &&
      /So far: strike:\w+,strike:\w+$/m.test(decides[2]!),
  )
  // Director never saw prose; narrator never saw the ledger.
  assert.ok(!/PROSE#/.test(str(prompts("direct").at(-1)!)) && !/Ledger/.test(str(lastNarr())))

  // Turn 3: history carries both lore layers; the previous aside and tone are gone; head is byte-identical. The input
  // asks about Li: lookup delivers t1's people row like a lore layer, and it lands in the tail as text.
  i = calls().length
  warmths.push("warm")
  const t3 = yield* go(S.act(t2.id, { text: "speak about Li" }))
  const v3 = str(lastNarr())
  assert.deepEqual(t3.read, [{ id: `people@${t1.id}#0`, layer: 1 }])
  assert.deepEqual(S.node(t3.id).delivered[0]!.text, "name=Li, note=N#2")
  assert.ok(v3.includes("name=Li, note=N#2"))
  assert.ok(v3.includes("B is Li") && v3.includes(full.lore[0]!.layers[0]!) && v3.includes(prose(t2)))
  assert.ok(!v3.includes("ASIDE#2") && !v3.includes(t2.brief.tone!))
  assert.ok(v3.includes("arm's length")) // bond was 4 when this head was built; the answer lands after the prose
  assert.equal(S.node(t3.id).state.bond, 8)
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 3), prompts("narrate").at(-2)!.slice(0, 3))
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 3).map(msgText), [
    "Write in Chinese.",
    "Frame: wuxia",
    "A: swordsman",
  ]) // player zone → frame → fiction
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record"])
  assert.deepEqual(t3.brief, { must: [], may: [] }) // no beat event this turn, t2's readout emitted none: no window
  // Cache breakpoints: the head's last message and the last history message (t2's reply, what next turn resends
  // verbatim) carry markers; this turn's input and tail do not.
  const marks = prompts("narrate")
    .at(-1)!
    .map((m) => (m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl !== undefined)
  const at = (i: number) => msgText(prompts("narrate").at(-1)![i]!)
  assert.deepEqual(
    [marks.at(-1), marks.filter(Boolean).length, at(marks.indexOf(true)), at(marks.lastIndexOf(true))],
    [false, 2, "A keeps the player at arm's length.", prose(t2)],
  )

  // Truncation: one node, prose concatenated, two narrate calls, second prompt ends with the partial as assistant.
  i = calls().length
  narrations.push("cut")
  const t4 = yield* go(C.act(c0.id, { text: "more" }))
  assert.deepEqual(since(i), ["narrate", "narrate", "record"])
  assert.ok(prose(t4).endsWith("partial …and the rest."))
  const resumed = prompts("narrate").at(-1)!.at(-1)!
  assert.equal(resumed.role, "assistant")
  assert.deepEqual([C.size, S.size], [2, 3])

  // Guardrail: a draft that kills B is re-asked once with the broken rule in the tail; the correction never enters history.
  i = calls().length
  narrations.push("kill", "plain")
  warmths.push("close")
  const t5 = yield* go(S.act(t3.id, { text: "finish him" }))
  assert.deepEqual(since(i), ["decide", "narrate", "check", "narrate", "check", "record"])
  assert.ok(str(prompts("narrate").at(-1)!).includes('Previous draft broke: rule "B does not die"'))
  assert.deepEqual(t5.violated, [])
  // The band switched: bond reached 8 at t3's record, so t5's head reads the warm fragment and not the cool one.
  const v5 = str(lastNarr())
  assert.ok(v5.includes("A trusts the player.") && !v5.includes("arm's length"))
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 3), prompts("narrate").at(-3)!.slice(0, 3)) // prefix intact
  i = calls().length
  const t6 = yield* go(S.act(t5.id, { text: "rest" }))
  assert.ok(!str(lastNarr()).includes("Previous draft broke"))
  // A readout option can emit an event. It shows in the ledger the structured stages read next turn, and it opens a
  // window on that next turn: t5's "close" is carried into t6's gate, li's third layer is offered, the director runs.
  assert.ok(S.node(t5.id).events.includes("warmth:close") && /warmth:close/.test(str(prompts("decide").at(-1)!)))
  assert.deepEqual(since(i), ["decide", "direct", "narrate", "check", "record"])
  assert.deepEqual(t6.brief.may, ["li"])
  assert.ok(str(lastNarr()).includes(`MAY reveal: ${full.lore[0]!.layers[2]}`))
  assert.equal(S.node(t6.id).state.bond, 16)

  // Compression in the loop: at 4 turns on the path, the first block (t1, t2) is folded.
  const v6 = str(lastNarr())
  assert.ok(
    v6.includes("Summary:") &&
      !v6.includes(prose(t1)) &&
      !v6.includes(prose(t2)) &&
      v6.includes(prose(t3)) &&
      v6.includes(prose(t5)),
  )
  assert.ok(v6.includes("B is Li") && v6.includes(full.lore[0]!.layers[0]!)) // lore delivered inside the folded range survives in the fold
  const summary = (v: string) => v.match(/Summary:[^]*?(?=\n(?:user|assistant):|$)/)?.[0]
  // Boundary moves in blocks: one more turn keeps the same summary; lore dedupe still sees the folded deliveries.
  i = calls().length
  const t7 = yield* go(S.act(t6.id, { text: "wait" }))
  assert.deepEqual(since(i), ["decide", "narrate", "check", "record"]) // li fully delivered on the folded nodes → nothing to look up
  assert.ok(str(lastNarr()).includes("Summary:") && str(lastNarr()).includes(prose(t3)))
  yield* go(S.act(t7.id, { text: "wait more" }))
  const v8 = str(lastNarr())
  assert.ok(v8.includes("name=Li, note=N#2")) // a recalled product row delivered inside the folded range survives like lore
  assert.ok(!v8.includes(prose(t3)) && v8.includes(prose(t6)))
  // The view is a function of (path, policy), not of what other branches have cached: a sibling of t7 re-renders the
  // shorter path and still folds only the first block, even though a longer fold was just built for t8.
  const t7b = yield* go(S.swipe(t7.id))
  const v7b = str(lastNarr())
  assert.deepEqual([t7b.parent, t7b.input], [t6.id, t7.input])
  assert.ok(v7b.includes(prose(t3)) && v7b.includes(prose(t5)) && !v7b.includes(prose(t2)))
  assert.notEqual(summary(v7b), summary(v8))

  // reword: narrate, check, record only; read/beats/brief kept; sibling under the same parent.
  i = calls().length
  const w = yield* go(S.reword(t2.id))
  assert.deepEqual(since(i), ["narrate", "check", "record"])
  assert.deepEqual([w.parent, w.read, w.beats, w.brief], [t2.parent, t2.read, t2.beats, t2.brief])

  // A greeting with an opening: its effects fold into the state before the first turn (the head reads the warm band,
  // not the initial cool one), and its events are carried into that turn's gate like a readout's: li's second layer is
  // offered on turn 1 of this branch without a single beat.
  const g = S.greet({ text: "G", do: [{ path: "bond", set: 8 }, { event: "warmth:close" }] })
  assert.equal(g.state.bond, 8)
  i = calls().length
  const t9 = yield* go(S.act(g.turn.id, { text: "wait" }))
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record"])
  assert.deepEqual([t9.beats, t9.brief.may], [[], ["li"]])
  assert.ok(str(lastNarr()).includes("A trusts the player.") && str(lastNarr()).includes("G"))
  i = calls().length
  for (const t of S.nodes()) S.node(t.id) // replay: every projection from recorded outputs, no call
  assert.equal(calls().length, i)

  // A player action on a node: demand a product that is off (inner) over t3's scene. One record call, no new node, the
  // answer kept on t3 beside the turn's own products; the player's toggle alone could have switched it on for every turn.
  const size = S.size
  const d = yield* go(S.demand(t3.id, "inner"))
  assert.deepEqual(since(i), ["record"])
  assert.ok(/^INNER#\d+$/.test(d.products.inner as string) && d.products.notes !== undefined)
  assert.equal(S.size, size)
  assert.equal(S.node(t5.id).turn.products.inner, undefined)
  assert.equal(S.node(t3.id).turn.products.inner, d.products.inner) // the amended node is what the path sees

  // ───────── Player actions on a node (docs/card-reading-2.md §8 item 8) ─────────
  // edit: the player's prose stands as the reply of a sibling of t2; check and record run over it, narrate never does.
  // The edited text mentions the tattoo, so the reveal that was open at t2 fires from the player's own words.
  i = calls().length
  const e = yield* go(S.edit(t2.id, "EDITED: the sleeve tears, a crane tattoo"))
  assert.deepEqual(since(i), ["check", "record"])
  assert.deepEqual(
    [e.parent, e.read, e.beats, e.brief, prose(e)],
    [t2.parent, t2.read, t2.beats, t2.brief, "EDITED: the sleeve tears, a crane tattoo"],
  )
  assert.deepEqual(e.fired, [{ id: "li", layer: 2 }])
  assert.ok(str(prompts("check").at(-1)!).includes("EDITED"))

  // setField: an effect kept on t3 and folded last; every descendant's state moves with it (t6 was 16: t5's +8 on 20), no call made.
  // A value outside the field is refused and the node is untouched.
  i = calls().length
  assert.throws(() => S.setField(t3.id, [{ path: "bond", set: 999 }]), /bond/)
  assert.equal(S.node(t3.id).turn.adjust, undefined)
  assert.equal(S.setField(t3.id, [{ path: "bond", set: 20 }]).state.bond, 20)
  assert.deepEqual([S.node(t3.id).state.bond, S.node(t6.id).state.bond, calls().length], [20, 28, i])

  // pin: on t9's branch li's first layer is visible but was never read, so t9 lists it as untold. The player pins it on
  // the next act: no lookup (the pinned entry is kept out of it, nothing else is readable), the narrator gets it as MUST,
  // check confirms it fired, so it is delivered through `fired`, and the new node has nothing untold.
  const hook = full.lore[0]!.layers[0]!.split(/(?<=\.)\s/)[0]!
  assert.deepEqual(S.node(t9.id).readable, [{ id: "li", hook }])
  narrations.push("fire")
  const t10 = yield* go(S.act(t9.id, { text: "wait", pin: "li" }))
  assert.deepEqual(since(i), ["decide", "narrate", "check", "record"])
  assert.ok(str(lastNarr()).includes(`MUST reveal: ${full.lore[0]!.layers[0]!}`))
  assert.deepEqual(
    [t10.brief.must, t10.fired, t10.read, S.node(t10.id).readable],
    [["li"], [{ id: "li", layer: 1 }], [], []],
  )
  // A miss: the narrator ignores the pin, the one correction rewrite runs and misses again; the entry stays untold.
  i = calls().length
  const t10b = yield* go(S.act(t9.id, { text: "wait", pin: "li" }))
  assert.deepEqual(since(i), ["decide", "narrate", "check", "narrate", "check", "record"])
  assert.deepEqual([t10b.fired, S.node(t10b.id).readable], [[], [{ id: "li", hook }]])
  // Pinning what the path already holds is a defect.
  const ex = yield* Effect.exit(go(S.act(t10.id, { text: "wait", pin: "li" })))
  assert.ok(ex._tag === "Failure" && /nothing to pin/.test(String(Cause.squash(ex.cause))))
  i = calls().length

  // stop: the player halts the prose while it streams (the signal completes on the first delta). The text so far is the
  // reply, check is skipped, record runs, the node says `stopped`; "go on" is an aside child that reads the partial back.
  i = calls().length
  narrations.push("long")
  const halt = yield* Deferred.make<void>()
  const t12 = yield* go(
    S.act(t10.id, { text: "wait" }, Deferred.await(halt)).pipe(
      Stream.tap((e) => (e.kind === "delta" ? Deferred.succeed(halt, undefined) : Effect.void)),
    ),
  )
  assert.deepEqual(since(i), ["decide", "narrate", "record"])
  assert.equal(t12.end, "stopped")
  assert.ok(prose(t12).startsWith("PROSE#") && prose(t12).length < 100, prose(t12))
  assert.equal(made().at(-2)!.out, prose(t12)) // the narrate call reports what was kept
  const t13 = yield* go(S.act(t12.id, { text: "", aside: "继续。" }))
  assert.ok(str(lastNarr()).includes(prose(t12)) && t13.end === "end")

  // pick: an option recorded on c0 becomes the player's next act, a child of c0 with that text as the input.
  const t11 = yield* go(C.pick(c0.id, 1))
  assert.deepEqual([t11.parent, t11.input], [c0.id, { text: "O2" }])
  assert.throws(() => C.pick(c0.id, 9), /no option/)

  // ───────── Derived lore counters in the window (§8 item 4), and a card's own ask ─────────
  // A recurring entry: offered when it has not reached the narrator for two turns and has been shown fewer than twice.
  // Never shown counts as Infinity, so it opens on the first turn; shown there, it waits one turn, then opens again.
  // The same card overrides one of the session's own asks by id; the rest keep their defaults.
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
  const E = makeSession({
    card: { ...full, lore: [...full.lore, echo], asks: [{ id: "product.notes", text: "ASK#notes" }] },
    player,
    model,
  })
  narrations.push("fire", "plain", "fire")
  const a = yield* go(E.act(null, { text: "wait" }))
  assert.deepEqual([a.brief.may, a.fired], [["echo"], [{ id: "echo", layer: 2 }]])
  assert.ok(/^notes: ASK#notes$/m.test(str(prompts("record").at(-1)!)))
  assert.ok(/Notes are the record/.test(str(prompts("record").at(-2)!)))
  const b = yield* go(E.act(a.id, { text: "wait" }))
  assert.deepEqual(b.brief.may, []) // since = 1
  const c = yield* go(E.act(b.id, { text: "wait" }))
  assert.deepEqual([c.brief.may, c.fired], [["echo"], [{ id: "echo", layer: 3 }]]) // since = 2, shown = 1
  console.log(str(lastNarr()))
})

await Effect.runPromise(program)
console.log("ok")
