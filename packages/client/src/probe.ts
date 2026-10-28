// The probes of one provider's detail (issue #79): connectivity (the listing from every endpoint) and one test per
// model, each a slot the view reads as a value, filled by the runs the store starts. A result answers the
// configuration it ran on, so the store watches the provider: the address, proxy, headers, key or default protocol
// changed clears every slot and tries the address again; a model's own protocol changed clears that model's. The
// slots are the detail's, which remounts per provider: another provider's results would answer another configuration.
import type { Probe, Provider } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import { type Accessor, createEffect, createSignal, untrack } from "solid-js"

/** A slot through its states. `run` counts the starts; a result lands only on the running slot of its own run, so a
 *  later start or a clear voids what is still in flight (one idiom for the connectivity and for every model). */
export type Slot<T> = { run: number } & ({ state: "idle" } | { state: "running" } | { state: "done"; result: T })
export interface Probes {
  reach: Slot<Probe[]>
  tests: Record<string, Slot<Probe>>
}
export const IDLE: Slot<never> = { run: 0, state: "idle" }
export const NONE: Probes = { reach: IDLE, tests: {} }
export const start = <T>(s: Slot<T> | undefined): Slot<T> => ({ run: (s?.run ?? 0) + 1, state: "running" })
export const land = <T>(s: Slot<T> | undefined, run: number, result: T): Slot<T> | undefined =>
  s?.state === "running" && s.run === run ? { run, state: "done", result } : s
/** Idle again, its run kept: what is in flight on that run is voided, the next start counts on. */
export const clear = <T>(s: Slot<T>): Slot<T> => ({ run: s.run, state: "idle" })
export const result = <T>(s: Slot<T> | undefined): T | undefined => (s?.state === "done" ? s.result : undefined)
const cleared = (p: Probes): Probes => ({
  reach: clear(p.reach),
  tests: Object.fromEntries(Object.entries(p.tests).map(([id, s]) => [id, clear(s)])),
})

/** What a probe that could not be made looks like (the server refused the request: no key, no endpoint): no URL. */
export const refused = (e: unknown): Probe => ({
  formats: [],
  url: "",
  method: "",
  status: 0,
  ms: 0,
  ok: false,
  error: e instanceof Error ? e.message : String(e),
})
/** What the connectivity answers, and every model's test with it. */
export const configOf = (p: Provider): string =>
  JSON.stringify([p.endpoints, p.proxy, p.headers, p.secret, p.defaultFormat])
/** What a model's test answers besides: the protocol it goes under. */
export const formatsOf = (p: Provider | undefined): Record<string, Format> =>
  Object.fromEntries((p?.models ?? []).map((m) => [m.id, m.format ?? p!.defaultFormat]))
/** The models whose protocol changed between two readings; one added or removed did not. */
export const reformatted = (now: Record<string, Format>, prev: Record<string, Format>): string[] =>
  Object.keys(now).filter((id) => prev[id] !== undefined && prev[id] !== now[id])

export const WORKERS = 3
export interface Probing {
  probes: Accessor<Probes>
  /** 检测全部 in flight. */
  batch: Accessor<boolean>
  /** Connectivity: the listing from every endpoint the provider has, through its proxy with its key. */
  reach: () => Promise<void>
  /** One model: a request for a few tokens under its format. */
  test: (model: string) => Promise<void>
  /** The given models, WORKERS at a time in that order; `stop` lets those in flight finish and starts no more. */
  testAll: (models: readonly string[]) => Promise<void>
  stop: () => void
  /** Every result forgotten and the address tried again: for a key replaced in place, which changes nothing the
   *  store watches. */
  restart: () => void
}
export const createProbing = (opts: {
  provider: Accessor<Provider | undefined>
  /** Awaited before any request goes out: the key field's write in flight, or the probe would go out keyless. */
  ready: () => Promise<void>
  /** The wire: the connectivity's probes without a model, that model's one probe with it. */
  run: (id: string, model?: string) => Promise<Probe[]>
}): Probing => {
  const [probes, setProbes] = createSignal<Probes>(NONE)
  const [batch, setBatch] = createSignal(false)
  let batchRun = 0 // the batch whose workers may go on; a stop or a clear voids it the way a slot's run does
  let batching = false // what the handlers see at once (a signal's write lands on the microtask)
  const stop = () => {
    batchRun++
    batching = false
    setBatch(false)
  }
  const clearAll = () => {
    stop()
    setProbes(cleared)
  }
  // the provider as it is when a run starts, a snapshot (the effects below answer its changes)
  const current = () => untrack(opts.provider)?.id
  const reach = async () => {
    const id = current()
    if (id === undefined) return
    await opts.ready()
    let run = 0
    setProbes((p) => {
      const s = start(p.reach)
      run = s.run
      return { ...p, reach: s }
    })
    const got = await opts.run(id).catch((e: unknown) => [refused(e)])
    setProbes((p) => ({ ...p, reach: land(p.reach, run, got) ?? p.reach }))
  }
  const test = async (model: string) => {
    const id = current()
    if (id === undefined) return
    await opts.ready()
    let run = 0
    setProbes((p) => {
      const s = start(p.tests[model])
      run = s.run
      return { ...p, tests: { ...p.tests, [model]: s } }
    })
    const got = await opts.run(id, model).then(
      (r) => r[0] ?? refused(new Error("no probe")),
      (e: unknown) => refused(e),
    )
    setProbes((p) => {
      const s = land(p.tests[model], run, got)
      return s ? { ...p, tests: { ...p.tests, [model]: s } } : p
    })
  }
  const testAll = async (models: readonly string[]) => {
    if (batching) return
    const mine = ++batchRun
    batching = true
    setBatch(true)
    await opts.ready() // once, ahead of the queue: a rekey clears the results, so before any lands
    const queue = [...models]
    const worker = async () => {
      for (let m = queue.shift(); m !== undefined && batchRun === mine; m = queue.shift()) await test(m)
    }
    await Promise.all(Array.from({ length: WORKERS }, worker))
    if (batchRun === mine) stop()
  }
  const restart = () => {
    clearAll()
    void reach()
  }
  // the configuration changed under the results (it was just saved: this is the moment to know the address)
  createEffect(
    () => {
      const p = opts.provider()
      return p && configOf(p)
    },
    (fp, prev) => {
      if (prev !== undefined && fp !== undefined && fp !== prev) restart()
    },
  )
  createEffect(
    () => formatsOf(opts.provider()),
    (now, prev) => {
      const changed = prev ? reformatted(now, prev) : []
      if (changed.length)
        setProbes((p) => ({
          ...p,
          tests: Object.fromEntries(
            Object.entries(p.tests).map(([id, s]) => [id, changed.includes(id) ? clear(s) : s]),
          ),
        }))
    },
  )
  return { probes, batch, reach, test, testAll, stop, restart }
}
