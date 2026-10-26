// The library behind the wire: one card's stories and the player's personas, one story open. A story is a session over
// its rows in data.ts, with the player layer the library stores (it wins over the harness default given). A persona is
// the player's, a sibling of the card, not a step of a story: `Player.persona[card]` names the one in force, and the
// library reads its text into the per-card persona slot on every request (the card's default overridden by the slot
// rules, nothing else in the card touched), so an edit of the persona is in force from the next request and a change of
// pick is one head rewrite, no new story. Deleting a persona drops the pick (no silent fallback). The library holds no
// "open story": each request names its own (serve.ts reads `x-tavern-story`) and `session(id)` opens that story's
// session on first use and keeps it, so two clients on two stories never move each other. What every story shares is
// the install's: the player layer (a write reaches every open session), personas, hats, providers and routing. A hat is the player's too, named by a
// connection (`SessionModel.hat`) and read from the table on every request the same way: an edit is in force from the
// next request, and a deleted hat leaves the connection bare (the id resolves to nothing).
// The model each stage runs on is the routing row's (provider, model) pair, the stage's own or the default, resolved
// from the tables on every call the same way: a routing or provider edit is in force from the next request. A pair
// that does not resolve (provider gone, disabled, no key, no endpoint) fails that request naming the provider. A stage
// the row does not name runs on `model`, the environment's (dev.ts); `pinned` puts it over the row (MODEL=fake).
import {
  capabilities,
  compile,
  connection,
  listModels,
  text,
  secretView,
  type ModelEntry,
  type Provider,
  type Secret,
  type Trace,
} from "@effect-tavern/provider"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { decodePlayer, type Player } from "@effect-tavern/runtime/src/fragment.ts"
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import { policyFor } from "@effect-tavern/runtime/src/history.ts"
import {
  makeSession,
  type Phase,
  type Session,
  type SessionModel,
  type SessionModels,
  type Turn,
} from "@effect-tavern/runtime/src/session.ts"
import { Effect, Schema } from "effect"
import type { Data } from "./data.ts"

const Pair = Schema.Struct({ provider: Schema.String, model: Schema.String })
const phases = ["lookup", "decide", "direct", "narrate", "check", "polish", "record"] as const satisfies Phase[]
export const Routing = Schema.Struct({
  default: Schema.optionalKey(Pair),
  stages: Schema.optionalKey(Schema.Struct(Object.fromEntries(phases.map((p) => [p, Schema.optionalKey(Pair)])))),
})
export type Routing = { default?: typeof Pair.Type; stages?: Partial<Record<Phase, typeof Pair.Type>> }

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
  model?: SessionModels
  pinned?: boolean
}) => {
  const routing = (): Routing => (data.routing.read() as Routing | undefined) ?? {}
  const providerOf = (id: string): Provider => {
    const p = data.providers.list().find((x) => x.id === id)
    if (!p) throw new Error(`no provider ${id}`)
    return p
  }
  const secretOf = (p: Provider) => data.secrets.list().find((s) => s.id === p.secret)
  /** A pair as the session runs it: dev.ts's `live()` over the flattened connection. */
  const resolve = (pair: typeof Pair.Type): SessionModel => {
    const p = providerOf(pair.provider)
    const m = p.models.find((x) => x.id === pair.model)
    if (!m) throw new Error(`provider "${p.name}": no model ${pair.model}`)
    const c = connection(p, m, secretOf(p))
    const caps = capabilities(c)
    return {
      format: c.format,
      model: compile(c),
      prefill: caps.prefill,
      reasoningBack: caps.reasoningBack,
      effort: m.effort,
      maxOutputTokens: m.maxOutputTokens,
      ttl: c.cacheTtl,
      hat: c.hat,
    }
  }
  const model = (phase: Phase): SessionModel => {
    const r = pinned ? {} : routing()
    const pair = r.stages?.[phase] ?? r.default
    if (pair) return resolve(pair)
    if (!env) throw new Error("no model: pick a default model in settings")
    return typeof env === "function" ? env(phase) : "default" in env ? (env[phase] ?? env.default) : env
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
  const exists = (id: Id) => data.stories.list(card.id).some((s) => s.id === id)
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
      /** A row names its story by the player's last line (the head's), or the head's first words; empty, "". */
      list: () =>
        data.stories.list(card.id).map(({ head, ...s }) => {
          const t = head as Turn | null
          const said = t?.input.text || t?.input.note
          const told = t?.reply.find((p) => p.type === "text")
          return { ...s, last: said || (told ? told.text.trimStart().split("\n")[0]! : "") }
        }),
      create: (): Id => data.stories.create(card.id),
      del: (id: Id) => {
        if (!exists(id)) throw new Error(`no story ${id}`)
        data.stories.del(id)
        sessions.delete(id)
      },
    },
    hats: data.hats,
    /** The vault as the wire lists it: never a value (that is `value`, one key on request). A provider naming a deleted secret has no key. */
    secrets: {
      list: () => data.secrets.list().map(secretView),
      add: (s: Omit<Secret, "id">) => {
        const made = { id: crypto.randomUUID(), ...s }
        data.secrets.put(made)
        return secretView(made)
      },
      /** A name or type changed, and the value when one is given (a retyped key); the hint follows it. */
      set: (id: string, s: Pick<Secret, "name" | "type"> & { value?: string }) => {
        const old = data.secrets.list().find((x) => x.id === id)
        if (!old) throw new Error(`no secret ${id}`)
        data.secrets.put({ ...old, ...s })
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
      /** The provider's model list, over its default format's endpoint. */
      models: (id: string) => listModels(probe(id, { id: "" })),
      /** One minimal request: with a model a one-token answer, without one the model listing. The trace is the fetch's
       *  (the last one, when ai-sdk retried); an error carries the trace when the request got that far. */
      test: async (id: string, model?: string): Promise<{ trace?: Trace; error?: string }> => {
        let trace: Trace | undefined
        const onTrace = (t: Trace) => void (trace = t)
        try {
          if (model === undefined) await listModels(probe(id, { id: "" }), { onTrace })
          else {
            const c = probe(id, providerOf(id).models.find((m) => m.id === model) ?? { id: model })
            const m = { format: c.format, model: compile(c, { onTrace }), prefill: capabilities(c).prefill }
            const failed = await Effect.runPromise(
              text(m, [{ role: "user", content: "Hi" }], { maxOutputTokens: 1 }).pipe(
                Effect.match({ onFailure: (e) => e.message, onSuccess: () => undefined }),
              ),
            )
            if (failed !== undefined) return { trace, error: failed }
          }
        } catch (e) {
          return { trace, error: e instanceof Error ? e.message : String(e) }
        }
        return { trace }
      },
    },
    routing: { read: routing, write: data.routing.write },
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
