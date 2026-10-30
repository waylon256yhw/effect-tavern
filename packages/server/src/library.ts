// The library behind the wire: one card's stories and the player's personas, one story open. A story is a session over
// its rows in data.ts, with the player layer the library stores (it wins over the harness default given). A persona is
// the player's, a sibling of the card, not a step of a story: `Player.persona[card]` names the one in force, and the
// library reads its text into the per-card persona slot on every request (the card's default overridden by the slot
// rules, nothing else in the card touched), so an edit of the persona is in force from the next request and a change of
// pick is one head rewrite, no new story. Deleting a persona drops the pick (no silent fallback). The library holds no
// "open story": each request names its own (serve.ts reads `x-tavern-story`) and `session(id)` opens that story's
// session on first use and keeps it, so two clients on two stories never move each other. What every story shares is
// the install's: the player layer (a write reaches every open session), personas, hats, providers and routing. A hat is the player's too, named by a
// connection (`Model.hat`) and read from the table on every request the same way: an edit is in force from the
// next request, and a deleted hat leaves the connection bare (the id resolves to nothing).
// The model each stage runs on is the routing row's (provider, model) pair, the stage's own or the default, resolved
// from the tables on every call the same way: a routing or provider edit is in force from the next request. A pair
// that does not resolve (provider gone, disabled, no key, no endpoint) fails that request naming the provider. A stage
// the row does not name runs on `model`, the environment's (dev.ts); `pinned` puts it over the row (MODEL=fake).
import {
  bind,
  connection,
  listModels,
  plan,
  text,
  secretType,
  secretView,
  type Connection,
  type Format,
  type Model,
  type ModelEntry,
  type Probe,
  type Provider,
  type Secret,
  type Trace,
} from "@effect-tavern/provider"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { decodePlayer, type Player } from "@effect-tavern/runtime/src/fragment.ts"
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import { policyFor } from "@effect-tavern/runtime/src/history.ts"
import { makeSession, phases, type Phase, type Session, type Turn } from "@effect-tavern/runtime/src/session.ts"
import { Effect, Schema } from "effect"
import type { Data } from "./data.ts"
import type { Exported } from "./export.ts"
import { names } from "./names.ts"

/** The model test asks for this many output tokens: the least a gateway accepts (CommandCode refuses `max_tokens` under
 *  16), still a fraction of a cent on any model. */
const PROBE_TOKENS = 16
const Pair = Schema.Struct({ provider: Schema.String, model: Schema.String })
export const Routing = Schema.Struct({
  default: Schema.optionalKey(Pair),
  stages: Schema.optionalKey(Schema.Struct(Object.fromEntries(phases.map((p) => [p, Schema.optionalKey(Pair)])))),
})
export type Routing = { default?: typeof Pair.Type; stages?: Partial<Record<Phase, typeof Pair.Type>> }
/** No pair for the stage and no environment model. Its `code` rides the stream's `error` event (serve.ts), so the client
 *  offers its way into Settings → 默认模型 without reading the message. */
export class NoModel extends Error {
  readonly code = "no-model"
  constructor() {
    super("no model: pick a default model in settings")
  }
}

export const library = ({
  data,
  card,
  cards = [],
  player,
  model: env,
  pinned = false,
}: {
  data: Data
  card: Card
  /** The cards besides the library's own: the TS template modules, by id and title. */
  cards?: readonly { id: string; title?: string }[]
  player: Player
  model?: (phase: Phase) => Model
  pinned?: boolean
}) => {
  const routing = (): Routing => (data.routing.read() as Routing | undefined) ?? {}
  const providerOf = (id: string): Provider => {
    const p = data.providers.list().find((x) => x.id === id)
    if (!p) throw new Error(`no provider ${id}`)
    return p
  }
  const secretOf = (p: Provider) => data.secrets.list().find((s) => s.id === p.secret)
  /** A pair as the session runs it: the flattened connection, bound. */
  const resolve = (pair: typeof Pair.Type): Model => {
    const p = providerOf(pair.provider)
    const m = p.models.find((x) => x.id === pair.model)
    if (!m) throw new Error(`provider "${p.name}": no model ${pair.model}`)
    return bind(connection(p, m, secretOf(p)))
  }
  const model = (phase: Phase): Model => {
    const r = pinned ? {} : routing()
    const pair = r.stages?.[phase] ?? r.default
    if (pair) return resolve(pair)
    if (!env) throw new NoModel()
    return env(phase)
  }
  /** The fold policy off the narrate pair's model entry (the one stage that reads the unfolded tail), never throwing:
   *  `GET /nodes` folds before any model is needed, on a fresh install too. No pair, no entry, or pinned → 8000. */
  const policy = () => {
    const r = pinned ? {} : routing()
    const pair = r.stages?.narrate ?? r.default
    const m =
      pair &&
      data.providers
        .list()
        .find((x) => x.id === pair.provider)
        ?.models.find((x) => x.id === pair.model)
    return policyFor(m?.contextTokens)
  }
  /** The routing row without the pairs `keep` refuses; written only when something went. */
  const prune = (keep: (pair: typeof Pair.Type) => boolean) => {
    const r = routing()
    const stages = Object.entries(r.stages ?? {}).filter(([, v]) => v && keep(v))
    const lost = (r.default && !keep(r.default)) || stages.length !== Object.keys(r.stages ?? {}).length
    if (!lost) return
    data.routing.write({
      ...(r.default && keep(r.default) && { default: r.default }),
      ...(r.stages && { stages: Object.fromEntries(stages) }),
    })
  }
  /** A provider probed whether or not it is enabled (the player tests before switching it on), on a model entry of its
   *  own or a bare id, with the one fetch traced. */
  const probe = (id: string, m: ModelEntry) => {
    const p = providerOf(id)
    return connection({ ...p, enabled: true }, m, secretOf(p))
  }
  /** One request through `c` as a Probe: the fetch's trace (the last one, when ai-sdk retried; status 0 when nothing
   *  answered), or `url` with status 0 when it never got to a fetch. `code` is the first socket error code down the
   *  cause chain (ai-sdk wraps the fetch error, call.ts wraps that). */
  const probed = async (
    formats: Format[],
    c: Connection,
    url: string,
    go: (onTrace: (t: Trace) => void) => Promise<unknown>,
  ): Promise<Probe> => {
    let trace: Trace | undefined
    const onTrace = (t: Trace) => void (trace = t)
    let error: string | undefined
    let code: string | undefined
    try {
      await go(onTrace)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      for (let x: unknown = e, i = 0; x instanceof Error && i < 6; x = x.cause, i++) {
        const c = (x as { code?: unknown }).code
        if (typeof c === "string" && c) {
          code = c
          break
        }
      }
    }
    const { url: sent, method, status, ms } = trace ?? { url, method: "GET", status: 0, ms: 0 }
    return {
      formats,
      url: sent,
      method,
      status,
      ms,
      ok: error === undefined,
      ...(code && { code }),
      ...(error !== undefined && { error }),
    }
  }
  /** The format a listed model goes under, when the listing says it is not on the provider's default protocol and an
   *  endpoint the provider has is on one it names; otherwise none (the default, or nothing known). */
  const formatFor = (p: Provider, formats: Format[] | undefined): Format | undefined =>
    formats && !formats.includes(p.defaultFormat) ? formats.find((f) => p.endpoints[f]?.url.trim()) : undefined
  /** Where a provider lists models: one group per distinct listing URL over every endpoint it has (two formats on
   *  one address are one group, under the default format's auth), the default's first. What the listing and the
   *  connectivity probe both walk, so they never disagree on which endpoints exist. Throws on a bad configuration. */
  const listings = (id: string): Array<{ url: string; formats: Format[]; c: Connection }> => {
    const p = providerOf(id)
    const formats = (Object.keys(p.endpoints) as Format[]).filter((f) => p.endpoints[f]?.url.trim())
    const ordered = [p.defaultFormat, ...formats.filter((f) => f !== p.defaultFormat)]
    const byUrl = new Map<string, { url: string; formats: Format[]; c: Connection }>()
    for (const f of ordered) {
      const c = probe(id, { id: "", format: f })
      const url = plan(c.format, c.endpoint).models
      const g = byUrl.get(url) ?? { url, formats: [], c }
      g.formats.push(f)
      byUrl.set(url, g)
    }
    return [...byUrl.values()]
  }
  const players = {
    read: () => {
      const p = data.player.read()
      return p === undefined ? undefined : decodePlayer(p)
    },
    write: data.player.write,
  }
  const persona = (p: Player) => {
    const id = p.persona?.[card.id]
    return id === undefined ? undefined : data.personas.list().find((x) => x.id === id)?.text
  }
  const hat = (id: string) => data.hats.list().find((h) => h.id === id)
  // ponytail: a session stays open for the life of the process once a request names its story; evict when that matters
  const sessions = new Map<Id, Session>()
  const exists = (id: Id) => data.stories.list(card.id, id).length > 0 // one story's line, not the card's
  /** The most recently updated story, or a new one when the card has none. */
  const newest = () => data.stories.list(card.id)[0]?.id ?? data.stories.create(card.id)
  /** A story's session, opened on its first request and the same one for every request that names it after. */
  const session = (id: Id = newest()): Session => {
    let s = sessions.get(id)
    if (s) return s
    if (!exists(id)) throw new Error(`no story ${id}`)
    s = makeSession({ card, player, model, store: data.store<Turn>(id), players, persona, hat, policy })
    sessions.set(id, s)
    return s
  }
  /** The player layer is the install's, one for every story: a write reaches every open session. */
  const setPlayer = (p: Player) => {
    data.player.write(p)
    for (const s of sessions.values()) s.setPlayer(p)
  }
  return {
    session,
    exists,
    newest,
    get player(): Player {
      return players.read() ?? player
    },
    setPlayer,
    calls: (id: Id) => data.calls(id),
    stories: {
      /** A row: the player's title or none (the client prints "New story"), the star, the turns and the last one's
       *  input, the time. A card's stories all open on the same greeting, so no line of the text tells them apart:
       *  a name the player gave does, and the last line they wrote recalls where the story stands. */
      list: () => data.stories.list(card.id),
      /** Named by the player, or the name cleared (empty or blank): null, the state "never named". */
      title: (id: Id, title: string | null) => data.stories.title(id, title?.trim() || null),
      /** Starred: the left card and the manager put it first. */
      star: (id: Id, starred: boolean) => data.stories.star(id, starred),
      create: (): Id => data.stories.create(card.id),
      del: (id: Id) => {
        if (!exists(id)) throw new Error(`no story ${id}`)
        data.stories.del(id)
        sessions.delete(id)
      },
      /** The batch cleanup: the card's own among `ids` go, in one transaction, their sessions with them; another
       *  card's or a stranger's id is left alone. */
      delMany: (ids: readonly Id[]) => {
        for (const id of data.stories.delMany(card.id, ids)) sessions.delete(id)
      },
      /** This card's stories that hold `q` on their head's line (data.ts `Hit`). The title is the client's to match. */
      search: (q: string) => data.stories.search(card.id, q),
      /** One story whole for export.ts: its row, the card it is of, and its log tree; none when it is not this
       *  card's. */
      export: (id: Id): Exported | undefined => {
        const story = data.stories.list(card.id, id)[0]
        if (!story) return undefined
        return { card: { id: card.id, title: card.title ?? card.id }, story, snapshot: data.store<Turn>(id).read()! }
      },
    },
    hats: data.hats,
    /** The vault as the wire lists it: never a value (that is `value`, one key on request). A provider naming a deleted secret has no key. */
    secrets: {
      list: () => data.secrets.list().map(secretView),
      /** The type is the caller's (the vault's own menu), else read off the key (`secretType`). */
      add: (s: Omit<Secret, "id" | "type"> & { type?: Secret["type"] }) => {
        const made = { id: crypto.randomUUID(), ...s, type: s.type ?? secretType(s.value) }
        data.secrets.put(made)
        return secretView(made)
      },
      /** A name or type changed, and the value when one is given (a retyped key); the hint follows it, and so does
       *  the type when the caller gave none: the key says what it is. */
      set: (id: string, s: { name: string; type?: Secret["type"]; value?: string }) => {
        const old = data.secrets.list().find((x) => x.id === id)
        if (!old) throw new Error(`no secret ${id}`)
        const type = s.type ?? (s.value !== undefined ? secretType(s.value) : old.type)
        data.secrets.put({ ...old, name: s.name, type, ...(s.value !== undefined && { value: s.value }) })
      },
      del: data.secrets.del,
      /** The one key that leaves: GET /secrets/<id>/value, the owner's reveal or copy. */
      value: (id: string): string | undefined => data.secrets.list().find((x) => x.id === id)?.value,
    },
    providers: {
      list: data.providers.list,
      /** Written; a routing pair on a model it no longer lists is cleared (a disabled provider's pairs stay: it can be
       *  switched back on). */
      put: (p: Provider) => {
        data.providers.put(p)
        prune((pair) => pair.provider !== p.id || p.models.some((m) => m.id === pair.model))
      },
      /** Gone, and from the routing: a stage that ran on it follows the default again, or the environment's model. */
      del: (id: string) => {
        data.providers.del(id)
        prune((pair) => pair.provider !== id)
      },
      /** The provider's model list from every endpoint it has (`listings`), merged by id in listing order, each with
       *  the format it goes under when it is off the default (`formatFor`). A model's formats are what its listing
       *  says (`supported_endpoints`), else the formats of the endpoint that listed it: a model only the OpenAI host
       *  lists goes under openai-compatible without the gateway's field. A listing that fails is left out while
       *  another answers (the connectivity tag names it); all failing is the first's error. Read only: the sync
       *  drawer writes the format into the entries it adds, and offers to on the ones already there. */
      models: async (id: string): Promise<Array<{ id: string; format?: Format }>> => {
        const p = providerOf(id)
        const groups = listings(id)
        const got = await Promise.allSettled(groups.map((g) => listModels(g.c)))
        const merged = new Map<string, Format[]>()
        got.forEach((r, i) => {
          if (r.status !== "fulfilled") return
          for (const m of r.value) {
            const formats = m.formats ?? groups[i]!.formats
            merged.set(m.id, [...new Set([...(merged.get(m.id) ?? []), ...formats])])
          }
        })
        if (!merged.size) {
          const failed = got.find((r) => r.status === "rejected")
          if (failed) throw failed.reason
        }
        return [...merged].map(([id, formats]) => {
          const format = formatFor(p, formats)
          return { id, ...(format && { format }) }
        })
      },
      /** Minimal requests, each a Probe (a completed probe is one whatever it found; what throws here is the provider's
       *  configuration: no key, no endpoint, a bad URL). With a model, one request for a few tokens' answer under the
       *  model's format. Without, the listing from every endpoint the provider has: one request per distinct listing
       *  URL (two formats on one address share a probe, sent under the default format's auth), the default's first. */
      test: async (id: string, model?: string): Promise<Probe[]> => {
        const p = providerOf(id)
        if (model !== undefined) {
          const c = probe(id, p.models.find((m) => m.id === model) ?? { id: model })
          return [
            await probed([c.format], c, plan(c.format, c.endpoint, c.model).generate, async (onTrace) => {
              const failed = await Effect.runPromise(
                text(bind(c, { onTrace }), [{ role: "user", content: "Hi" }], { maxOutputTokens: PROBE_TOKENS }).pipe(
                  Effect.match({ onFailure: (e) => e, onSuccess: () => undefined }),
                ),
              )
              if (failed) throw failed
            }),
          ]
        }
        return Promise.all(
          listings(id).map((g) => probed(g.formats, g.c, g.url, (onTrace) => listModels(g.c, { onTrace }))),
        )
      },
    },
    routing: { read: routing, write: data.routing.write },
    /** The model-name table in force (names.ts). */
    names: () => names(data),
    /** Every card the install knows, by id and title: the open one, the templates, the library's table; first id wins. */
    cards: () =>
      [card, ...cards, ...data.cards()]
        .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i)
        .map((c) => ({ id: c.id, title: c.title ?? c.id })),
    personas: {
      ...data.personas,
      /** Gone from the table, and from every card it was picked on: the card's own persona is back in force there. */
      del: (id: string) => {
        data.personas.del(id)
        const p = players.read() ?? player
        if (p.persona && Object.values(p.persona).includes(id)) {
          const rest = Object.fromEntries(Object.entries(p.persona).filter(([, v]) => v !== id))
          setPlayer({ ...p, persona: Object.keys(rest).length ? rest : undefined }) // an empty map leaves the JSON like any unset key
        }
      },
    },
  }
}
export type Library = ReturnType<typeof library>
