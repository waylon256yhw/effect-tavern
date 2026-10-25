// The seam to packages/server: `GET /card`, `GET /nodes` (nodes and head) and the library (`/stories`, `/personas`,
// `/player`) are the snapshot, `POST /` is one action whose events come back as SSE. A story call (open, new, delete)
// answers the listing with the story now open: the client starts over on it (nodes, calls, the draft and the pin gone).
// `DELETE /nodes/<id>` drops a node and everything under it (the reply is the Change): the Timeline's branch delete.
// Closing the response is the stop (before the first delta it withdraws the turn, after it the prose halts).
import type { Trace } from "@effect-tavern/provider/src/connection.ts"
import type { Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import type { Hat, Player } from "@effect-tavern/runtime/src/fragment.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action, Change, Node } from "@effect-tavern/runtime/src/session.ts"
import type { Call } from "./inspect.ts"
import {
  apply,
  calls,
  card,
  editing,
  hats,
  log,
  page,
  type Persona,
  personas,
  pin,
  player,
  providers,
  registry,
  routing,
  secrets,
  settle,
  stories,
  type CardView,
  type Routing,
  type Wire,
} from "./store.ts"

const base = "/api"
const got = async (res: Promise<Response>) => (await res).json()

export const fetchNodes = async (): Promise<void> =>
  registry.set(log, L.of((await got(fetch(`${base}/nodes`))) as L.Snapshot<Node>))
export const fetchCard = async (): Promise<void> => registry.set(card, (await got(fetch(`${base}/card`))) as CardView)
export const dropNodes = async (id: number): Promise<void> => {
  const c = (await got(fetch(`${base}/nodes/${id}`, { method: "DELETE" }))) as Change
  registry.update(log, (l) => L.apply(l, c))
  await fetchStories() // the head moved: the row's last line and size follow
}
export const fetchCalls = async (): Promise<void> => {
  const by = (await got(fetch(`${base}/calls`))) as Record<string, Call[]>
  registry.set(calls, new Map(Object.entries(by).map(([id, list]) => [Number(id), list])))
}
export const fetchStories = async (): Promise<void> => registry.set(stories, await got(fetch(`${base}/stories`)))
export const fetchPersonas = async (): Promise<void> => registry.set(personas, await got(fetch(`${base}/personas`)))
export const fetchPlayer = async (): Promise<void> => registry.set(player, await got(fetch(`${base}/player`)))

/** A story call: the listing comes back with the open story, and the client is on it as if just opened: an empty
 *  story lands on the card page. */
const onStory = async (res: Promise<Response>): Promise<void> => {
  registry.set(stories, await got(res))
  settle()
  registry.set(pin, null)
  registry.set(editing, null)
  registry.set(calls, new Map())
  await fetchNodes()
  registry.set(page, registry.get(log).nodes.size ? "reader" : "card")
}
export const openStory = (id: number): Promise<void> => onStory(fetch(`${base}/stories/${id}`, { method: "PUT" }))
export const newStory = (): Promise<void> => onStory(fetch(`${base}/stories`, { method: "POST" }))
export const deleteStory = (id: number): Promise<void> => onStory(fetch(`${base}/stories/${id}`, { method: "DELETE" }))
const at = (id: string) => `${base}/personas/${encodeURIComponent(id)}`
export const putPersona = async ({ id, ...body }: Persona): Promise<void> =>
  registry.set(personas, await got(fetch(at(id), { method: "PUT", body: JSON.stringify(body) })))
export const deletePersona = async (id: string): Promise<void> => {
  registry.set(personas, await got(fetch(at(id), { method: "DELETE" })))
  await fetchPlayer() // the pick on any card it held is gone with it
}
export const putPlayer = async (p: Player): Promise<void> =>
  registry.set(player, await got(fetch(`${base}/player`, { method: "PUT", body: JSON.stringify(p) })))

// The settings (/providers, /secrets, /routing, /hats): each write answers the list it changed, which replaces the
// atom; nothing is optimistic. A key goes up once (POST /secrets) and comes back as a hint only.
const json = (method: string, v: unknown): RequestInit => ({ method, body: JSON.stringify(v) })
const enc = encodeURIComponent
/** A body or its {error}: a non-2xx answer throws the server's reason. */
const checked = async <T>(res: Promise<Response>): Promise<T> => {
  const r = await res
  const v = (await r.json()) as T & { error?: string }
  if (!r.ok) throw new Error(v.error ?? `HTTP ${r.status}`)
  return v
}
export const fetchProviders = async (): Promise<void> => registry.set(providers, await got(fetch(`${base}/providers`)))
export const putProvider = async ({ id, ...body }: Provider): Promise<void> =>
  registry.set(providers, await checked(fetch(`${base}/providers/${enc(id)}`, json("PUT", body))))
export const deleteProvider = async (id: string): Promise<void> => {
  registry.set(providers, await got(fetch(`${base}/providers/${enc(id)}`, { method: "DELETE" })))
  await fetchRouting() // the pairs on it are gone with it
}
export const listModels = (id: string): Promise<string[]> => checked(fetch(`${base}/providers/${enc(id)}/models`))
/** One minimal request through the provider: "200 · 260ms", or the error. */
export const testProvider = async (id: string, model?: string): Promise<{ ok: boolean; text: string }> => {
  const r = await fetch(`${base}/providers/${enc(id)}/test`, json("POST", model === undefined ? {} : { model }))
  const v = (await r.json()) as Trace & { error?: string; trace?: Trace }
  return r.ok ? { ok: true, text: `${v.status} · ${v.ms}ms` } : { ok: false, text: v.error ?? `HTTP ${r.status}` }
}
export const fetchSecrets = async (): Promise<void> => registry.set(secrets, await got(fetch(`${base}/secrets`)))
export const addSecret = async (s: { name: string; type: SecretView["type"]; value: string }): Promise<SecretView> => {
  const made = await checked<SecretView>(fetch(`${base}/secrets`, json("POST", s)))
  await fetchSecrets()
  return made
}
export const setSecret = async (
  id: string,
  s: Pick<SecretView, "name" | "type"> & { value?: string }, // a value replaces the key in place
): Promise<void> => registry.set(secrets, await checked(fetch(`${base}/secrets/${enc(id)}`, json("PUT", s))))
export const deleteSecret = async (id: string): Promise<void> =>
  registry.set(secrets, await got(fetch(`${base}/secrets/${enc(id)}`, { method: "DELETE" })))
export const fetchRouting = async (): Promise<void> => registry.set(routing, await got(fetch(`${base}/routing`)))
export const putRouting = async (r: Routing): Promise<void> =>
  registry.set(routing, await checked(fetch(`${base}/routing`, json("PUT", r))))
export const fetchHats = async (): Promise<void> => registry.set(hats, await got(fetch(`${base}/hats`)))
export const putHat = async ({ id, ...body }: Hat): Promise<void> =>
  registry.set(hats, await checked(fetch(`${base}/hats/${enc(id)}`, json("PUT", body))))
export const deleteHat = async (id: string): Promise<void> =>
  registry.set(hats, await got(fetch(`${base}/hats/${enc(id)}`, { method: "DELETE" })))

/** Sends one action; returns the stop. */
export const send = (action: Action): (() => void) => {
  const ac = new AbortController()
  void (async () => {
    try {
      const res = await fetch(base, { method: "POST", body: JSON.stringify(action), signal: ac.signal })
      if (!res.ok || !res.body) return apply({ kind: "error", message: `${res.status} ${await res.text()}` })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const ev = /^event: (.*)$/m.exec(block)?.[1]
          const data = /^data: (.*)$/m.exec(block)?.[1]
          if (ev && data) apply({ ...(JSON.parse(data) as object), kind: ev } as Wire)
        }
      }
      void fetchStories() // the open story's row: its size, its last line, its time
    } catch (e) {
      if (!ac.signal.aborted) apply({ kind: "error", message: String(e) })
    }
  })()
  return () => ac.abort()
}
