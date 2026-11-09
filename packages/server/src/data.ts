// The install's library: one SQLite file through `node:sqlite` (built into Bun and Node, no dependency), used as a
// document store: a row is an id and a JSON column, nothing is ever joined. The tables mirror the types. `pack`: the
// player's rows (runtime layer.ts `Layer`): `harness` (the overlay, only what differs from the code's defaults) and each
// writing pack, mounted per card by `local.mounts`. `local`: one row a card, the player on that card (`Local`).
// `persona`: named frame fragments, the player's own (who they are in the fiction; a card still gives a
// default in its frame; a story names the one in force on it, `story.persona`). `hat`: the player's hats (runtime fragment.ts `Hat`), named by a provider's model. `secret`:
// the key vault (provider providers.ts `Secret`), the only table holding key material; `provider`: the player's model
// providers, each naming a secret by id; `routing`: one row, which (provider, model) each stage runs on; `names`: one row,
// the model-name table last fetched from models.dev and its ETag (names.ts). Export of cards
// and stories never reads the three. `card`: a Card as the workshop will write it (the YAML templates are a directory beside
// it, server tavern.ts `shelf`); what the json holds is decoded by the caller.
// `story`: one log tree of a card, with the log's head and next beside it so an id never comes back after a drop. `node`: a
// Turn per row, appended by the store's write. `call`: a node's `call` events (the Inspector's trace), appended when the
// node lands or is amended, gone with the node, and kept for a story's last `traced` nodes only. The runtime never sees SQL: `store(story)` is log.ts's Store, whose
// write is one Change in one transaction. Cards and personas travel as JSON files; the library is the install's own.
// A library file has one process: `open` locks it; a second process fails unless isolateOnBusy is explicit.
// Only what has a caller is here: the rest of the tables get their reads and writes with the endpoint that needs them.
// A column added after a library was made (`story.starred`, `story.persona`) is added to it on open (`migrate`): the schema's create is
// for a fresh file. The `player` table of a library from before layer.ts goes once, on open (`fromPlayer`), and so does a `base` row (`foldIn`). The stories' search (`stories.search`) walks each story's line and reads the player's lines and
// the prose with `instr`, enough for a phone's stories. A story listing, search or batch delete takes a card as an optional
// filter: absent, every card's. Ceilings: an FTS5 index over nodes once a
// library holds hundreds of long stories; sync between two installs (the Android copy is a copy of this file).
import type { Names } from "@effect-tavern/provider/src/names.ts"
import type { Provider, Secret } from "@effect-tavern/provider/src/providers.ts"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { locked, type Layer, type Local } from "@effect-tavern/runtime/src/layer.ts"
import type { ProductPatch } from "@effect-tavern/runtime/src/product.ts"
import type { Change, Id, Log, Noded, Snapshot, Store } from "@effect-tavern/runtime/src/log.ts"
import type { Facets } from "@effect-tavern/runtime/src/session.ts"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"

const schema = `
create table if not exists persona (id text primary key, name text not null, json text not null);
create table if not exists hat (id text primary key, name text not null, json text not null);
create table if not exists pack (id text primary key, name text not null, json text not null);
create table if not exists local (card text primary key, json text not null);
create table if not exists secret (id text primary key, name text not null, json text not null);
create table if not exists provider (id text primary key, name text not null, json text not null);
create table if not exists routing (id integer primary key check (id = 1), json text not null);
create table if not exists names (id integer primary key check (id = 1), etag text, json text not null);
create table if not exists draft (id text primary key, json text not null);
create table if not exists card (id text primary key, title text not null, json text not null, updated integer not null, summary text, facets text);
create table if not exists story (id integer primary key autoincrement, card text not null, title text, head integer, next integer not null default 0, updated integer not null, starred integer not null default 0, persona text);
create table if not exists node (story integer not null references story (id) on delete cascade, id integer not null,
  parent integer, json text not null, primary key (story, id));
create table if not exists call (seq integer primary key autoincrement, story integer not null, node integer not null,
  json text not null, foreign key (story, node) references node (story, id) on delete cascade);
create index if not exists call_node on call (story, node);
`
/** How many nodes of a story keep their calls: the Inspector's trace is for recent turns, and a call holds the whole
 *  request (the wire strips it for a player client, serve.ts `shown`), so an unbounded trace would grow the library by a fold budget per turn. */
export const traced = 200
/** Columns added to a table after libraries were made with it, each applied on open when the table lacks it. */
const migrations: readonly { table: string; column: string; add: string }[] = [
  { table: "story", column: "starred", add: "alter table story add column starred integer not null default 0" },
  // the card's pick (the old player row's `persona[card]`) as it stood copied in, so a running story keeps its persona on
  // upgrade; the fresh schema has no `player` table, so a file that never had one gets an empty one here, and `open` drops it
  {
    table: "story",
    column: "persona",
    add: `create table if not exists player (id integer primary key check (id = 1), json text not null);
      alter table story add column persona text;
      update story set persona = (select p.value from player, json_each(player.json, '$.persona') p where p.key = story.card);`,
  },
  { table: "card", column: "summary", add: "alter table card add column summary text" },
  { table: "card", column: "facets", add: "alter table card add column facets text" },
]
type Row = Record<string, unknown>
const set = <V>(k: string, v: V | undefined) => (v === undefined || (Array.isArray(v) && !v.length) ? {} : { [k]: v })
/** The shape of the `player` row before layer.ts, as far as the one-shot below reads it. */
interface OldPlayer {
  writing?: Record<string, unknown> & { lexicon?: unknown[] }
  global?: { mode?: string }[]
  forCard?: Record<string, { mode?: string }[]>
  persona?: Record<string, string>
  packs?: Record<string, string[]>
  names?: Record<string, Record<string, string>>
  tags?: Record<string, string[]>
  defaults?: { global?: string; forCard?: string }
  asks?: { id: string; text?: string }[]
  products?: Record<string, boolean>
  theaters?: { id: string }[]
  snippets?: unknown[]
  format?: unknown[]
}
/** The old row as the new rows. Global → the harness overlay, per-card maps → a local row per card. What a default mode
 *  said is written on the fragment. The product toggles go on the overlay and on each local row: a toggle was the last
 *  word over a pack's 小剧场, and only a rank above the packs still is. */
const fromPlayer = (p: OldPlayer): { overlay: Layer; locals: Local[] } => {
  const { lexicon, ...switches } = p.writing ?? {}
  const toggles = Object.entries(p.products ?? {}).map(([id, on]) => ({ id, on }))
  const moded = (fs: readonly { mode?: string }[] | undefined, mode: string | undefined) =>
    fs?.map((f) => ({ ...f, ...((f.mode ?? mode) && { mode: f.mode ?? mode }) }))
  const overlay = locked({
    id: "harness",
    name: "内置",
    ...set("fragments", moded(p.global, p.defaults?.global ?? "yield")),
    ...(Object.keys(switches).length && { switches }),
    ...set(
      "asks",
      p.asks?.flatMap((a) => (a.text === undefined ? [] : [{ id: a.id, text: a.text }])),
    ),
    ...set("products", [...(p.theaters ?? []), ...toggles]),
    ...set("lexicon", lexicon),
    ...set("snippets", p.snippets),
    ...set("format", p.format),
  } as Layer)
  const cards = new Set([p.forCard, p.persona, p.packs, p.names, p.tags].flatMap((m) => Object.keys(m ?? {})))
  const locals = [...cards].map((card) =>
    locked({
      id: "local",
      name: card,
      card,
      ...set("fragments", moded(p.forCard?.[card], p.defaults?.forCard)),
      ...set("products", toggles),
      ...set("names", p.names?.[card]),
      ...set("mounts", p.packs?.[card]),
      ...set("persona", p.persona?.[card]),
      ...set("tags", p.tags?.[card]),
    } as Local),
  )
  return { overlay, locals }
}
/** A row folded into the overlay: each list the overlay's first, the row's copy standing on a shared key (it was the higher
 *  rank), a product patch merged field by field; the lexicon has no key, so every entry stands. */
const foldIn = (o: Partial<Layer>, r: Partial<Layer>): Partial<Layer> => {
  const list = <T>(a: readonly T[] = [], b: readonly T[] = [], key: (x: T) => unknown) => [
    ...new Map([...a, ...b].map((x) => [key(x), x])).values(),
  ]
  const products = new Map<string, ProductPatch>()
  for (const p of [...(o.products ?? []), ...(r.products ?? [])]) products.set(p.id, { ...products.get(p.id), ...p })
  const switches = { ...o.switches, ...r.switches }
  const names = { ...o.names, ...r.names }
  return {
    ...set(
      "fragments",
      list(o.fragments, r.fragments, (x) => x.id),
    ),
    ...(Object.keys(switches).length && { switches }),
    ...set(
      "asks",
      list(o.asks, r.asks, (x) => x.id),
    ),
    ...set("products", [...products.values()]),
    ...set(
      "entries",
      list(o.entries, r.entries, (x) => x.id),
    ),
    ...set(
      "lexicon",
      list(o.lexicon, r.lexicon, (x) => x),
    ),
    ...set(
      "snippets",
      list(o.snippets, r.snippets, (x) => x.name),
    ),
    ...set(
      "format",
      list(o.format, r.format, (x) => x.label),
    ),
    ...(Object.keys(names).length && { names }),
  }
}
const parse = <T>(r: Row | undefined): T | undefined => (r ? (JSON.parse(r["json"] as string) as T) : undefined)
/** A node's reply parts of a type that no longer exists (the `aside` part before #76 §二) dropped on read; no migration. */
const known = <T>(n: T): T => {
  const reply = (n as { reply?: { type: string }[] }).reply
  return reply ? { ...n, reply: reply.filter((p) => p.type === "text" || p.type === "reasoning") } : n
}
/** A player's input as the node keeps it: the line, and a note to the narrator when one went with it. */
export interface Input {
  text: string
  note?: string
}
/** One story's row for the client: the player's name for it or none, whether it is starred, its persona (an id, or
 *  none: the card's own), the turns on the head's
 *  line and the input of the last of them (what the manager previews), the time. */
export interface StoryRow {
  id: Id
  card: string
  title: string | null
  starred: boolean
  persona: string | null
  updated: number
  turns: number
  last: Input | null
}
/** A search hit on a story: the earliest turn on the head's line whose player line, note or prose holds the query
 *  (`turn` 0 is the greeting's prose), a snippet of that field around the first match, and how many nodes hit. */
export interface Hit {
  id: Id
  turn: number
  kind: "input" | "note" | "reply"
  text: string
  count: number
}
/** ASCII case folded, exactly what SQLite's lower() does: the query and the text fold the same way on both sides,
 *  and a fold never changes a string's length (JS's toLowerCase can: İ becomes two code units), so an index found
 *  in the folded text is an index in the text. */
export const fold = (s: string): string => s.replace(/[A-Z]+/g, (m) => m.toLowerCase())
/** A window of `text` around the first `q` (both folded), with ellipses where cut. */
const snippet = (text: string, q: string, before = 30, after = 90): string => {
  const i = fold(text).indexOf(q)
  if (i < 0) return text.slice(0, before + after)
  const start = Math.max(0, i - before)
  const end = Math.min(text.length, i + q.length + after)
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
}

/** A named frame fragment of the player's: who they are in the fiction, picked per card on the player row. */
export interface Persona {
  id: string
  name: string
  text: string
}

/** A live process (EPERM: alive, another user's); a dead one, or a lock file that names none, is not. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}
/** One process per library: `<file>.lock` holds the owner's pid. A dead owner's lock is taken over (and our own, when
 *  Vite re-evaluates the module in the same process); while the owner lives, opening fails. Explicit isolateOnBusy opts into a fresh library
 *  at `<dir>/<pid>/<name>` for automated work; it never opens the owner's stories. */
const lock = (file: string, isolateOnBusy: boolean): string => {
  const path = `${file}.lock`
  for (;;) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" })
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
    }
    const pid = Number(readFileSync(path, "utf8"))
    if (pid === process.pid) return file
    if (alive(pid)) {
      if (!isolateOnBusy)
        throw new Error(
          `${file} is open in process ${pid}; use --url to connect to that server or a separate DATA directory`,
        )
      const own = join(dirname(file), String(process.pid), basename(file))
      console.error(`${file} is open in process ${pid}: this one opens its own library, ${own}`)
      mkdirSync(dirname(own), { recursive: true })
      return lock(own, false)
    }
    rmSync(path, { force: true })
  }
  const release = () => {
    try {
      if (readFileSync(path, "utf8") === String(process.pid)) rmSync(path)
    } catch {}
  }
  process.on("exit", release)
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.once(sig, () => {
      release()
      if (!process.listenerCount(sig)) process.kill(process.pid, sig) // nobody else handles it: die of it as before
    })
  return file
}

export const open = (asked: string, { isolateOnBusy = false } = {}) => {
  const file = asked === ":memory:" ? asked : lock(asked, isolateOnBusy)
  const db = new DatabaseSync(file)
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on;")
  db.exec(schema)
  for (const m of migrations) {
    const has = (db.prepare(`select name from pragma_table_info(?)`).all(m.table) as Row[]).some(
      (r) => r["name"] === m.column,
    )
    if (!has) db.exec(m.add)
  }
  // A story table made before ids were `autoincrement` (#26) hands a deleted story's id to the next one made: the
  // client then took the placeholder for the story it was on and kept its reader. Rebuilt once, rows and ids kept: a
  // copy under the current definition, the old table dropped with foreign keys off (on, the drop's implicit delete
  // would cascade into every node), the copy renamed. The explicit ids seed sqlite_sequence.
  const made = (db.prepare("select sql from sqlite_master where type = 'table' and name = 'story'").get() as Row)["sql"]
  if (!/autoincrement/i.test(String(made))) {
    db.exec("pragma foreign_keys = off")
    db.exec(`begin;
      create table story_new (id integer primary key autoincrement, card text not null, title text, head integer, next integer not null default 0, updated integer not null, starred integer not null default 0, persona text);
      insert into story_new (id, card, title, head, next, updated, starred, persona) select id, card, title, head, next, updated, starred, persona from story;
      drop table story;
      alter table story_new rename to story;
      commit;`)
    db.exec("pragma foreign_keys = on")
  }
  const q = (sql: string) => db.prepare(sql)
  const tx = <A>(f: () => A): A => {
    db.exec("begin")
    try {
      const a = f()
      db.exec("commit")
      return a
    } catch (e) {
      db.exec("rollback")
      throw e
    }
  }
  /** `r` over the stored overlay; no row when nothing is in it. */
  const intoOverlay = ({ id: _i, name: _n, ...r }: Partial<Layer>) => {
    const had = parse<Partial<Layer>>(q("select json from pack where id = 'harness'").get() as Row | undefined)
    const merged = foldIn(had ?? {}, r)
    if (Object.keys(merged).length)
      q("insert or replace into pack (id, name, json) values ('harness', '内置', ?)").run(JSON.stringify(merged))
  }
  // The player row of a library from before layer.ts, once, and the table with it. A pack row's `theaters` become its
  // product patches (`Pack` is a `Layer` now); an older `products` map, which turned nothing on, goes.
  if (q("select 1 from sqlite_master where type = 'table' and name = 'player'").get()) {
    const old = parse<OldPlayer>(q("select json from player where id = 1").get() as Row | undefined)
    tx(() => {
      for (const r of q("select id, json from pack").all() as Row[]) {
        const { theaters, products, ...rest } = parse<{ theaters?: unknown[]; products?: unknown }>(r)!
        const kept = [...(theaters ?? []), ...(Array.isArray(products) ? products : [])]
        q("update pack set json = ? where id = ?").run(
          JSON.stringify({ ...rest, ...(kept.length && { products: kept }) }),
          r["id"] as string,
        )
      }
      if (old) {
        const { overlay, locals } = fromPlayer(old)
        intoOverlay(overlay)
        for (const l of locals)
          q("insert or replace into local (card, json) values (?, ?)").run(l.card, JSON.stringify(l))
      }
      db.exec("drop table player")
    })
  }
  // The `base` row, a rank of its own until #69 §十, once, into the overlay. It stood above the card, where a fragment with
  // no mode overrode; the overlay's default yields, so what it said is written down.
  const base = parse<Partial<Layer>>(q("select json from pack where id = 'base'").get() as Row | undefined)
  if (base)
    tx(() => {
      intoOverlay({
        ...base,
        ...set(
          "fragments",
          base.fragments?.map((f) => ({ ...f, mode: f.mode ?? "override" })),
        ),
      })
      q("delete from pack where id = 'base'").run()
    })
  // Nodes written before Step 2/3 lack settlementStatus, changes, deliveries and opportunities: upgrade once on open.
  const legacyNodes = q(
    "select story, id, json from node where json_extract(json, '$.reply') is not null and json_extract(json, '$.settlementStatus') is null",
  ).all() as Row[]
  if (legacyNodes.length)
    tx(() => {
      for (const r of legacyNodes) {
        const n = parse<Record<string, unknown>>(r)!
        const changes: unknown[] = []
        const products: Record<string, unknown> = {}
        for (const [k, v] of Object.entries((n["products"] as Record<string, unknown> | undefined) ?? {})) {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            changes.push({ kind: "replace", product: k, value: v })
          } else if (Array.isArray(v) && k !== "notes" && k !== "options") {
            v.forEach((item, idx) => {
              if (item && typeof item === "object" && !("$delete" in item))
                changes.push({
                  kind: "insert_entity",
                  collection: k,
                  entityId: `e_${r["id"] as number}_${idx + 1}`,
                  data: item,
                })
            })
          } else {
            products[k] = v
          }
        }
        const migrated = {
          ...n,
          products,
          changes: n["changes"] ?? changes,
          settlementStatus: n["settlementStatus"] ?? "committed",
          settlementVersion: n["settlementVersion"] ?? 0,
          deliveries: n["deliveries"] ?? [],
          opportunities: n["opportunities"] ?? [],
        }
        q("update node set json = ? where story = ? and id = ?").run(
          JSON.stringify(migrated),
          r["story"] as number,
          r["id"] as number,
        )
      }
    })
  /** A table of named records: the json column holds the record without its id and name, the row's own columns. */
  const named = <T extends { id: string; name: string }>(table: string) => ({
    list: (): T[] =>
      (q(`select id, name, json from ${table} order by name`).all() as Row[]).map(
        (r) => ({ id: r["id"] as string, name: r["name"] as string, ...parse<object>(r)! }) as T,
      ),
    put: ({ id, name, ...rest }: T) =>
      void q(`insert or replace into ${table} (id, name, json) values (?, ?, ?)`).run(id, name, JSON.stringify(rest)),
    del: (id: string) => void q(`delete from ${table} where id = ?`).run(id),
  })
  return {
    /** The file open: the one asked for, or this process's own when another process holds that one. */
    file,
    /** The player on each card, a row a card, decoded at the wire (serve.ts). */
    locals: {
      get: (card: string): Local | undefined =>
        parse<Local>(q("select json from local where card = ?").get(card) as Row | undefined),
      list: (): Local[] => (q("select json from local").all() as Row[]).map((r) => parse<Local>(r)!),
      put: (l: Local) =>
        void q("insert or replace into local (card, json) values (?, ?)").run(l.card, JSON.stringify(l)),
    },
    personas: {
      list: (): Persona[] =>
        (q("select id, name, json from persona order by name").all() as Row[]).map((r) => ({
          id: r["id"] as string,
          name: r["name"] as string,
          text: parse<string>(r)!,
        })),
      put: (p: Persona) =>
        void q("insert or replace into persona (id, name, json) values (?, ?, ?)").run(
          p.id,
          p.name,
          JSON.stringify(p.text),
        ),
      del: (id: string) => void q("delete from persona where id = ?").run(id),
    },
    hats: named<Hat>("hat"),
    packs: named<Layer>("pack"),
    secrets: named<Secret>("secret"),
    providers: named<Provider>("provider"),
    /** Which (provider, model) runs each stage, one row; what it holds is decoded by the caller. */
    routing: {
      read: (): unknown => parse<unknown>(q("select json from routing where id = 1").get() as Row | undefined),
      write: (r: unknown) => void q("insert or replace into routing (id, json) values (1, ?)").run(JSON.stringify(r)),
    },
    /** The model-name table (names.ts) as last fetched, one row, with the ETag it came with. */
    names: {
      read: () => {
        const r = q("select etag, json from names where id = 1").get() as Row | undefined
        return r && { etag: r["etag"] as string | null, names: parse<Names>(r)! }
      },
      write: (t: { etag: string | null; names: Names }) =>
        void q("insert or replace into names (id, etag, json) values (1, ?, ?)").run(t.etag, JSON.stringify(t.names)),
    },
    drafts: {
      get: (id: string): Card | undefined =>
        parse<Card>(q("select json from draft where id = ?").get(id) as Row | undefined),
      put: (card: Card) =>
        void q("insert or replace into draft (id, json) values (?, ?)").run(card.id, JSON.stringify(card)),
      del: (id: string) => void q("delete from draft where id = ?").run(id),
    },
    cards: {
      /** The library's cards by id and title, with the summary and facets `put` stored beside the json (a row written
       *  before those columns has neither), the Card in the json column left unread. */
      list: (): { id: string; title: string; summary?: string; facets?: Facets }[] =>
        (q("select id, title, summary, facets from card order by title").all() as Row[]).map((r) => ({
          id: r["id"] as string,
          title: r["title"] as string,
          ...(r["summary"] ? { summary: r["summary"] as string } : {}),
          ...(r["facets"] ? { facets: JSON.parse(r["facets"] as string) as Facets } : {}),
        })),
      /** A card written whole, with its facets (session.ts `facets`, the caller's reading) as a projection beside the
       *  json, so the shelf's rows never decode a card. */
      put: ({ id, ...card }: Card, facets: Facets) =>
        void q("insert or replace into card (id, title, json, updated, summary, facets) values (?, ?, ?, ?, ?, ?)").run(
          id,
          card.title ?? id,
          JSON.stringify(card),
          Date.now(),
          card.summary ?? null,
          JSON.stringify(facets),
        ),
      /** One card's json column, parsed (decoded by the caller); none when the table has no such id. */
      get: (id: string): unknown => parse<unknown>(q("select json from card where id = ?").get(id) as Row | undefined),
    },
    /** Stories, a card's or every card's, newest first, each with its title (the player's, or none), its star, its turns and the
     *  last of them. The turns are on the head's line (head, its parent, up to the root): the nodes with a player
     *  input, a line or a note to the narrator (a note-only turn has `text: ""`). So a greeting is not a turn, a
     *  story with only its opening has none, and a swipe (a sibling carrying the same input) is still the one turn.
     *  The last turn is the line's input node with the greatest id (a child's id is greater than its parent's), and
     *  `last` is its input: what the manager previews, since every story of a card opens on the same greeting. Every
     *  line is walked once, each node read by its key and only its input extracted. */
    stories: {
      /** The row's own columns that a request needs (identity, card, persona): never a walk of the story's line. */
      get: (id: Id): { id: Id; card: string; persona: string | null } | undefined =>
        q("select id, card, persona from story where id = ?").get(id) as
          | { id: Id; card: string; persona: string | null }
          | undefined,
      /** The card's rows (every card's when `card` is absent), or the one of them `only` names (none when that is
       *  another card's or no story): the walk starts from that story's head alone, so one row costs one line. */
      list: (card?: string, only?: Id): StoryRow[] =>
        (
          q(
            `with recursive line(story, id, parent, text, note, invocations) as (
               select s.id, n.id, n.parent, json_extract(n.json, '$.input.text'), json_extract(n.json, '$.input.note'), json_array_length(json_extract(n.json, '$.input.invoke'))
                 from story s join node n on n.story = s.id and n.id = s.head
                 where (?1 is null or s.card = ?1) and (?2 is null or s.id = ?2)
               union all
               select l.story, n.id, n.parent, json_extract(n.json, '$.input.text'), json_extract(n.json, '$.input.note'), json_array_length(json_extract(n.json, '$.input.invoke'))
                 from node n join line l on n.story = l.story and n.id = l.parent),
             turns as (
               select story, count(*) as turns, max(id) as last from line
                 where text != '' or note is not null or invocations > 0 group by story)
             select s.id, s.card, s.title, s.starred, s.persona, s.updated, coalesce(t.turns, 0) as turns,
               (select json_extract(json, '$.input') from node where story = s.id and id = t.last) as last
             from story s left join turns t on t.story = s.id
             where (?1 is null or s.card = ?1) and (?2 is null or s.id = ?2) order by s.updated desc, s.id desc`,
          ).all(card ?? null, only ?? null) as Row[]
        ).map((r) => ({
          id: r["id"] as Id,
          card: r["card"] as string,
          title: (r["title"] as string | null) ?? null,
          starred: r["starred"] === 1,
          persona: (r["persona"] as string | null) ?? null,
          updated: r["updated"] as number,
          turns: r["turns"] as number,
          last: r["last"] ? (JSON.parse(r["last"] as string) as Input) : null,
        })),
      /** A name the player gave, or none; `updated` untouched, so a rename never reorders the list. */
      title: (id: Id, title: string | null) => void q("update story set title = ? where id = ?").run(title, id),
      /** Starred or not; `updated` untouched like a rename. The client puts the starred first. */
      star: (id: Id, starred: boolean) => void q("update story set starred = ? where id = ?").run(starred ? 1 : 0, id),
      /** The persona in force on this story alone (none: the card's own); `updated` untouched like a rename. */
      persona: (id: Id, persona: string | null) => void q("update story set persona = ? where id = ?").run(persona, id),
      /** Every story naming `persona` back on its card's own: a deleted persona leaves no stale id behind. */
      dropPersona: (persona: string) => void q("update story set persona = null where persona = ?").run(persona),
      /** A new story, on `persona` from its first request (the card's default pick, copied: after this it is the story's own). */
      create: (card: string, persona: string | null = null): Id =>
        Number(
          q("insert into story (card, updated, persona) values (?, ?, ?)").run(card, Date.now(), persona)
            .lastInsertRowid,
        ),
      del: (id: Id) => void q("delete from story where id = ?").run(id), // its nodes cascade
      /** Several at once, one transaction: the batch cleanup. Only the card's own go (any card's when it is absent);
       *  another card's, or no story, is skipped. The ids deleted are answered. */
      delMany: (card: string | undefined, ids: readonly Id[]): Id[] =>
        tx(() =>
          ids.filter(
            (id) =>
              q("delete from story where id = ?1 and (?2 is null or card = ?2)").run(id, card ?? null).changes > 0,
          ),
        ),
      /** The card's stories (every card's when it is absent) whose head's line holds `q` in a player's line, a note or the prose (the text parts of
       *  the reply), one Hit per story: the earliest hit node on the line (a snippet of the field that hit, the
       *  line first, then the note, then the prose), numbered by the turns up to it, and the count of hit nodes.
       *  ASCII case folds (`fold`, SQLite's lower()); a blank query hits nothing. The prose is gathered from the
       *  reply's parts in SQL (`json_each`), so no node's JSON is parsed here; the turn number is a running count
       *  over the line (a window), one pass. */
      search: (card: string | undefined, query: string): Hit[] => {
        const needle = fold(query.trim())
        if (!needle) return []
        const rows = q(
          `with recursive line(story, id, parent, text, note, invocations, prose) as (
             select s.id, n.id, n.parent, json_extract(n.json, '$.input.text'), json_extract(n.json, '$.input.note'), json_array_length(json_extract(n.json, '$.input.invoke')),
               (select group_concat(json_extract(p.value, '$.text'), '') from json_each(n.json, '$.reply') p
                  where json_extract(p.value, '$.type') = 'text')
               from story s join node n on n.story = s.id and n.id = s.head where (?1 is null or s.card = ?1)
             union all
             select l.story, n.id, n.parent, json_extract(n.json, '$.input.text'), json_extract(n.json, '$.input.note'), json_array_length(json_extract(n.json, '$.input.invoke')),
               (select group_concat(json_extract(p.value, '$.text'), '') from json_each(n.json, '$.reply') p
                  where json_extract(p.value, '$.type') = 'text')
               from node n join line l on n.story = l.story and n.id = l.parent),
           numbered as (
             select story, id, text, note, prose,
               count(*) filter (where text != '' or note is not null or invocations > 0) over (partition by story order by id) as turn
             from line)
           select story, id, text, note, prose, turn from numbered
           where instr(lower(text), ?2) > 0 or instr(lower(coalesce(note, '')), ?2) > 0 or instr(lower(coalesce(prose, '')), ?2) > 0
           order by story, id`,
        ).all(card ?? null, needle) as Row[]
        const hits = new Map<Id, Hit>()
        for (const r of rows) {
          const id = r["story"] as Id
          const seen = hits.get(id)
          if (seen) {
            seen.count++
            continue
          }
          const text = (r["text"] as string | null) ?? ""
          const note = (r["note"] as string | null) ?? ""
          const prose = (r["prose"] as string | null) ?? ""
          const [kind, field]: [Hit["kind"], string] = fold(text).includes(needle)
            ? ["input", text]
            : fold(note).includes(needle)
              ? ["note", note]
              : ["reply", prose]
          hits.set(id, { id, turn: r["turn"] as number, kind, text: snippet(field, needle), count: 1 })
        }
        return [...hits.values()]
      },
    },
    /** One story's trace: calls by node id, in the order they were made. */
    calls: (story: Id) => ({
      get: (node: Id): unknown[] =>
        (q("select json from call where story = ? and node = ? order by seq").all(story, node) as Row[]).map((r) =>
          parse<unknown>(r),
        ),
      list: (): Record<number, unknown[]> => {
        const by: Record<number, unknown[]> = {}
        for (const r of q("select node, json from call where story = ? order by seq").all(story) as Row[])
          (by[r["node"] as number] ??= []).push(parse<unknown>(r))
        return by
      },
      /** Files a node's calls, then drops the calls of every node of the story but the last `traced`. "Last" is by each
       *  node's newest call (seq), across every branch of the tree: an amended old node is recent again and keeps its
       *  trace, a node off the reading path counts like any other, and a dropped node's calls are already gone (cascade).
       *  The index on (story, node) keeps the trim (and that cascade) to the story's own rows. */
      add: (node: Id, calls: readonly unknown[]) =>
        tx(() => {
          if (!calls.length) return
          for (const c of calls)
            q("insert into call (story, node, json) values (?, ?, ?)").run(story, node, JSON.stringify(c))
          q(
            `delete from call where story = ? and node not in
               (select node from call where story = ? group by node order by max(seq) desc limit ?)`,
          ).run(story, story, traced)
        }),
    }),
    /** log.ts's Store over one story: read the tree whole, write each Change as rows in one transaction. */
    store: <T extends Noded>(story: Id): Store<T> => ({
      read: (): Snapshot<T> => {
        const s = q("select head, next from story where id = ?").get(story) as Row | undefined
        if (!s) throw new Error(`no story ${story}`)
        const nodes = (q("select json from node where story = ? order by id").all(story) as Row[]).map((r) =>
          known(parse<T>(r)!),
        )
        return { nodes, head: s["head"] as Id | null, next: s["next"] as Id }
      },
      write: (c: Change<T>, log: Log<T>) =>
        tx(() => {
          for (const id of c.dropped ?? []) q("delete from node where story = ? and id = ?").run(story, id)
          if (c.node)
            // an update in place, never `or replace`: SQLite's REPLACE deletes the row first, which cascades to `call`
            // and wipes the trace of a node that `demand` or `edit` only amended
            q(
              `insert into node (story, id, parent, json) values (?, ?, ?, ?)
                 on conflict (story, id) do update set parent = excluded.parent, json = excluded.json`,
            ).run(story, c.node.id, c.node.parent, JSON.stringify(c.node))
          q("update story set head = ?, next = ?, updated = ? where id = ?").run(log.head, log.next, Date.now(), story)
        }),
    }),
    close: () => db.close(),
  }
}
export type Data = ReturnType<typeof open>
