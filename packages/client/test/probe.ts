// The probe store (src/probe.ts) on a scripted wire: a result lands only on the run that asked for it, a clear or a
// re-run voids what is in flight, 检测全部 runs three at a time and stops without cutting those three off, and the
// provider's configuration changing under the results clears them (all of them, or one model's for its own protocol).
import type { Probe, Provider } from "@effect-tavern/provider/src/providers.ts"
import assert from "node:assert/strict"
import { createRoot, createSignal, flush } from "solid-js"
import { clear, configOf, createProbing, formatsOf, land, reformatted, result, start } from "../src/probe.ts"

const probe = (ok: boolean, ms = 1): Probe => ({ formats: [], url: "u", method: "GET", status: ok ? 200 : 500, ms, ok })
const provider = (over: Partial<Provider> = {}): Provider => ({
  id: "p",
  name: "P",
  enabled: true,
  defaultFormat: "openai-compatible",
  endpoints: { "openai-compatible": { url: "https://a" } },
  models: [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }],
  ...over,
})
const settle = () => new Promise((r) => setTimeout(r, 0))

// the slot: a start counts, a result lands on its own running run only, a clear keeps the count
const s1 = start(undefined)
assert.deepEqual(s1, { run: 1, state: "running" })
assert.deepEqual(land(s1, 1, "x"), { run: 1, state: "done", result: "x" })
assert.deepEqual(land(s1, 0, "x"), s1) // an earlier run's result
assert.deepEqual(land(clear(s1), 1, "x"), { run: 1, state: "idle" }) // cleared while in flight
assert.deepEqual(start(clear(s1)), { run: 2, state: "running" })
assert.deepEqual(land(start(clear(s1)), 1, "x"), { run: 2, state: "running" }) // the old run lands on nothing
assert.equal(result(land(s1, 1, "x")), "x")
assert.equal(result(s1), undefined)

// the fingerprints: the request's shape, not the models; a model's protocol by itself
const p = provider()
assert.equal(configOf(p), configOf({ ...p, models: [], name: "Q", enabled: false }))
assert.notEqual(configOf(p), configOf({ ...p, secret: "s" }))
assert.notEqual(configOf(p), configOf({ ...p, defaultFormat: "anthropic" }))
assert.deepEqual(formatsOf(p), {
  m1: "openai-compatible",
  m2: "openai-compatible",
  m3: "openai-compatible",
  m4: "openai-compatible",
})
assert.deepEqual(reformatted({ m1: "anthropic", m5: "gemini" }, formatsOf(p)), ["m1"]) // m5 is new, not changed
assert.deepEqual(formatsOf(undefined), {})

// the store on a wire the test answers by hand
type Pending = { model: string | undefined; resolve: (r: Probe[]) => void; reject: (e: unknown) => void }
let pending: Pending[] = []
const answer = (model: string | undefined, r: Probe[]) => {
  const i = pending.findIndex((x) => x.model === model)
  assert.ok(i >= 0, `${model ?? "reach"} asked`)
  pending.splice(i, 1)[0]!.resolve(r)
}
let readies = 0
const st = createRoot(() => {
  const [prov, setProv] = createSignal<Provider | undefined>(provider())
  const probing = createProbing({
    provider: prov,
    ready: () => (readies++, Promise.resolve()),
    run: (_id, model) => new Promise<Probe[]>((resolve, reject) => pending.push({ model, resolve, reject })),
  })
  return { ...probing, setProv }
})
flush()
const reach = () => st.probes().reach
const test = (id: string) => st.probes().tests[id]

// connectivity: running, then its result; the second run voids the first's
void st.reach()
await settle()
assert.equal(reach().state, "running")
assert.equal(readies, 1)
void st.reach()
await settle()
assert.equal(pending.length, 2)
answer(undefined, [probe(false)]) // the first run's answer, late
await settle()
assert.equal(reach().state, "running")
answer(undefined, [probe(true, 240)])
await settle()
assert.deepEqual(result(reach()), [probe(true, 240)])

// one model: its own slot, a failure from the wire is a refused probe, a re-run voids the first
void st.test("m1")
await settle()
assert.equal(test("m1")?.state, "running")
assert.equal(test("m2"), undefined)
pending.shift()!.reject(new Error("no key"))
await settle()
assert.equal(result(test("m1"))?.error, "no key")
assert.equal(result(test("m1"))?.ok, false)
void st.test("m1")
void st.test("m1")
await settle()
assert.equal(pending.length, 2)
answer("m1", [probe(true, 1)])
await settle()
assert.equal(test("m1")?.state, "running") // the first of the two: voided by the second
answer("m1", [probe(true, 2)])
await settle()
assert.equal(result(test("m1"))?.ms, 2)

// 检测全部: three at a time in order; stop lets them finish and starts no more; the batch flag follows
void st.testAll(["m1", "m2", "m3", "m4"])
await settle()
assert.equal(st.batch(), true)
assert.deepEqual(
  pending.map((x) => x.model),
  ["m1", "m2", "m3"],
)
answer("m2", [probe(true)])
await settle()
assert.deepEqual(
  pending.map((x) => x.model),
  ["m1", "m3", "m4"],
)
st.stop()
flush()
assert.equal(st.batch(), false)
answer("m1", [probe(true)])
answer("m3", [probe(false)])
answer("m4", [probe(true)])
await settle()
assert.equal(pending.length, 0)
assert.equal(result(test("m3"))?.ok, false)
assert.equal(result(test("m4"))?.ok, true)
void st.testAll(["m1"])
void st.testAll(["m2"]) // a second batch while one runs is refused
await settle()
assert.deepEqual(
  pending.map((x) => x.model),
  ["m1"],
)
answer("m1", [probe(true)])
await settle()
assert.equal(st.batch(), false)

// the configuration changed under the results: every slot idle, the in-flight one voided, the address tried again
void st.test("m2")
await settle()
st.setProv((p) => p && { ...p, secret: "s2" })
await settle()
assert.equal(reach().state, "running")
assert.equal(test("m2")?.state, "idle")
assert.equal(test("m1")?.state, "idle")
answer("m2", [probe(true)]) // the voided one lands on nothing
await settle()
assert.equal(test("m2")?.state, "idle")
answer(undefined, [probe(true)])
await settle()
assert.equal(reach().state, "done")
// a save that changes none of it (a name, a model added) keeps them
st.setProv((p) => p && { ...p, name: "Q", models: [...p.models, { id: "m5" }] })
await settle()
assert.equal(reach().state, "done")
assert.equal(pending.length, 0)
// one model's own protocol: that model's slot alone
void st.test("m1")
await settle()
answer("m1", [probe(true)])
await settle()
assert.equal(test("m1")?.state, "done")
st.setProv((p) => p && { ...p, models: p.models.map((m) => (m.id === "m1" ? { ...m, format: "anthropic" } : m)) })
await settle()
assert.equal(test("m1")?.state, "idle")
assert.equal(reach().state, "done")
assert.equal(pending.length, 0)
// restart (a key replaced in place): all idle and the address asked again
st.restart()
await settle()
assert.equal(reach().state, "running")
assert.deepEqual(
  pending.map((x) => x.model),
  [undefined],
)
pending = []

console.log("probe ok")
