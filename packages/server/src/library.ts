// The library behind the wire: one card's stories and the player's personas, one story open. A story is a session over
// its rows in data.ts, with the player layer the library stores (it wins over the harness default given). A persona is
// the player's, a sibling of the card, not a step of a story: `Player.persona[card]` names the one in force, and the
// library reads its text into the per-card persona slot on every request (the card's default overridden by the slot
// rules, nothing else in the card touched), so an edit of the persona is in force from the next request and a change of
// pick is one head rewrite, no new story. Deleting a persona drops the pick (no silent fallback). Opening another story
// is another session; the wire
// adapter asks `session` on every request, so a switch is in force at once. Deleting the open story opens the newest
// remaining one, or a new one when none is left: there is always a story open. A hat is the player's too, named by a
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
  player,
  model: env,
  pinned = false,
}: {
  data: Data
  card: Card
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
  const open = (id: Id): Session => {
    if (!data.stories.list(card.id).some((s) => s.id === id)) throw new Error(`no story ${id}`)
    return makeSession({ card, player, model, store: data.store<Turn>(id), players, persona, hat })
  }
  let current = data.stories.list(card.id)[0]?.id ?? data.stories.create(card.id)
  let session = open(current)
  const to = (id: Id) => {
    session = open(id)
    current = id
  }
  return {
    get session() {
      return session
    },
    get story() {
      return current
    },
    get calls() {
      return data.calls(current)
    },
    stories: {
      /** A row names its story by the player's last line (the head's), or the head's first words; empty, "". */
      list: () =>
        data.stories.list(card.id).map(({ head, ...s }) => {
          const t = head as Turn | null
          const said = t?.input.text || t?.input.note
          const told = t?.reply.find((p) => p.type === "text")
          return { ...s, last: said || (told ? told.text.trimStart().split("\n")[0]! : "") }
        }),
      open: to,
      create: () => to(data.stories.create(card.id)),
      del: (id: Id) => {
        data.stories.del(id)
        if (id === current) to(data.stories.list(card.id)[0]?.id ?? data.stories.create(card.id))
      },
    },
    hats: data.hats,
    /** The vault as the wire shows it: never a value. A provider naming a deleted secret has no key. */
    secrets: {
      list: () => data.secrets.list().map(secretView),
      add: (s: Omit<Secret, "id">) => {
        const made = { id: crypto.randomUUID(), ...s }
        data.secrets.put(made)
        return secretView(made)
      },
      /** A name or type changed; the value stays. */
      set: (id: string, s: Pick<Secret, "name" | "type">) => {
        const old = data.secrets.list().find((x) => x.id === id)
        if (!old) throw new Error(`no secret ${id}`)
        data.secrets.put({ ...old, ...s })
      },
      del: data.secrets.del,
    },
    providers: {
      list: data.providers.list,
      put: data.providers.put,
      /** Gone, and from the routing: a stage that ran on it follows the default again, or the environment's model. */
      del: (id: string) => {
        data.providers.del(id)
        const r = routing()
        const keep = (pair: typeof Pair.Type | undefined) => (pair?.provider === id ? undefined : pair)
        const stages = Object.fromEntries(Object.entries(r.stages ?? {}).filter(([, v]) => keep(v)))
        data.routing.write({
          ...(keep(r.default) && { default: r.default }),
          ...(Object.keys(stages).length && { stages }),
        })
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
    personas: {
      ...data.personas,
      /** Gone from the table, and from every card it was picked on: the card's own persona is back in force there. */
      del: (id: string) => {
        data.personas.del(id)
        const p = session.player
        if (p.persona && Object.values(p.persona).includes(id)) {
          const rest = Object.fromEntries(Object.entries(p.persona).filter(([, v]) => v !== id))
          session.setPlayer({ ...p, persona: Object.keys(rest).length ? rest : undefined }) // an empty map leaves the JSON like any unset key
        }
      },
    },
  }
}
export type Library = ReturnType<typeof library>
