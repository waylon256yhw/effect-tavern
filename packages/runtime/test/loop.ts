// The session (src/session.ts) on a scripted model, through its interface only: actions in, events out, nodes read
// back. Every stage's request shape (from `call` events) and the node's contents are asserted. The script answers by
// phase name and by what the request says; reveals, kills and cuts are queued per turn.
import { fake, fakeText, type FakeCall, type Message, type FakeReply } from "@effect-tavern/provider"
import { Cause, Deferred, Effect, Stream } from "effect"
import assert from "node:assert/strict"
import * as Log from "../src/log.ts"
import type { Turn } from "../src/session.ts"
import { prose, split, splitter } from "../src/journal.ts"
import { cardView, makeSession, outcome, perform, type Event } from "../src/session.ts"
import { chat, full, plain as player } from "./cards/index.ts"
import { defaultAnswer, lookupAnswer, readStage } from "../support/script.ts"

// ───────── Scripted model ─────────
const narrations: Array<"plain" | "fire" | "kill" | "cut" | "long" | "slop" | "aside" | "asides" | "lt"> = []
const warmths: string[] = [] // scripted readout answers; default "flat"
const onCheck: Array<() => void> = [] // run inside the next check call, on the session's own path
let n = 0
function script(o: FakeCall): FakeReply {
  const doc = readStage(o)
  const { phase, open } = doc
  const last = o.prompt.at(-1)!
  const want = fakeText(last)
  let out: string
  let reason: "stop" | "length" = "stop"
  let delay: number | undefined
  switch (phase) {
    case "lookup":
      return lookupAnswer(o, /about (.+)/i.exec(want)?.[1])
    case "decide": {
      const k = doc.soFar.filter((e) => /strike/.test(e)).length
      out = JSON.stringify({ next: /strike/.test(want) && k < 2 ? "strike" : "end", again: true }) // the script's "strike B" means twice
      break
    }
    case "direct":
      out = JSON.stringify({ must: [], may: open, tone: `TONE#${n}` })
      break
    case "check": {
      onCheck.shift()?.()
      out = JSON.stringify({
        fired: /tattoo/.test(want) ? open : [],
        violated: /KILL/.test(want) ? [full.guard[0]!] : [],
      })
      break
    }
    case "record": {
      // Each readout question is answered from the script, else "flat"; the script knows the wuxia card's product shapes.
      const answers = Object.fromEntries(
        doc.questions.map(({ id, options }) => {
          const want = warmths.shift() ?? "flat"
          return [id, options.includes(want) ? want : options[0]]
        }),
      )
      const canned: Record<string, unknown> = {
        notes: `NOTE#${n}`,
        options: ["O1", "O2", "O3", "O4", "O5"], // five: the cap cuts to four
        scene: { place: `P#${n}`, present: [{ name: "B", mood: "calm" }] },
        // "names li" rows Li too, on a line the lookup script does not read from
        people: /^Player's line: (ask about|names) li/im.test(want) ? [{ name: "Li", note: `N#${n}` }] : [],
        inner: `INNER#${n}`,
      }
      return defaultAnswer(doc, { ...canned, answers })
    }
    default: {
      if (last.role === "assistant") {
        out = " …and the rest."
        break
      } // resumed after a cut
      if (o.prompt.some((m) => fakeText(m).startsWith("Write no prose"))) {
        out = `<<aside>> inner\nINNER#${n}` // a demanded narrate block
        break
      }
      const how = narrations.shift() ?? "plain"
      const mayReveal = o.prompt.some((m) => /^(MAY|MUST) reveal/.test(fakeText(m)))
      out = `PROSE#${++n}${how === "fire" && mayReveal ? " the sleeve tears, a crane tattoo" : ""}${how === "kill" ? " KILL" : ""}`
      if (how === "cut") {
        out += " partial"
        reason = "length"
      }
      if (how === "long") {
        out += " the road winds on through the bamboo".repeat(4)
        delay = 1
      }
      if (how === "slop") {
        out += `.${" The road winds on.".repeat(12)} His knuckles went white. Her knuckles stayed white.`
        delay = 1
      }
      if (how === "aside") out += ".\n\n<<aside>> inner\nBACKSTAGE KILL, a crane tattoo" // what check would flag, if it saw it
      // two declared blocks out of order and one undeclared, the delimiter split across deltas wherever it falls
      if (how === "asides")
        out += ".\n<<aside>> diary\nDIARY KILL\n<<aside>> inner\nINNER BLOCK\n<<aside>> stray\nSTRAY"
      if (how === "lt") out += ".\n<<asides are prose>> and <b>"
      break
    }
    case "polish":
      // a target that "went" white is rewritten, any other is echoed back unchanged
      out = JSON.stringify(
        Object.fromEntries(doc.targets.map(([id, s]) => [id, /went/.test(s) ? "He clenched his fist." : s])),
      )
  }
  return { text: out, cut: reason === "length", delay } // delay: a stop needs the stream to still be running
}

// ───────── Through the interface: every event kept, the node read off the end ─────────
const scripted = fake((o) => script(o))
const model = () => scripted
// Scripted prose is a few tokens a turn, so a budget of 0 folds as early as `keep` and `block` allow: two turns kept,
// the boundary a block of two behind them.
const policy = { budget: 0, keep: 2, block: 2 }
const S = makeSession({ card: full, rows: () => player, model, policy }) // the self-check RPG card
assert.equal(S.meta.input, "act") // the default channel the client opens on: undeclared is act
const N = makeSession({ card: { ...full, input: "note" }, rows: () => player, model })
assert.equal(N.meta.input, "note")
assert.deepEqual(
  N.layer.snippets.map((s) => s.name),
  ["继续", "推进剧情", "时间流逝", "详细描写"],
) // author mode: no thought mark, no channel switch
// its stripped copy: no actions, no lore, no guard; it takes a prefill, so a cut prose is continued (the `cut` turn)
const C = makeSession({ card: chat, rows: () => player, model: () => ({ ...scripted, prefill: true }) })
// every product off and no readouts: a turn is narrate alone, record has nothing to ask and makes no call
const Q = makeSession({
  card: chat,
  rows: () => ({
    harness: {
      ...player.harness!,
      products: ["notes", "options", "scene", "people"].map((id) => ({ id, on: false })),
    },
  }),
  model,
})
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
    [
      "stage",
      ...Array(Math.ceil(prose(c0).length / 8)).fill("delta"),
      "call",
      "change",
      "change",
      "stage",
      "call",
      "change",
    ],
  )
  assert.equal(
    events
      .filter((e) => e.kind === "delta")
      .map((e) => (e.part.type === "text-delta" ? e.part.text : ""))
      .join(""),
    prose(c0),
  )
  assert.deepEqual(events.at(-1), { kind: "change", node: C.node(c0.id), head: c0.id })
  // Products: the default `inner` stays off; `options` (switched on by the card) is capped by code to four; the feed
  // record `scene` is stored whole; unchanged `people` is absent this turn.
  assert.deepEqual(Object.keys(c0.products).sort(), ["notes", "options"])
  assert.deepEqual(c0.products.options, ["O1", "O2", "O3", "O4"])
  assert.deepEqual(C.context(c0.id).world.scene, { place: "P#1", present: [{ name: "B", mood: "calm" }] })
  assert.ok(
    /^notes: Notes are the record/m.test(str(prompts("record")[0]!)) &&
      /^scene: 当前场景所在的位置/m.test(str(prompts("record")[0]!)),
  )

  let i = calls().length
  const t1 = yield* go(S.act(null, { text: "ask about li" }))
  // the lookup's index names every entry by its hook, a lore entry's first sentence included
  assert.ok(!str(prompts("lookup")[0]!).includes("Index:"))
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record"])
  assert.deepEqual(t1.read, [{ id: "li", layer: 1 }])
  assert.equal(S.node(t1.id).delivered[0]!.text, full.lore[0]!.layers[0])
  assert.ok(str(lastNarr()).includes(full.lore[0]!.layers[0]!) && !str(lastNarr()).includes(full.lore[0]!.layers[1]!))
  // Readout: asked at record, answered by enum, no number anywhere the prose stages can see.
  assert.deepEqual(t1.answers, { warmth: "flat" })
  const rec1 = str(prompts("record").at(-1)!)
  assert.ok(/Questions: warmth: 这一幕里裴青舟对待你的态度/.test(rec1) && !/bond|State:/.test(rec1))
  assert.ok(str(lastNarr()).includes(full.fiction[1]!.text!) && !/bond/.test(str(lastNarr())))
  assert.deepEqual(Object.values(S.context(t1.id).world.people as object), [{ name: "Li", note: "N#2" }]) // a recall row: readable by later lookups
  assert.equal(t1.products.notes, "NOTE#2") // one sentence a turn (#82)

  // Recall pins must be readable: neither a row still in the tail nor an invented index reaches the model.
  const beforePin = calls().length
  for (const pin of [`people@${t1.id}#0`, `people@${t1.id}#999`, "people@999#0"]) {
    const failed = yield* Effect.exit(go(S.act(t1.id, { text: "invoke", invoke: [pin] })))
    assert.equal(failed._tag, "Failure")
    if (failed._tag === "Failure") assert.match(Cause.pretty(failed.cause), /not invocable/)
  }
  assert.equal(calls().length, beforePin)

  // Turn 2: no lookup: li#1 is on the path and t1's people row is not readable while t1 is in the unfolded tail (its
  // prose is still verbatim in the transcript); strikes settle, window opens, director, reveal fired. The narrator gets the feed record as `Current:` after the outcome.
  i = calls().length
  narrations.push("fire")
  warmths.push("warm")
  const t2 = yield* go(S.act(t1.id, { text: "strike B", note: "NOTE#2" }))
  assert.deepEqual([t2.answers, S.node(t2.id).state.bond], [{ warmth: "warm" }, 4])
  assert.deepEqual(since(i), ["lookup", "decide", "decide", "decide", "direct", "narrate", "check", "record"])
  assert.deepEqual(S.node(t2.id).playerCatalog, []) // the row's node is in the tail
  assert.deepEqual(t2.read, [])
  assert.ok(/^Current: scene=place: P#2; present: name=B, mood=calm$/m.test(str(lastNarr())))
  assert.ok(
    /^Current: scene=/m.test(str(prompts("record").at(-1)!)) && !/^Current/m.test(str(prompts("direct").at(-1)!)),
  )
  assert.equal(t2.beats.length, 2)
  assert.ok(S.node(t2.id).events.includes("strike:hit"))
  assert.deepEqual([t2.brief.may, t2.fired], [["li"], [{ id: "li", layer: 2 }]])
  assert.ok(
    str(lastNarr()).includes(`MAY reveal: ${full.lore[0]!.layers[1]!}`) &&
      str(lastNarr()).includes("NOTE#2") &&
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

  // Turn 3: history carries both lore layers; the previous note and tone are gone; head is byte-identical. The input
  // asks about Li, but t1's row is still in the tail: nothing to look up.
  i = calls().length
  warmths.push("warm")
  const t3 = yield* go(S.act(t2.id, { text: "speak about Li" }))
  const v3 = str(lastNarr())
  assert.deepEqual(t3.read, [])
  assert.ok(v3.includes(full.lore[0]!.layers[1]!) && v3.includes(full.lore[0]!.layers[0]!) && v3.includes(prose(t2)))
  assert.ok(!v3.includes("NOTE#2") && !v3.includes(t2.brief.tone!))
  assert.ok(v3.includes(full.fiction[1]!.text!)) // bond was 4 when this head was built; the answer lands after the prose
  assert.equal(S.node(t3.id).state.bond, 8)
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 5), prompts("narrate").at(-2)!.slice(0, 5))
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 5).map(msgText), [
    player.harness!.fragments![0]!.text!,
    full.frame[0]!.text!,
    full.frame[1]!.text!,
    full.frame[2]!.text!,
    full.fiction[0]!.text!,
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
    [false, 2, full.fiction[1]!.text!, prose(t2)],
  )

  // Truncation: one node, prose concatenated, two narrate calls, second prompt ends with the partial as assistant.
  i = calls().length
  narrations.push("cut")
  const t4 = yield* go(C.act(c0.id, { text: "more" }))
  assert.deepEqual(since(i), ["narrate", "narrate", "record"])
  assert.ok(prose(t4).endsWith("partial …and the rest."))
  const resumed = prompts("narrate").at(-1)!.at(-1)!
  assert.equal(resumed.role, "assistant")
  assert.deepEqual([C.log.nodes.size, S.log.nodes.size], [2, 3])

  // Guardrail: a draft that kills Pei is re-asked once with the broken rule in the tail; the correction never enters history.
  i = calls().length
  narrations.push("kill", "plain")
  warmths.push("close")
  const t5 = yield* go(S.act(t3.id, { text: "finish him" }))
  assert.deepEqual(since(i), ["decide", "narrate", "check", "narrate", "check", "record"])
  assert.ok(str(prompts("narrate").at(-1)!).includes(`Previous draft broke: rule "${full.guard[0]!}"`))
  assert.deepEqual(t5.violated, [])
  // The band switched: bond reached 8 at t3's record, so t5's head reads the warm fragment and not the cool one.
  const v5 = str(lastNarr())
  assert.ok(v5.includes(full.fiction[2]!.text!) && !v5.includes(full.fiction[1]!.text!))
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 5), prompts("narrate").at(-3)!.slice(0, 5)) // prefix intact
  // A stop that fires while check runs (the client closed after the whole first draft): the rewrite halts before its
  // first character, the first draft stands as the stopped reply with its verdict, and no second check runs.
  i = calls().length
  narrations.push("kill")
  // Fired from inside the check call, not from the consumer: the body runs on its own fiber, and a stop taken off the
  // `stage` event can land after the rewrite has already streamed.
  const late = Deferred.makeUnsafe<void>()
  onCheck.push(() => void Deferred.doneUnsafe(late, Effect.void))
  const t5s = yield* go(S.act(t3.id, { text: "finish him" }, Deferred.await(late)))
  assert.deepEqual(since(i), ["decide", "narrate", "check", "narrate", "record"])
  assert.deepEqual([t5s.end, t5s.violated, prose(t5s).endsWith("KILL")], ["stopped", [full.guard[0]!], true])
  // nothing to run from: an act of nothing, an edit of nothing
  for (const ex of [yield* Effect.exit(go(S.act(t3.id, { text: "" }))), yield* Effect.exit(go(S.edit(t3.id, {})))])
    assert.ok(ex._tag === "Failure" && /empty input|nothing to edit/.test(String(Cause.squash(ex.cause))))
  i = calls().length
  const t6 = yield* go(S.act(t5.id, { text: "rest" }))
  assert.ok(!str(lastNarr()).includes("Previous draft broke"))
  // A readout option can emit an event. It shows in the ledger the structured stages read next turn, and it opens a
  // window on that next turn: t5's "close" is carried into t6's gate, li's third layer is offered, the director runs.
  // At four turns on the path the first block (t1, t2) folds, and t1's people row enters the lookup's Index.
  assert.ok(S.node(t5.id).events.includes("warmth:close") && /warmth:close/.test(str(prompts("decide").at(-1)!)))
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record"])
  assert.ok(!str(prompts("lookup").at(-1)!).includes("Index:"))
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
  assert.ok(v6.includes(full.lore[0]!.layers[1]!) && v6.includes(full.lore[0]!.layers[0]!)) // lore delivered inside the folded range survives in the fold
  const summary = (v: string) => v.match(/Summary:[^]*?(?=\n(?:user|assistant):|$)/)?.[0]
  // Boundary moves in blocks: one more turn keeps the same summary; lore dedupe still sees the folded deliveries (li is
  // fully delivered on the folded nodes), and the lookup reads t1's row, now folded.
  i = calls().length
  const t7 = yield* go(S.act(t6.id, { text: "speak about Li" }))
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record"])
  assert.deepEqual(t7.read, [
    { id: "li", layer: 1 },
    { id: "li", layer: 2 },
  ])
  assert.ok(!t7.deliveries.some((d) => d.source === "memory")) // t3 delivered this revision, still in the window
  assert.match(str(lastNarr()), /entityId=e_\w+, name=Li, note=N#2/)
  assert.ok(str(lastNarr()).includes("Summary:") && str(lastNarr()).includes(prose(t3)))
  // The ledger folds at the same boundary: decide gets the narrator's own Summary, then lines for the tail turns only.
  const line = (p: readonly Message[], head: string) => p.map(msgText).find((t) => t.startsWith(head))
  const led = prompts("decide").at(-1)!
  assert.ok(line(led, "Summary:") !== undefined && line(led, "Summary:") === line(lastNarr(), "Summary:"))
  assert.deepEqual(
    line(led, "Ledger:")!
      .split("\n")
      .slice(1)
      .map((l) => l.split(" → ")[0]),
    [t3, t5, t6].map((t) => t.input.text),
  )
  yield* go(S.act(t7.id, { text: "wait more" }))
  const v8 = str(lastNarr())
  assert.ok(!v8.includes("name=Li, note=N#2")) // the snapshot on t3 has left the window
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
  assert.deepEqual([t2.sibling, t7b.sibling, w.sibling], [undefined, "swipe", "reword"]) // which action made it, for a version list
  // a reword with a word to the narrator: it rides as this sibling's note, in the request and on the record
  const w2 = yield* go(S.reword(t2.id, "plainer"))
  assert.equal(w2.input.note, "NOTE#2\nplainer") // joined to the note the turn already had
  assert.ok(str(lastNarr()).includes("plainer")) // t2 is a note-only turn: the note is the user message itself

  // A greeting with an opening: its effects fold into the state before the first turn (the head reads the warm band,
  // not the initial cool one), and its events are carried into that turn's gate like a readout's: bond 8 floors li at
  // layer 2, so the window opens layer 3 on turn 1 of this branch without a single beat, over layers 1 and 2 nobody
  // read. An opened entry delivers every unread layer up to the opened one (issue #9): 1 and 2 as read (told), 3 as MAY.
  const g = S.greet({ text: "G", do: [{ path: "bond", set: 8 }, { event: "warmth:close" }] }).node!
  assert.equal(g.state.bond, 8)
  i = calls().length
  const t9 = yield* go(S.act(g.turn.id, { text: "wait" }))
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record"])
  assert.deepEqual([t9.beats, t9.brief.may], [[], ["li"]])
  assert.deepEqual(t9.read, [
    { id: "li", layer: 1 },
    { id: "li", layer: 2 },
  ])
  assert.ok(str(lastNarr()).includes(`MAY reveal: ${full.lore[0]!.layers[2]!}`))
  assert.ok(full.lore[0]!.layers.slice(0, 2).every((l) => str(lastNarr()).includes(l)))
  assert.deepEqual(S.node(t9.id).playerCatalog, []) // nothing under the window is left unread
  assert.deepEqual(readStage({ prompt: prompts("check").at(-1)! } as unknown as FakeCall).open, ["li"]) // li opened once
  assert.ok(str(lastNarr()).includes(full.fiction[2]!.text!) && str(lastNarr()).includes("G"))
  // A reword reads t9's read back with the window's layers already in it: delivered once, not twice.
  assert.deepEqual((yield* go(S.reword(t9.id))).read, t9.read)
  i = calls().length
  for (const t of S.log.nodes.values()) S.node(t.id) // replay: every projection from recorded outputs, no call
  assert.equal(calls().length, i)
  // An opening edited: the player's prose replaces the greeting's in a sibling root, the opening's effects kept, no
  // call made (there is no line or note for check or record to read the prose against).
  const ge = yield* go(S.edit(g.turn.id, { text: "G2" }))
  assert.deepEqual([since(i), ge.parent, prose(ge), ge.opening, ge.sibling], [[], null, "G2", g.turn.opening, "edit"])
  assert.equal(S.node(ge.id).state.bond, 8)

  // A player action on a node: demand a product that is off (inner, a narrate product) over t3's scene. One prose call
  // (narrate's view, t3's prose the last reply, the one block asked for), no new node, the answer kept on t3 beside the
  // turn's own products; the player's toggle alone could have switched it on for every turn.
  const size = S.log.nodes.size
  const d = yield* go(S.demand(t3.id, "inner"))
  assert.deepEqual(since(i), ["narrate"])
  const demanded = lastNarr()
  const lastReply = demanded.findLastIndex((m) => m.role === "assistant")
  assert.equal(msgText(demanded[lastReply]!), prose(t3))
  assert.match(msgText(demanded[lastReply + 1]!), /^Write no prose/)
  assert.match(str(demanded.slice(lastReply + 2)), /\ninner: What the character thought/)
  assert.ok(/^INNER#\d+$/.test(d.products.inner as string) && d.products.notes !== undefined)
  // a record product demanded is still one record call
  i = calls().length
  yield* go(S.demand(t3.id, "options"))
  assert.deepEqual(since(i), ["record"])
  assert.equal(S.log.nodes.size, size)
  assert.equal(S.node(t5.id).turn.products.inner, undefined)
  assert.equal(S.node(t3.id).turn.products.inner, d.products.inner) // the amended node is what the path sees

  // ───────── Player actions on a node (docs/card-reading-2.md §8 item 8) ─────────
  // edit: the player's prose stands as the reply of a sibling of t2; check and record run over it, narrate never does.
  // The edited text mentions the tattoo, so the reveal that was open at t2 fires from the player's own words.
  i = calls().length
  const e = yield* go(S.edit(t2.id, { text: "EDITED: the sleeve tears, a crane tattoo" }))
  assert.deepEqual(since(i), ["check", "record"])
  assert.deepEqual(
    [e.parent, e.read, e.beats, e.brief, prose(e)],
    [t2.parent, t2.read, t2.beats, t2.brief, "EDITED: the sleeve tears, a crane tattoo"],
  )
  assert.deepEqual(e.fired, [{ id: "li", layer: 2 }])
  assert.equal(e.sibling, "edit")
  assert.ok(str(prompts("check").at(-1)!).includes("EDITED"))
  // edit with the line revised and the prose kept: the same sibling shape, the record redone over the new words
  i = calls().length
  const r = yield* go(S.edit(t2.id, { input: { text: "REVISED line" } }))
  assert.deepEqual(since(i), ["check", "record"])
  assert.deepEqual(
    [r.parent, r.input.text, prose(r), r.beats, r.sibling],
    [t2.parent, "REVISED line", prose(t2), t2.beats, "edit"],
  )
  assert.ok(str(prompts("record").at(-1)!).includes("REVISED line"))
  // edit whose prose breaks a rule: the verdict is recorded and the player's words stand, never rewritten
  i = calls().length
  const v = yield* go(S.edit(t2.id, { text: "EDITED: KILL" }))
  assert.deepEqual([since(i), v.violated, prose(v)], [["check", "record"], [full.guard[0]!], "EDITED: KILL"])

  // setField: an effect kept on t3 and folded last; every descendant's state moves with it (t6 was 16: t5's +8 on 20), no call made.
  // A value outside the field is refused and the node is untouched.
  i = calls().length
  assert.throws(() => S.setField(t3.id, [{ path: "bond", set: 999 }]), /bond/)
  assert.equal(S.node(t3.id).turn.adjust, undefined)
  assert.equal(S.setField(t3.id, [{ path: "bond", set: 20 }]).node!.state.bond, 20)
  assert.deepEqual([S.node(t3.id).state.bond, S.node(t6.id).state.bond, calls().length], [20, 28, i])

  // Card lore is model-only by default; it never leaks into the player's menu.
  const p0 = S.greet({ text: "G", do: [{ path: "bond", set: 8 }] }).node!
  assert.deepEqual(S.node(p0.id).playerCatalog, [])
  const t10 = yield* go(S.act(p0.id, { text: "wait" }))
  // stop: the player halts the prose while it streams (the signal completes on the first delta). The text so far is the
  // reply, check is skipped, record runs, the node says `stopped`; "go on" is an note child that reads the partial back.
  i = calls().length
  narrations.push("long")
  const halt = yield* Deferred.make<void>()
  const t12 = yield* go(
    S.act(t10.id, { text: "wait" }, Deferred.await(halt)).pipe(
      Stream.tap((e) => (e.kind === "delta" ? Deferred.succeed(halt, undefined) : Effect.void)),
    ),
  )
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "record"])
  assert.equal(t12.end, "stopped")
  assert.ok(prose(t12).startsWith("PROSE#") && prose(t12).length < 100, prose(t12))
  assert.equal(made().at(-2)!.out, prose(t12)) // the narrate call reports what was kept
  const t13 = yield* go(S.act(t12.id, { text: "", note: "继续。" }))
  assert.ok(str(lastNarr()).includes(prose(t12)) && t13.end === "end")
  // A thought in the input: decide and narrate both hear what ⦅ ⦆ is; a turn without one carries no such line.
  const thought = /not said, not done/
  assert.ok(!thought.test(str(prompts("decide").at(-1)!)) && !thought.test(str(lastNarr())))
  yield* go(S.act(t13.id, { text: "⦅wait⦆" }))
  assert.ok(thought.test(str(prompts("decide").at(-1)!)) && thought.test(str(lastNarr())))

  // an option is sent as any typed input is (the client fills the box): a child of c0 with that text as its line; on
  // a note card the same send is a direction, never a line in the story
  const t11 = yield* go(C.act(c0.id, { text: "O2" }))
  assert.deepEqual([t11.parent, t11.input], [c0.id, { text: "O2" }])
  const n0 = yield* go(N.act(null, { text: "", note: "开场" }))
  const n1 = yield* go(N.act(n0.id, { text: "", note: "O2" }))
  assert.deepEqual(n1.input, { text: "", note: "O2" })
  i = calls().length
  const q0 = yield* go(Q.act(null, { text: "hello" }))
  assert.deepEqual([since(i), q0.products], [["narrate"], {}])

  // ───────── Derived lore counters in the window (§8 item 4), and a card's own ask ─────────
  // The counters themselves are test/derived.ts; here the window the gate opens reaches direct and check. The same card
  // overrides one of the session's own asks by id; the rest keep their defaults.
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
    rows: () => player,
    model,
  })
  narrations.push("fire")
  const a = yield* go(E.act(null, { text: "wait" }))
  assert.deepEqual([a.brief.may, a.fired], [["echo"], [{ id: "echo", layer: 2 }]])
  assert.ok(/^notes: ASK#notes$/m.test(str(prompts("record").at(-1)!)))
  assert.ok(/Notes are the record/.test(str(prompts("record").at(-2)!)))

  // ───────── Stages bound to connections: a named stage gets its model, the rest the default ─────────
  let light = 0
  const lookup = fake((o) => (light++, script(o)))
  const B = makeSession({ card: full, rows: () => player, model: (p) => (p === "lookup" ? lookup : scripted) })
  const before = made().length
  yield* go(B.act(null, { text: "about li" }))
  const phases = made()
    .slice(before)
    .map((e) => e.phase)
  assert.deepEqual([light, phases.filter((p) => p === "lookup").length], [3, 1])
  assert.ok(phases.includes("narrate") && phases.includes("record")) // unnamed: the default answered them
  console.log(str(lastNarr()))
  // ───────── The connection's hat, resolved per request by id; a tail-placed player fragment ─────────
  const H = makeSession({
    card: full,
    rows: () => ({
      harness: {
        ...player.harness!,
        fragments: [...player.harness!.fragments!, { id: "taste", text: "TASTE-TAIL", at: "tail" }],
      },
    }),
    model: () => ({ ...scripted, hat: "h" }),
    hat: (id) => (id === "h" ? { id, name: "h", narrate: { tail: [{ role: "user", text: "HAT-TAIL" }] } } : undefined),
  })
  yield* go(H.act(null, { text: "about li" }))
  assert.deepEqual(lastNarr().slice(-2).map(msgText), ["TASTE-TAIL", "HAT-TAIL"])
  assert.ok(!str(prompts("record").at(-1)!).includes("TAIL"))

  // ───────── Polish: code finds lexicon hits in the final prose, one call rewrites those sentences only ─────────
  // The chat card has no guard and nothing open, so the turn goes narrate → polish → record. The script rewrites the
  // sentence that "went" white and echoes the other: the first is spliced in, the echo stands, record reads the result.
  let polishing = player
  const P = makeSession({
    card: { ...chat, lexicon: [{ pattern: "knuckles*white", hint: "stock image" }] },
    rows: () => polishing,
    model,
  })
  i = calls().length
  narrations.push("slop")
  const p1 = yield* go(P.act(null, { text: "hello" }))
  assert.deepEqual(since(i), ["narrate", "polish", "record"])
  const asked = str(prompts("polish").at(-1)!)
  assert.ok(asked.includes('<target id="hit-1" hits="knuckles went white">His knuckles went white.</target>'), asked)
  assert.ok(asked.includes("hit-2: stock image") && !/A: |PROSE#\d+\n/.test(asked.split("\n")[0]!))
  assert.ok(prose(p1).endsWith(" He clenched his fist. Her knuckles stayed white."), prose(p1))
  assert.ok(
    str(prompts("record").at(-1)!).includes("He clenched his fist.") &&
      !/went white/.test(str(prompts("record").at(-1)!)),
  )
  // The player's toggle off: no call, the prose stands.
  polishing = { harness: { ...player.harness!, switches: { ...player.harness!.switches, polish: false } } }
  i = calls().length
  narrations.push("slop")
  const p2 = yield* go(P.act(p1.id, { text: "hello" }))
  assert.deepEqual([since(i), /went white/.test(prose(p2))], [["narrate", "record"], true])
  polishing = player
  // The player's own prose (an edit) is never rewritten, hits or not.
  i = calls().length
  const p3 = yield* go(P.edit(p1.id, { text: prose(p2) }))
  assert.deepEqual([since(i), prose(p3)], [["record"], prose(p2)])
  // A stopped stream is not polished: halted past the floor, the hits in the kept prose stand.
  i = calls().length
  narrations.push("slop")
  const enough = yield* Deferred.make<void>()
  let streamed = ""
  const p4 = yield* go(
    P.act(p1.id, { text: "hello" }, Deferred.await(enough)).pipe(
      Stream.tap((e) => {
        if (e.kind === "delta" && e.part.type === "text-delta") streamed += e.part.text
        return /went white/.test(streamed) ? Deferred.succeed(enough, undefined) : Effect.void
      }),
    ),
  )
  assert.deepEqual([since(i), p4.end, /went white/.test(prose(p4))], [["narrate", "record"], "stopped", true])

  // ───────── Narrate products: each `<<aside>> <id>` block is cut off the prose into products[id] ─────────
  // The fake streams eight characters a delta, so the nine-character delimiter always arrives split across two.
  // `inner` is the harness's narrate product (switched on here), `diary` a card's; `stray` is declared by nobody.
  const diary = {
    role: "theater" as const,
    id: "diary",
    label: "日记",
    text: "Her diary entry.",
    shape: { kind: "text" as const },
    stage: "narrate" as const,
  }
  const A = makeSession({
    card: { ...full, products: [...(full.products ?? []), diary] },
    rows: () => ({
      harness: { ...player.harness!, products: [...player.harness!.products!, { id: "inner", on: true }] },
    }),
    model,
  })
  /** The deltas of one action: prose text and product text by id. */
  const live = (from: number) => {
    const ds = events.slice(from).flatMap((e) => (e.kind === "delta" ? [e.part] : []))
    const by: Record<string, string> = {}
    for (const d of ds) if (d.type === "product-delta") by[d.id] = (by[d.id] ?? "") + d.text
    return { text: ds.flatMap((d) => (d.type === "text-delta" ? [d.text] : [])), by }
  }
  narrations.push("aside")
  let e0 = events.length
  i = calls().length
  const a1 = yield* go(A.act(null, { text: "hello" }))
  const ran = since(i)
  // the ask: one instruction and one line per narrate product on, in narrate's tail; record is not asked for them
  assert.match(str(lastNarr()), /<<aside>> <id>[^]*\ninner: What the character thought[^]*\ndiary: Her diary entry\./)
  assert.ok(!/^(inner|diary): /m.test(str(prompts("record").at(-1)!)))
  let l = live(e0)
  assert.ok(!l.text.some((d) => d.includes("<<")) && /^PROSE#\d+\.\s*$/.test(l.text.join("")), l.text.join(""))
  assert.equal(l.by.inner?.trim(), "BACKSTAGE KILL, a crane tattoo")
  assert.deepEqual([a1.reply.length, a1.reply[0]!.type, /^PROSE#\d+\.$/.test(prose(a1))], [1, "text", true])
  assert.equal(a1.products.inner, "BACKSTAGE KILL, a crane tattoo")
  // check saw the prose only: no KILL, no rewrite, nothing fired; record read the prose only
  assert.deepEqual(
    [ran.filter((p) => p === "narrate").length, ran.includes("check"), a1.violated, a1.fired],
    [1, true, [], []],
  )
  for (const phase of ["check", "record"]) assert.ok(!/BACKSTAGE|<<aside>>/.test(str(prompts(phase).at(-1)!)))
  assert.equal(A.node(a1.id).turn, a1)
  // several blocks in any order land under their ids, an undeclared one cut and kept too; the prose is clean
  narrations.push("asides")
  e0 = events.length
  const a2 = yield* go(A.act(a1.id, { text: "rest" }))
  assert.ok(str(lastNarr()).includes(prose(a1)) && !/BACKSTAGE/.test(str(lastNarr()))) // a1's block never goes back
  assert.deepEqual(
    [a2.products.diary, a2.products.inner, a2.products.stray, /^PROSE#\d+\.$/.test(prose(a2))],
    ["DIARY KILL", "INNER BLOCK", "STRAY", true],
  )
  assert.deepEqual(a2.violated, []) // check never read DIARY KILL
  l = live(e0)
  assert.deepEqual(
    [l.text.some((d) => d.includes("<<")), l.by.diary?.trim(), l.by.inner?.trim(), l.by.stray],
    [false, "DIARY KILL", "INNER BLOCK", "STRAY"],
  )
  yield* go(A.act(a2.id, { text: "on" }))
  assert.ok(!/DIARY|INNER BLOCK|STRAY/.test(str(lastNarr()))) // the transcript; the ask itself names the delimiter
  // a line that starts like the delimiter but is not one is held back, then released as prose
  narrations.push("lt")
  e0 = events.length
  const a3 = yield* go(A.act(a2.id, { text: "rest" }))
  l = live(e0)
  assert.ok(
    l.text.join("").endsWith(".\n<<asides are prose>> and <b>") && prose(a3).endsWith("<<asides are prose>> and <b>"),
  )
  assert.deepEqual(l.by, {})
  // no narrate product on: no instruction at all
  assert.ok(!/<<aside>>/.test(str(prompts("narrate")[0]!))) // c0's, inner off
  // an enabled theater set to `trigger: "demand"` is not asked on every turn, only on demand
  const onDemandOnly = makeSession({
    card: full,
    rows: () => ({
      harness: {
        ...player.harness!,
        products: [...player.harness!.products!, { id: "inner", on: true, trigger: "demand" }],
      },
    }),
    model,
  })
  yield* go(onDemandOnly.act(null, { text: "hello" }))
  assert.ok(!/<<aside>>/.test(str(lastNarr())))
  // the cutter alone: no delimiter, the very parts; a bare `<<aside>>` is `aside`; a chunk boundary anywhere holds
  const kept = [{ type: "text" as const, text: "a\n<<asides are prose>> b" }]
  assert.equal(split(kept).reply, kept)
  assert.deepEqual(split([{ type: "text", text: "x\n<<aside>>\ny" }]), {
    reply: [{ type: "text", text: "x" }],
    blocks: { aside: "y" },
  })
  const cut = splitter()
  const joined = (ps: { id?: string; text: string }[]) =>
    ps.reduce<Record<string, string>>((m, p) => ({ ...m, [p.id ?? ""]: (m[p.id ?? ""] ?? "") + p.text }), {})
  // one character a delta: the held `<` at the end comes out only when the stream ends
  assert.deepEqual(joined("p\n<<aside>> inner\nq\n<".split("").flatMap((c) => cut(c))), { "": "p\n", inner: "q\n" })
  assert.deepEqual(cut("", true), [{ id: "inner", text: "<" }])
  // An ancestor edit validates every branch before writing. Reopening keeps both the tree and the beat sequence.
  let saved: Log.Snapshot<Turn> | undefined
  let writes = 0
  const store: Log.Store<Turn> = {
    read: () => saved,
    write: (_, log) => {
      saved = Log.snapshot(log)
      writes++
    },
  }
  const opts = {
    card: {
      ...chat,
      frame: [],
      fiction: [],
      rules: {
        fields: [{ path: "hp", type: "int" as const, initial: 10, min: 0, max: 10 }],
        actions: [{ id: "strike", text: "strike", when: { path: "hp", op: "gt" as const, value: 0 }, roll: 0.5 }],
      },
    },
    rows: () => player,
    model: () =>
      fake((o) =>
        readStage(o).phase === "decide"
          ? { text: JSON.stringify({ next: /strike/.test(fakeText(o.prompt.at(-1)!)) ? "strike" : "end" }) }
          : script(o),
      ),
    store,
  }
  const tree = makeSession(opts)
  const root = tree.greet({ text: "opening" }).node!.id
  const branch = yield* go(tree.act(root, { text: "strike" }))
  yield* go(tree.act(root, { text: "rest" })) // head is on a branch with no gated beat
  const beforeEdit = saved
  const written = writes
  assert.throws(() => tree.setField(root, [{ path: "hp", set: 0 }]), /not an available action/)
  assert.equal(saved, beforeEdit)
  assert.equal(writes, written)
  assert.equal(tree.snapshot().nodes.length, 3)
  tree.setField(root, [{ path: "hp", set: 5 }])
  assert.equal(tree.node(branch.id).state.hp, 5)
  const reopened = makeSession(opts)
  assert.deepEqual(reopened.snapshot(), tree.snapshot())
  const max = Math.max(...[...tree.log.nodes.values()].flatMap((t) => t.beats.map((b) => b.seed)))
  const next = yield* go(reopened.act(branch.id, { text: "strike" }))
  assert.equal(next.beats[0]!.seed, max + 1)

  // The provider's structured-output validation rejects a judged choice without chance, before narration or a write.
  let chance: number | undefined
  const judge = makeSession({
    card: {
      ...opts.card,
      rules: { fields: [], actions: [{ id: "jump", text: "jump", roll: { judge: "difficulty" } }] },
    },
    rows: () => player,
    model: () =>
      fake((o) => (readStage(o).phase === "decide" ? { text: JSON.stringify({ next: "jump", chance }) } : script(o))),
  })
  const failed = yield* Effect.exit(go(judge.act(null, { text: "jump" })))
  assert.equal(failed._tag, "Failure")
  assert.equal(judge.log.nodes.size, 0)
  chance = 0.5
  const jumped = yield* go(judge.act(null, { text: "jump" }))
  assert.equal(jumped.beats[0]!.chance, 0.5)

  // A dynamic opening (#148): a greeting with a note, the player's opening on a `start` field after the greeting's `do`
  // and the player's note after the card's. Node 0 is a narrated turn on the opened state: the warm band is in the
  // narrator's head, the opening's events open li's window on this very turn, and the node stores the opening.
  const dyn = makeSession({
    card: {
      ...full,
      rules: { ...full.rules, fields: full.rules.fields.map((f) => (f.path === "bond" ? { ...f, start: true } : f)) },
      greetings: [
        { text: "SHOWN", note: "OPEN the scene", do: [{ event: "warmth:close" }] },
        { text: "STATIC", do: [{ event: "warmth:close" }] },
      ],
    },
    rows: () => player,
    model,
  })
  i = calls().length
  const d0 = yield* go(perform(dyn, { kind: "greet", opening: [{ path: "bond", set: 8 }], note: "a wish" }))
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record"])
  assert.deepEqual(
    [d0.parent, d0.input, d0.opening],
    [null, { text: "", note: "OPEN the scene\n\na wish" }, [{ event: "warmth:close" }, { path: "bond", set: 8 }]],
  )
  assert.equal(dyn.node(d0.id).state.bond, 8)
  assert.ok(str(lastNarr()).includes(full.fiction[2]!.text!) && !str(lastNarr()).includes("SHOWN")) // text not prepended
  assert.deepEqual(d0.brief.may, ["li"])
  // record reads the prose alone: the note goes to narrator and director only (request.ts), so a profile the opening
  // asks for is extracted from what the prose shows (#148 §2.4, open)
  assert.ok(!str(prompts("record").at(-1)!).includes("a wish"))
  // a swipe and a reword of the dynamic root keep its opening, and their state is the opened one
  const ds = yield* go(perform(dyn, { kind: "swipe", node: d0.id }))
  const dr = yield* go(perform(dyn, { kind: "reword", node: d0.id }))
  assert.deepEqual([ds.opening, dr.opening, ds.sibling, dr.sibling], [d0.opening, d0.opening, "swipe", "reword"])
  assert.deepEqual([dyn.node(ds.id).state.bond, dyn.node(dr.id).state.bond], [8, 8])
  // a text greeting without a note stays static (no call), the player's opening appended to its `do`
  i = calls().length
  const st = yield* go(perform(dyn, { kind: "greet", greeting: 1, opening: [{ path: "bond", set: 8 }] }))
  assert.deepEqual(
    [since(i), prose(st), st.opening],
    [[], "STATIC", [{ event: "warmth:close" }, { path: "bond", set: 8 }]],
  )
  // the opening's events reach one gate: the narrated root's own, never again on its turn 1; a static root has no gate,
  // so its turn 1 reads them (li offered there, not under the dynamic root)
  const d1 = yield* go(dyn.act(d0.id, { text: "wait" }))
  const s1 = yield* go(dyn.act(st.id, { text: "wait" }))
  assert.deepEqual([d1.brief.may, d1.opportunities], [[], []])
  assert.deepEqual([s1.brief.may, s1.opportunities.map((d) => d.id)], [["li"], ["li"]])
  // only `start` fields: hp is not one, and an event is no field at all
  assert.throws(() => dyn.begin({ opening: [{ path: "hp", set: 5 }] }), /hp: not a field the player sets/)
  assert.throws(() => dyn.begin({ opening: [{ event: "x" }] }), /not a field the player sets/)
  // a card with no greetings opens from the player's note alone; with neither, there is nothing to open
  const bare = makeSession({ card: { ...full, greetings: [] }, rows: () => player, model })
  assert.equal((yield* go(bare.begin({ note: "start here" }))).input.note, "start here")
  assert.throws(() => bare.begin({}), /no greeting 0/)
  // the client sees the note's first line where a greeting has no text, never the note itself
  assert.deepEqual(cardView({ ...full, greetings: [{ note: "line one\nline two" }] }).greetings, [{ text: "line one" }])
})

await Effect.runPromise(program)
console.log("ok")
