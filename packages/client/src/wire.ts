// The seam to packages/server: `GET /card`, `GET /nodes` (nodes and head) and the library (`/stories`, `/personas`,
// `/player`) are the snapshot, `POST /` is one action whose events come back as SSE. A story call (open, new, delete)
// answers the listing with the story to be on (`current`, none on an empty library): the client names it on every
// request after, and pages.ts lands on it (nodes, calls, the draft and the pin gone; a delete that leaves the open
// story open only replaces the listing). A new story is of a card (`POST /stories {card}`); a card's page is readable
// before any story of it (`GET /cards/<id>`). The manager's search (`GET /stories/search`) and the exports
// (`/stories/<id>/export.md|json`, plain links the browser downloads) are the manager's (stories.ts, side.tsx).
// `DELETE /nodes/<id>` drops a node and everything under it (the reply is the Change): the Timeline's branch delete.
// The turn is the server's, not the response's: closing a stream only stops reading it. `POST /stop` is the stop
// (before the first character the turn is withdrawn, after it the prose halts and the node comes down the same
// stream); `GET /turn` picks up the turn in flight on a story the client lands on (204 when there is none).
import type { Probe, Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import type { Hat, Player } from "@effect-tavern/runtime/src/fragment.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action, Change, Node } from "@effect-tavern/runtime/src/session.ts"
import type { Call } from "./inspect.ts"
import type { Hit } from "./stories.ts"
import {
  apply,
  calls,
  card,
  cards,
  hats,
  log,
  names,
  type Persona,
  personas,
  player,
  providers,
  registry,
  routing,
  secrets,
  stories,
  type StoryRow,
  type CardView,
  type Routing,
  type Wire,
} from "./store.ts"

const base = "/api"
/** Every request names the story this client is on (`x-tavern-story`): the server keeps no open story, so two tabs on
 *  two stories never move each other. Before the listing arrives, or with no story at all, it names none: the
 *  install's routes answer, a story's are a 404. */
const call = (url: string, init: RequestInit = {}): Promise<Response> => {
  const id = registry.get(stories)?.current
  if (id == null) return fetch(url, init)
  const headers = new Headers(init.headers)
  headers.set("x-tavern-story", String(id))
  return fetch(url, { ...init, headers })
}
const got = async (res: Promise<Response>) => (await res).json()

export const fetchNodes = async (): Promise<void> =>
  registry.set(log, L.of((await got(call(`${base}/nodes`))) as L.Snapshot<Node>))
export const fetchCard = async (): Promise<void> => registry.set(card, (await got(call(`${base}/card`))) as CardView)
/** A card's page by id, no story needed: where an empty library lands. */
export const fetchCardOf = async (id: string): Promise<void> =>
  registry.set(card, (await got(call(`${base}/cards/${encodeURIComponent(id)}`))) as CardView)
export const dropNodes = async (id: number): Promise<void> => {
  const c = (await got(call(`${base}/nodes/${id}`, { method: "DELETE" }))) as Change
  registry.update(log, (l) => L.apply(l, c))
  await fetchStories() // the head moved: the row's last line and size follow
}
export const fetchCalls = async (): Promise<void> => {
  const by = (await got(call(`${base}/calls`))) as Record<string, Call[]>
  registry.set(calls, new Map(Object.entries(by).map(([id, list]) => [Number(id), list])))
}
/** A listing read or answered by a write keeps the client's own `current`: to a request that names no story (a tab on
 *  a card's page) the server names its newest, and which story the client is on is its tabs' (tabs.ts). The first
 *  listing, at boot, is taken as given. */
const keep = (l: Listing): void => registry.update(stories, (prev) => (prev ? { ...l, current: prev.current } : l))
export const fetchStories = async (): Promise<void> => keep(await got(call(`${base}/stories`)))
export const fetchPersonas = async (): Promise<void> => registry.set(personas, await got(call(`${base}/personas`)))
export const fetchPlayer = async (): Promise<void> => registry.set(player, await got(call(`${base}/player`)))

export type Listing = { current: number | null; stories: readonly StoryRow[] }
const listing = (res: Promise<Response>) => got(res) as Promise<Listing>
// The story calls answer the listing with the story to be on; what the client does with it is pages.ts's (`land`).
export const openStory = (id: number): Promise<Listing> => listing(call(`${base}/stories/${id}`, { method: "PUT" }))
export const newStory = (card: string): Promise<Listing> =>
  listing(call(`${base}/stories`, { method: "POST", body: JSON.stringify({ card }) }))
export const deleteStory = (id: number): Promise<Listing> =>
  listing(call(`${base}/stories/${id}`, { method: "DELETE" }))
/** The cleanup: several at once (`DELETE /stories` with the ids), one listing back. */
export const deleteStories = (ids: readonly number[]): Promise<Listing> =>
  listing(call(`${base}/stories`, { method: "DELETE", body: JSON.stringify({ ids }) }))
/** A name the player gives the story; blank clears it. Nothing else moves: only the listing comes back. */
export const nameStory = async (id: number, title: string): Promise<void> =>
  keep(await got(call(`${base}/stories/${id}`, { method: "PUT", body: JSON.stringify({ title }) })))
/** Starred or not: the same write as a name, only the listing comes back. */
export const starStory = async (id: number, starred: boolean): Promise<void> =>
  keep(await got(call(`${base}/stories/${id}`, { method: "PUT", body: JSON.stringify({ starred }) })))
/** The manager's search: the stories whose turns hold `q`, as hits by story (stories.ts `Hit`). */
export const searchStories = (q: string): Promise<Hit[]> =>
  got(call(`${base}/stories/search?q=${encodeURIComponent(q)}`)) as Promise<Hit[]>
/** Where a story's export is: a link the browser downloads (the server names the file by the title). */
export const exportUrl = (id: number, ext: "md" | "json"): string => `${base}/stories/${id}/export.${ext}`
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
/** What the settings page reads when its tab is shown (tabs.ts): every list it draws, the cards and the model names
 *  its menus name things by. */
export const fetchSettings = (): Promise<unknown> =>
  Promise.all([fetchProviders(), fetchSecrets(), fetchRouting(), fetchHats(), fetchCards(), fetchNames()])

/** Sends one action; returns what closes its stream (the turn goes on on the server). */
export const send = (action: Action): (() => void) =>
  listen((signal) => call(base, { method: "POST", body: JSON.stringify(action), signal }))
/** The turn in flight on this story, if any (`GET /turn`): its `attach` then its events; returns what closes it. */
export const attach = (): (() => void) => listen((signal) => call(`${base}/turn`, { signal }))
/** The player's stop (`POST /stop`): "withdrawn" before the first character, "halted" after it, null when idle. */
export const stop = async (): Promise<"withdrawn" | "halted" | null> =>
  ((await got(call(`${base}/stop`, { method: "POST" }))) as { stopped: "withdrawn" | "halted" | null }).stopped
/** Reads an SSE response into `apply` until it ends or is closed; a 204 is nothing to read. */
const listen = (open: (signal: AbortSignal) => Promise<Response>): (() => void) => {
  const ac = new AbortController()
  void (async () => {
    try {
      const res = await open(ac.signal)
      if (res.status === 204) return
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
          if (ev && data && !ac.signal.aborted) apply({ ...(JSON.parse(data) as object), kind: ev } as Wire)
        }
      }
      void fetchStories() // the open story's row: its size, its last line, its time
    } catch (e) {
      if (!ac.signal.aborted) apply({ kind: "error", message: String(e) })
    }
  })()
  return () => ac.abort()
}
