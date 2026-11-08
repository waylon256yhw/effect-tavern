import { imeController } from "../src/ime.ts"
import assert from "node:assert/strict"
import { captureArtifact, expectNoDiagnostics } from "@solidjs/diagnostics"
import {
  emptyDraft,
  addInvocation,
  removeInvocation,
  backspaceInvocation,
  matchingInvocations,
} from "../src/composition.ts"
import { readCache } from "../src/read-cache.ts"
import {
  composition,
  registry,
  updateComposition,
  revise,
  cancelRevise,
  card,
  type CardView,
  apply,
  clear,
  log,
} from "../src/store.ts"
import { createTurn } from "../src/turn.ts"
import { timelineNode, token } from "./fixtures.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"

const { artifact } = await captureArtifact(
  async () => {
    const a = token("pack:a/guide")
    const b = token("card:action")
    const two = addInvocation(addInvocation(emptyDraft(), a), b)
    assert.equal(addInvocation(two, a), two)
    assert.deepEqual(removeInvocation(two, a.resourceId).invocations, [b])
    assert.deepEqual(backspaceInvocation(two, 0, 0, false).invocations, [a])
    for (const [start, end, composing] of [
      [1, 1, false],
      [0, 1, false],
      [0, 0, true],
    ] as const)
      assert.equal(backspaceInvocation(two, start, end, composing), two)
    const catalog = [a, b].map((i) => ({ ...i, available: true, category: "guide", summary: "写作技巧" }))
    assert.deepEqual(matchingInvocations(catalog, [a], "写作"), [catalog[1]])
    assert.equal(matchingInvocations([{ ...catalog[0]!, available: false }], [], "").length, 0)
    assert.equal(matchingInvocations(catalog, [], "missing").length, 0)
    registry.set(card, { input: "act" } as CardView)
    registry.set(log, L.of())
    const typed = { ...two, text: "  草稿  ", note: "旁注", noteOpen: true }
    registry.set(composition, typed)
    const node = {
      ...timelineNode(1, null, "prose", "old"),
      invocations: [b],
      input: { text: "old", invoke: [b.resourceId] },
    }
    revise(node, "text")
    assert.deepEqual(registry.get(composition).invocations, [b])
    cancelRevise()
    assert.deepEqual(registry.get(composition), typed)
    // A synchronous transport failure cannot race a later Composer clear.
    const turn = createTurn({
      send: () => {
        apply({ kind: "error", message: "failed" })
        return () => {}
      },
      attach: () => () => {},
      stop: async () => null,
    })
    turn.act()
    assert.deepEqual(registry.get(composition), typed)
    clear()
    // A newly selected token is a real draft: a late error must not overwrite it.
    const delayed = createTurn({ send: () => () => {}, attach: () => () => {}, stop: async () => null })
    delayed.act()
    updateComposition({ invocations: [b] })
    apply({ kind: "error", message: "late failure" })
    assert.deepEqual(registry.get(composition).invocations, [b])
    assert.equal(registry.get(composition).text, "")
    clear()
    // Reattached failures keep frozen labels even when the Pack is no longer mounted.
    registry.set(composition, emptyDraft())
    apply({
      kind: "attach",
      phase: null,
      draft: { parent: null, input: { text: "", invoke: [a.resourceId] }, invocations: [a], text: "", fresh: true },
    })
    apply({ kind: "error", message: "reattached" })
    assert.deepEqual(registry.get(composition).invocations, [a])
    clear()
  },
  { scenario: "unified-draft-lifecycle" },
)
expectNoDiagnostics(artifact)

const cache = readCache<string>(2)
let count = 0
const version = {}
const read = (key: string, revision = version) => cache(key, revision, async () => String(++count))
assert.equal(await read("story1/1"), "1")
assert.equal(await read("story1/1"), "1")
assert.equal(await read("story2/1"), "2") // same numeric node, different story
assert.equal(await read("story1/1", {}), "3") // same ID after settlement amendment
await read("story3/1")
assert.equal(await read("story2/1"), "5") // capacity is bounded
let reject!: (e: Error) => void
const old = cache(
  "same",
  version,
  () =>
    new Promise((_, no) => {
      reject = no
    }),
)
const failure = assert.rejects(old, /late/)
const newer = cache("same", {}, async () => "new")
reject(new Error("late"))
await failure
assert.equal(await newer, "new")
console.log("composition and read cache ok")

let sends = 0
const ime = imeController(() => {
  sends++
  return true
})
const enter = {
  key: "Enter",
  preventDefault() {},
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 13,
} as KeyboardEvent
assert.equal(ime.keyDown(enter), false)
assert.equal(ime.keyDown(enter, true), true)
ime.compositionStart()
assert.equal(ime.keyDown(enter, true), false)
ime.compositionEnd()
assert.equal(ime.keyDown(enter, true), false)
assert.equal(sends, 1)
ime.dispose()
