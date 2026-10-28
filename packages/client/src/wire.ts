// The seam to packages/server: `GET /card`, `GET /nodes` (nodes and head) and the library (`/stories`, `/personas`,
// `/player`) are the snapshot, `POST /` is one action whose events come back as SSE. A story call (open, new, delete)
// answers the listing with the story to be on (`current`): the client adopts it, names it on every request after, and starts over on it (nodes, calls, the draft and the pin gone).
// `DELETE /nodes/<id>` drops a node and everything under it (the reply is the Change): the Timeline's branch delete.
// Closing the response is the stop (before the first delta it withdraws the turn, after it the prose halts).
import type { Probe, Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import type { Hat, Player } from "@effect-tavern/runtime/src/fragment.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action, Change, Node } from "@effect-tavern/runtime/src/session.ts"
import type { Call } from "./inspect.ts"
import {
  apply,
  calls,
  card,
  cards,
  editing,
  hats,
  log,
  names,
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
/** Every request names the story this client is on (`x-tavern-story`): the server keeps no open story, so two tabs on
 *  two stories never move each other. Before the listing arrives it names none, and the server takes the newest. */
const call = (url: string, init: RequestInit = {}): Promise<Response> => {
  const id = registry.get(stories)?.current
  if (id === undefined) return fetch(url, init)
  const headers = new Headers(init.headers)
  headers.set("x-tavern-story", String(id))
  return fetch(url, { ...init, headers })
}
const got = async (res: Promise<Response>) => (await res).json()

export const fetchNodes = async (): Promise<void> =>
  registry.set(log, L.of((await got(call(`${base}/nodes`))) as L.Snapshot<Node>))
export const fetchCard = async (): Promise<void> => registry.set(card, (await got(call(`${base}/card`))) as CardView)
export const dropNodes = async (id: number): Promise<void> => {
  const c = (await got(call(`${base}/nodes/${id}`, { method: "DELETE" }))) as Change
  registry.update(log, (l) => L.apply(l, c))
  await fetchStories() // the head moved: the row's last line and size follow
}
export const fetchCalls = async (): Promise<void> => {
  const by = (await got(call(`${base}/calls`))) as Record<string, Call[]>
  registry.set(calls, new Map(Object.entries(by).map(([id, list]) => [Number(id), list])))
}
export const fetchStories = async (): Promise<void> => registry.set(stories, await got(call(`${base}/stories`)))
export const fetchPersonas = async (): Promise<void> => registry.set(personas, await got(call(`${base}/personas`)))
export const fetchPlayer = async (): Promise<void> => registry.set(player, await got(call(`${base}/player`)))

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
export const openStory = (id: number): Promise<void> => onStory(call(`${base}/stories/${id}`, { method: "PUT" }))
export const newStory = (): Promise<void> => onStory(call(`${base}/stories`, { method: "POST" }))
export const deleteStory = (id: number): Promise<void> => onStory(call(`${base}/stories/${id}`, { method: "DELETE" }))
/** A name the player gives the story; blank clears it. Nothing else moves: only the listing comes back. */
export const nameStory = async (id: number, title: string): Promise<void> =>
  registry.set(stories, await got(call(`${base}/stories/${id}`, { method: "PUT", body: JSON.stringify({ title }) })))
const at = (id: string) => `${base}/personas/${encodeURIComponent(id)}`
export const putPersona = async ({ id, ...body }: Persona): Promise<void> =>
  registry.set(personas, await got(call(at(id), { method: "PUT", body: JSON.stringify(body) })))
export const deletePersona = async (id: string): Promise<void> => {
  registry.set(personas, await got(call(at(id), { method: "DELETE" })))
  await fetchPlayer() // the pick on any card it held is gone with it
}
export const putPlayer = async (p: Player): Promise<void> =>
  registry.set(player, await got(call(`${base}/player`, { method: "PUT", body: JSON.stringify(p) })))

// The settings (/providers, /secrets, /routing, /hats): each write answers the list it changed, which replaces the
// atom; nothing is optimistic. A key goes up once (POST /secrets) and comes back as a hint only;
// the eye and copy read one value on purpose (secretValue).
const json = (method: string, v: unknown): RequestInit => ({ method, body: JSON.stringify(v) })
const enc = encodeURIComponent
/** A body or its {error}: a non-2xx answer throws the server's reason. */
const checked = async <T>(res: Promise<Response>): Promise<T> => {
  const r = await res
  const v = (await r.json()) as T & { error?: string }
  if (!r.ok) throw new Error(v.error ?? `HTTP ${r.status}`)
  return v
}
export const fetchCards = async (): Promise<void> => registry.set(cards, await got(call(`${base}/cards`)))
export const fetchNames = async (): Promise<void> => registry.set(names, await got(call(`${base}/models/names`)))
export const fetchProviders = async (): Promise<void> => registry.set(providers, await got(call(`${base}/providers`)))
export const putProvider = async ({ id, ...body }: Provider): Promise<void> => {
  registry.set(providers, await checked(call(`${base}/providers/${enc(id)}`, json("PUT", body))))
  await fetchRouting() // a pair on a model it no longer lists went with it
}
export const deleteProvider = async (id: string): Promise<void> => {
  registry.set(providers, await got(call(`${base}/providers/${enc(id)}`, { method: "DELETE" })))
  await fetchRouting() // the pairs on it are gone with it
}
/** A model as the service lists it (`GET /providers/<id>/models`): the format where the listing puts it off the
 *  provider's default protocol and onto an endpoint the provider has. */
export interface Listed {
  id: string
  format?: Format
}
/** The service's own model list, each with the format it goes under when that is not the provider's default. */
export const listModels = (id: string): Promise<Listed[]> => checked(call(`${base}/providers/${enc(id)}/models`))
/** The probes (provider `Probe`): with a model one request for a few tokens' answer, without one the listing from
 *  every endpoint the provider has, one per distinct listing URL. A completed probe is one whatever it found; what
 *  throws is the provider's configuration (no key, no endpoint, a bad URL), the server's message. */
export const testProvider = (id: string, model?: string): Promise<Probe[]> =>
  checked(call(`${base}/providers/${enc(id)}/test`, json("POST", model === undefined ? {} : { model })))
export const fetchSecrets = async (): Promise<void> => registry.set(secrets, await got(call(`${base}/secrets`)))
/** Without a type, the server reads it off the key (`sk-ant-oat…` is a bearer). */
export const addSecret = async (s: { name: string; type?: SecretView["type"]; value: string }): Promise<SecretView> => {
  const made = await checked<SecretView>(call(`${base}/secrets`, json("POST", s)))
  await fetchSecrets()
  return made
}
export const setSecret = async (
  id: string,
  s: { name: string; type?: SecretView["type"]; value?: string }, // a value replaces the key in place, and retypes it when no type is given
): Promise<void> => registry.set(secrets, await checked(call(`${base}/secrets/${enc(id)}`, json("PUT", s))))
/** The one key the server answers (GET /secrets/<id>/value): read per click for the eye or copy, kept nowhere. */
export const secretValue = async (id: string): Promise<string> =>
  (await checked<{ value: string }>(call(`${base}/secrets/${enc(id)}/value`))).value
export const deleteSecret = async (id: string): Promise<void> =>
  registry.set(secrets, await got(call(`${base}/secrets/${enc(id)}`, { method: "DELETE" })))
export const fetchRouting = async (): Promise<void> => registry.set(routing, await got(call(`${base}/routing`)))
export const putRouting = async (r: Routing): Promise<void> =>
  registry.set(routing, await checked(call(`${base}/routing`, json("PUT", r))))
export const fetchHats = async (): Promise<void> => registry.set(hats, await got(call(`${base}/hats`)))
export const putHat = async ({ id, ...body }: Hat): Promise<void> =>
  registry.set(hats, await checked(call(`${base}/hats/${enc(id)}`, json("PUT", body))))
export const deleteHat = async (id: string): Promise<void> =>
  registry.set(hats, await got(call(`${base}/hats/${enc(id)}`, { method: "DELETE" })))

/** Sends one action; returns the stop. */
export const send = (action: Action): (() => void) => {
  const ac = new AbortController()
  void (async () => {
    try {
      const res = await call(base, { method: "POST", body: JSON.stringify(action), signal: ac.signal })
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
