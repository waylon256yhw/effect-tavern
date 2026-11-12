// The library behind the wire: every card's stories and the player's personas. A story is a session over its rows in
// data.ts on the card its row names (`story.card`, resolved through `cards` when the session opens), with the player's
// rows the library stores (runtime layer.ts; the overlay given stands until one is stored), and the turn in flight beside it (turn.ts): a
// turn is the story's, it runs to its end whoever listens, one at a time per story and with no lock across stories.
// A persona is the player's, a sibling of the card, not a step of a story: a story's row names the one in force on it
// (`story.persona`, none: the card's own), and the library hands it to `resolve` on every
// request (the card's default overridden by the slot rules, nothing else in the card touched), so an edit of the
// persona is in force from the next request and a change of pick is one head rewrite, no new story. A pick on one story
// leaves the card's other stories alone. `local.persona` is the card's default: a new story starts on it, copied
// at creation. Deleting a persona drops it from every story and every card default (no silent fallback). The
// library holds no "open story": each request names its own (serve.ts reads `x-tavern-story`) and `session(id)` opens
// that story's session on first use and keeps it, so two clients on two stories never move each other. What every story shares is
// the install's: the player's rows, personas, hats, providers and routing. A hat is the player's too, named by a
// connection (`Model.hat`) and read from the table on every request the same way: an edit is in force from the
// next request, and a deleted hat leaves the connection bare (the id resolves to nothing). The player's rows the same way:
// read on every request (`rowsOf`), so a session holds none of them; deleting a pack takes it off every card it hung on.
// The model each stage runs on is the routing row's (provider, model) pair, the stage's own or the default, resolved
// from the tables on every call the same way: a routing or provider edit is in force from the next request. A pair
// that does not resolve (provider gone, disabled, no key, no endpoint) fails that request naming the provider. A stage
// the row does not name runs on `model`, the environment's (dev.ts); `pinned` puts it over the row (MODEL=fake).
import type { CardView, CardRow, StoryRow } from "@effect-tavern/runtime/src/library.ts"
export type { CardRow } from "@effect-tavern/runtime/src/library.ts"
export { Routing } from "@effect-tavern/runtime/src/session.ts"
import {
  bind,
  compileDecision,
  connection,
  decisionUrl,
  probeDecision,
  type CompileOptions,
  type DecisionConfig,
  type DecisionModel,
  listModels,
  plan,
  text,
  secretType,
  secretView,
  type Connection,
  type Format,
  type ListedModel,
  type Model,
  type ModelEntry,
  type Probe,
  type Provider,
  type Secret,
  type Trace,
} from "@effect-tavern/provider"
import { WorkshopLayout, type DraftView } from "@effect-tavern/runtime/src/workshop.ts"
import { author } from "./author.ts"
import { validateCard } from "@effect-tavern/runtime/src/author.ts"
import { decodeCard, type Card } from "@effect-tavern/runtime/src/card.ts"
import {
  decodeLayer,
  decodeLocal,
  empty,
  overlaid,
  overlayOf,
  type Layer,
  type Local,
  type Rows,
} from "@effect-tavern/runtime/src/layer.ts"
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import { policyFor } from "@effect-tavern/runtime/src/history.ts"
import {
  Routing,
  cardView,
  facets,
  makeSession,
  type Phase,
  type Pair,
  type Session,
  type Turn as Logged,
} from "@effect-tavern/runtime/src/session.ts"
import { Cause, Effect, Stream, Schema } from "effect"
import type { TimelineEvent } from "@effect-tavern/runtime/src/projection.ts"
import type { Data } from "./data.ts"
import type { Exported } from "./export.ts"
import { names } from "./names.ts"
import { Busy, makeTurn, type Call, type Out, type Turn } from "./turn.ts"

export type PublicEvent = TimelineEvent | { kind: "error"; message: string; code?: string; phase: Phase }

/** The model test asks for this many output tokens: the least a gateway accepts (CommandCode refuses `max_tokens` under
 *  16), still a fraction of a cent on any model. */
const PROBE_TOKENS = 16
/** No pair for the stage and no environment model. Its `code` rides the stream's `error` event (serve.ts), so the client
 *  offers its way into Settings → 默认模型 without reading the message. */
export class NoModel extends Error {
  readonly code = "no-model"
  constructor() {
    super("no model: pick a default model in settings")
  }
}

/** A card as the shelf lists it: id and title, its one-line summary and its facets (session.ts `facets`), what the
 *  client's shelf shows and filters by: a card file's read off the decoded card, a table card's stored when it was
 *  written (data.ts `cards.put`; a row from before has neither). */

/** Where cards come from (tavern.ts `shelf`: a directory of YAML and the library's table): every one as a row, and
 *  one whole by id (throws when there is none). */
export interface Cards {
  list(): CardRow[]
  get(id: string): Card
}

/** The rows of the `pack` table that are ranks, not packs. */
const RESERVED = ["harness"]
const decodeDraftUpdate = Schema.decodeUnknownSync(
  Schema.Struct({
    card: Schema.optionalKey(Schema.Unknown),
    layout: Schema.optionalKey(WorkshopLayout),
  }),
)

export const library = ({
  data,
  cards: source,
  overlay: given,
  model: env,
  pinned = false,
}: {
  data: Data
  cards: Cards
  overlay?: Layer // the harness overlay until one is stored
  model?: (phase: Phase) => Model
  pinned?: boolean
}) => {
  // Installed cards override templates, including when the caller supplies a file-only shelf.
  const cards: Cards = {
    list: () => [...new Map([...source.list(), ...data.cards.list()].map((c) => [c.id, c])).values()],
    get: (id) => {
      const raw = data.cards.get(id)
      return raw === undefined ? source.get(id) : decodeCard({ ...(raw as object), id })
    },
  }
  const routing = (): Routing => (data.routing.read() as Routing | undefined) ?? {}
  const providerOf = (id: string): Provider => {
    const p = data.providers.list().find((x) => x.id === id)
    if (!p) throw new Error(`no provider ${id}`)
    return p
  }
  const secretOf = (p: Provider) => data.secrets.list().find((s) => s.id === p.secret)
  const decision = (): DecisionConfig | undefined => data.decision.read() as DecisionConfig | undefined
  const decisionKey = (c: DecisionConfig) => data.secrets.list().find((s) => s.id === c.secret)
  /** A pair as the session runs it: the flattened connection, bound. */
  const resolve = (pair: Pair): Model => {
    const p = providerOf(pair.provider)
    const m = p.models.find((x) => x.id === pair.model)
    if (!m) throw new Error(`provider "${p.name}": no model ${pair.model}`)
    return bind(connection(p, m, secretOf(p)))
  }
  const model = (phase: Phase | "author"): Model => {
    const r = pinned ? {} : routing()
    const pair = r.stages?.[phase] ?? r.default
    if (pair) return resolve(pair)
    if (!env) throw new NoModel()
    return env(phase === "author" ? "record" : phase)
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
  const prune = (keep: (pair: Pair) => boolean) => {
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
  const personaOf = (pid: string | null | undefined) =>
    pid == null ? undefined : data.personas.list().find((x) => x.id === pid)
  const hat = (id: string) => data.hats.list().find((h) => h.id === id)
  const overlayIn = (rows: readonly Layer[]) => rows.find((p) => p.id === "harness") ?? given
  /** The player's rows on a card, as `resolve` takes them: read on every request, a session keeps none. */
  const rowsOf = (card: string, persona: Rows["persona"]): Rows => {
    const rows = data.packs.list()
    return {
      harness: overlayIn(rows),
      packs: rows.filter((p) => !RESERVED.includes(p.id)),
      local: data.locals.get(card),
      persona,
    }
  }
  const localOf = (card: string): Local => data.locals.get(card) ?? { id: "local", name: card, card }
  /** Every card's local row through `edit`; written only where it changed. */
  const pruneLocals = (edit: (l: Local) => Local) => {
    for (const l of data.locals.list()) {
      const next = edit(l)
      if (next !== l) data.locals.put(next)
    }
  }
  const sessions = new Map<Id, { session: Session; turn: Turn; stale?: boolean }>()
  const row = (id: Id) => data.stories.get(id)
  const exists = (id: Id) => row(id) !== undefined
  /** A story's session and its turn, opened on its first request on the story's card, the same ones after. */
  const open = (id: Id) => {
    const had = sessions.get(id)
    if (had && (!had.stale || had.turn.busy !== null || had.turn.pendingFailure)) return had
    if (had) sessions.delete(id)
    const r = row(id)
    if (!r) throw new Error(`no story ${id}`)
    const card = cards.get(r.card)
    const store = data.store<Logged>(id)
    const session = makeSession({
      card,
      rows: () => rowsOf(card.id, personaOf(row(id)?.persona)),
      model,
      store,
      hat,
      policy,
    })
    const opened = { session, turn: makeTurn(session, (node, calls) => data.calls(id).add(node, calls)) }
    sessions.set(id, opened)
    return opened
  }
  const session = (id: Id): Session => open(id).session
  // Capture the session which produced the stream, even when its card is replaced before consumption.
  const events = (s: Session, stream: Stream.Stream<Out>): Stream.Stream<PublicEvent> =>
    stream.pipe(
      Stream.filter((e) => e.kind !== "call"),
      Stream.map((e): PublicEvent => {
        if (e.kind === "error") {
          const error = Cause.squash(e.cause)
          return {
            kind: "error",
            phase: e.phase,
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof NoModel && { code: error.code }),
          }
        }
        if (e.kind !== "change") return e
        const { invalidated, node, ...change } = e
        return {
          ...change,
          ...(node && { node: s.projectTimeline(node) }),
          ...(invalidated?.length && { updated: invalidated.map((id) => s.timelineNode(id)) }),
        }
      }),
    )
  return {
    /** The model a stage runs on and the fold policy, as every session reads them on its next request. */
    model,
    author: author(() => model("author")),
    drafts: {
      get: (id: string): DraftView => {
        const saved = data.drafts.get(id)
        return {
          card: saved?.card ?? cards.get(id),
          draft: saved?.card !== undefined,
          ...(saved?.layout && { layout: saved.layout }),
        }
      },
      put: (id: string, value: unknown) => {
        const update = decodeDraftUpdate(value)
        if (update.card === undefined && update.layout === undefined) throw new Error("card or layout is required")
        const saved = data.drafts.get(id)
        const card = update.card === undefined ? saved?.card : decodeCard(update.card)
        if (card && card.id !== id) throw new Error("card id does not match URL")
        if (!card) cards.get(id) // Layout alone needs an installed card or an existing content draft.
        const layout = update.layout ?? saved?.layout
        data.drafts.put(id, { ...(card && { card }), ...(layout && { layout }) })
      },
      del: data.drafts.del,
    },
    policy,
    session,
    /** A story's turn in flight (turn.ts), beside its session. */
    turn: (id: Id): Turn => open(id).turn,
    submit: (id: Id, action: unknown) => {
      const { session, turn } = open(id)
      return events(session, turn.start(action))
    },
    attach: (id: Id) => {
      const had = sessions.get(id)
      const { session, turn } = had ?? open(id)
      const at = turn.attach()
      if (had?.stale && had.turn.busy === null) sessions.delete(id)
      return at && { ...at, events: events(session, at.events) }
    },
    stop: (id: Id) => open(id).turn.stop(),
    drop: (id: Id, node: Id) => open(id).turn.drop(node),
    trace: (id: Id, node: Id, inspect = false) => {
      if (!session(id).log.nodes.has(node)) throw new Error(`no node ${node}`)
      return data
        .calls(id)
        .get(node)
        .map((v) => {
          const c = v as Call
          return inspect ? c : { ...c, msgs: [], out: undefined }
        })
    },
    exists,
    /** The card a story is of. */
    cardOf: (id: Id): string | undefined => row(id)?.card,
    /** The player on a card, whole; written whole, in force from the next request. Never a missing row to the wire. */
    locals: {
      read: localOf,
      write: (value: unknown) => {
        const l = decodeLocal(value)
        cards.get(l.card)
        data.locals.put(l)
      },
    },
    calls: (id: Id) => data.calls(id),
    stories: {
      /** A row: its card, the player's title or none (the client prints "New story"), the star, the turns and the last
       *  one's input, the time, and `busy`: the phase of a turn in flight, or null. A card's stories all open on the
       *  same greeting, so no line of the text tells them apart: a name the player gave does, and the last line they
       *  wrote recalls where the story stands. Every card's when `card` is absent. */
      list: (card?: string): StoryRow[] =>
        data.stories.list(card).map((s) => ({ ...s, busy: sessions.get(s.id)?.turn.busy ?? null })),
      /** Named by the player, or the name cleared (empty or blank): null, the state "never named". */
      title: (id: Id, title: string | null) => data.stories.title(id, title?.trim() || null),
      /** Starred: the left card and the manager put it first. */
      star: (id: Id, starred: boolean) => data.stories.star(id, starred),
      /** On this story alone (none: the card's own persona), in force from its next request. */
      persona: (id: Id, persona: string | null) => data.stories.persona(id, persona),
      /** A new, empty story of `card`, on the card's default persona; throws when there is no such card. */
      create: (card: string): Id => {
        const id = cards.get(card).id
        return data.stories.create(id, data.locals.get(id)?.persona ?? null)
      },
      /** Refused (throws) while a turn runs on the story: its writes would land on nothing. */
      del: (id: Id) => {
        if (!exists(id)) throw new Error(`no story ${id}`)
        if (sessions.get(id)?.turn.busy) throw new Busy()
        data.stories.del(id)
        sessions.delete(id)
      },
      /** The batch cleanup: the card's own among `ids` go (any card's when it is absent), in one transaction, their
       *  sessions with them; another card's, a stranger's or a busy one's id is left alone. */
      delMany: (ids: readonly Id[], card?: string) => {
        const idle = ids.filter((id) => !sessions.get(id)?.turn.busy)
        for (const id of data.stories.delMany(card, idle)) sessions.delete(id)
      },
      /** The stories (a card's, or every card's) that hold `q` on their head's line (data.ts `Hit`). The title is the
       *  client's to match. */
      search: (q: string, card?: string) => data.stories.search(card, q),
      /** One story whole for export.ts: its row, the card it is of (and its products, to name the 小剧场), and its log
       *  tree; none when there is no story. A card gone from the shelf exports the prose alone. */
      export: (id: Id): Exported | undefined => {
        const story = data.stories.list(undefined, id)[0]
        if (!story) return undefined
        const found = cards.list().find((c) => c.id === story.card)
        return {
          card: found ?? { id: story.card, title: story.card },
          story,
          snapshot: data.store<Logged>(id).read()!,
          products: found ? cardView(cards.get(story.card), rowsOf(story.card, undefined)).layer.products : [],
        }
      },
    },
    /** What a client draws a card by (session.ts `cardView`, the meta at the top) under the player's rows and the story's
     *  persona, with no story the card's default: the local row as it stands, the mounted packs by name, and the one
     *  merge. A client merges nothing. Throws on no card. */
    view: (card: string, story?: Id): CardView => {
      const c = cards.get(card)
      const local = localOf(card)
      const picked = personaOf(story === undefined ? local.persona : row(story)?.persona)
      const rows = rowsOf(card, picked)
      const { meta, ...rest } = cardView(c, rows)
      const mounts = [...new Set(local.mounts)].flatMap((id) => {
        const p = rows.packs!.find((x) => x.id === id)
        return p ? [{ id: p.id, name: p.name }] : []
      })
      return { ...meta, ...rest, local, mounts }
    },
    hats: data.hats,
    packs: {
      /** `[harness, ...packs]`, one row template: the harness row whole, the code's defaults under its overlay. */
      list: (): Layer[] => {
        const rows = data.packs.list()
        return [overlaid("act", overlayIn(rows)), ...rows.filter((p) => !RESERVED.includes(p.id))]
      },
      /** The harness keeps only what differs from the code's defaults, nothing at all when nothing does: a left-out item is
       *  its default again. A pack's id may not be a rank's name: `from` says which row an item came from; nor `base`, which
       *  `open` folds into the overlay (data.ts). */
      put: (value: unknown) => {
        const r = decodeLayer(value)
        if (r.id === "harness") {
          const o = overlayOf("act", r)
          if (empty(o)) data.packs.del("harness")
          else data.packs.put(o)
          return
        }
        if (r.id === "card" || r.id === "local" || r.id === "base") throw new Error(`${r.id}: a reserved id`)
        if (r.id.includes("/")) throw new Error(`${r.id}: a pack id has no / (it prefixes the pack's entry ids)`)
        data.packs.put(r)
      },
      /** Gone from the table, and off every card it was mounted on. The harness is not a row to delete. */
      del: (id: string) => {
        if (id === "harness") throw new Error(`${id}: cannot be deleted`)
        data.packs.del(id)
        pruneLocals((l) => {
          if (!l.mounts?.includes(id)) return l
          const { mounts, ...rest } = l
          const kept = mounts.filter((x) => x !== id)
          return kept.length ? { ...rest, mounts: kept } : rest
        })
      },
    },
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
      models: async (id: string): Promise<ListedModel[]> => {
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
            await probed([c.format], plan(c.format, c.endpoint, c.model).generate, async (onTrace) => {
              const failed = await Effect.runPromise(
                text(bind(c, { onTrace }), [{ role: "user", content: "Hi" }], { maxOutputTokens: PROBE_TOKENS }).pipe(
                  Effect.match({ onFailure: (e) => e, onSuccess: () => undefined }),
                ),
              )
              if (failed) throw failed
            }),
          ]
        }
        return Promise.all(listings(id).map((g) => probed(g.formats, g.url, (onTrace) => listModels(g.c, { onTrace }))))
      },
    },
    routing: { read: routing, write: data.routing.write },
    /** The decision model's connection (provider decision.ts): its own row, not a provider and not a routing pair. */
    decision: {
      read: decision,
      write: (c: DecisionConfig) => data.decision.write(c),
      /** The model, when it is switched on and has what it needs; what is missing throws, naming it. */
      model: (o?: CompileOptions): DecisionModel => {
        const c = decision()
        if (!c?.enabled) throw new Error("decision model: not enabled")
        return compileDecision(c, decisionKey(c), o)
      },
      /** One minimal real request (a yes/no question about one word) as a Probe, enabled or not; a 400's worth of
       *  configuration (nothing saved, no key, no model) throws instead. */
      test: async (): Promise<Probe> => {
        const c = decision()
        if (!c) throw new Error("decision model: not configured")
        let trace: (t: Trace) => void = () => {}
        const model = compileDecision(c, decisionKey(c), { onTrace: (t) => trace(t) })
        return probed([], decisionUrl(c), async (onTrace) => {
          trace = onTrace
          const failed = await Effect.runPromise(
            probeDecision(model).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })),
          )
          if (failed) throw failed
        })
      },
    },
    /** The model-name table in force (names.ts). */
    names: () => names(data),
    /** Every card the install knows, by id and title (`Cards`). */
    cards: {
      list: () => cards.list(),
      put: (value: unknown) => {
        const { card, diagnostics } = validateCard(value)
        const errors = diagnostics.filter((d) => d.level === "error")
        if (!card || errors.length)
          throw new Error(errors.map((d) => `${d.level} ${d.rule} ${d.path}: ${d.message}`).join("\n"))
        const flags = facets(card)
        data.cards.put(card, flags)
        data.drafts.del(card.id)
        for (const [id, cached] of sessions) {
          if (row(id)?.card !== card.id) continue
          if (cached.turn.busy !== null || cached.turn.pendingFailure) cached.stale = true
          else sessions.delete(id)
        }
      },
    },
    personas: {
      ...data.personas,
      /** Gone from the table, and from every story and card default it was picked on: the card's own persona is back in
       *  force there. */
      del: (id: string) => {
        data.personas.del(id)
        data.stories.dropPersona(id)
        pruneLocals((l) => {
          if (l.persona !== id) return l
          const { persona: _, ...rest } = l
          return rest
        })
      },
    },
  }
}
export type Library = ReturnType<typeof library>
