// The install's library: one SQLite file through `node:sqlite` (built into Bun and Node, no dependency), used as a
// document store: a row is an id and a JSON column, nothing is ever joined. The tables mirror the types. `player`: one
// row, the Player (reading preferences: writing, language, asks, product toggles, snippets, and which persona it is on
// each card). `persona`: named frame fragments, the player's own (who they are in the fiction; a card still gives a
// default in its frame). `hat`: the player's hats (runtime fragment.ts `Hat`), named by a provider's model. `secret`:
// the key vault (provider providers.ts `Secret`), the only table holding key material; `provider`: the player's model
// providers, each naming a secret by id; `routing`: one row, which (provider, model) each stage runs on. Export of cards
// and stories never reads the three. `card`: a Card as the workshop will write it (the four templates stay TS modules until then).
// `story`: one log tree of a card, with the log's head and next beside it so an id never comes back after a drop. `node`: a
// Turn per row, appended by the store's write. `call`: a node's `call` events (the Inspector's trace), appended when the
// node lands or is amended, gone with the node. The runtime never sees SQL: `store(story)` is log.ts's Store, whose
// write is one Change in one transaction. Cards and personas travel as JSON files; the library is the install's own.
// Only what has a caller is here: the rest of the tables get their reads and writes with the endpoint that needs them.
// Ceilings: full-text search over nodes; sync between two installs (the Android copy is a copy of this file).
import type { Provider, Secret } from "@effect-tavern/provider/src/providers.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import type { Change, Id, Log, Noded, Snapshot, Store } from "@effect-tavern/runtime/src/log.ts"
import { DatabaseSync } from "node:sqlite"

const schema = `
create table if not exists player (id integer primary key check (id = 1), json text not null);
create table if not exists persona (id text primary key, name text not null, json text not null);
create table if not exists hat (id text primary key, name text not null, json text not null);
create table if not exists secret (id text primary key, name text not null, json text not null);
create table if not exists provider (id text primary key, name text not null, json text not null);
create table if not exists routing (id integer primary key check (id = 1), json text not null);
create table if not exists card (id text primary key, title text not null, json text not null, updated integer not null);
create table if not exists story (id integer primary key autoincrement, card text not null, title text, head integer, next integer not null default 0, updated integer not null);
create table if not exists node (story integer not null references story (id) on delete cascade, id integer not null,
  parent integer, json text not null, primary key (story, id));
create table if not exists call (seq integer primary key autoincrement, story integer not null, node integer not null,
  json text not null, foreign key (story, node) references node (story, id) on delete cascade);
`
type Row = Record<string, unknown>
const parse = <T>(r: Row | undefined): T | undefined => (r ? (JSON.parse(r["json"] as string) as T) : undefined)

/** A named frame fragment of the player's: who they are in the fiction, picked per card on the player row. */
export interface Persona {
  id: string
  name: string
  text: string
}

export const open = (file: string) => {
  const db = new DatabaseSync(file)
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on;")
  db.exec(schema)
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
    /** The player layer, one row: the session's `players` store. What it holds is decoded by the caller. */
    player: {
      read: (): unknown => parse<unknown>(q("select json from player where id = 1").get() as Row | undefined),
      write: (p: unknown) => void q("insert or replace into player (id, json) values (1, ?)").run(JSON.stringify(p)),
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
    secrets: named<Secret>("secret"),
    providers: named<Provider>("provider"),
    /** Which (provider, model) runs each stage, one row; what it holds is decoded by the caller. */
    routing: {
      read: (): unknown => parse<unknown>(q("select json from routing where id = 1").get() as Row | undefined),
      write: (r: unknown) => void q("insert or replace into routing (id, json) values (1, ?)").run(JSON.stringify(r)),
    },
    /** One card's stories, newest first, each with its size and its head node (what a list names it by), parsed for
     *  the caller to read. */
    stories: {
      list: (card: string) =>
        (
          q(
            `select s.id, s.updated, (select count(*) from node where story = s.id) as turns,
               (select json from node where story = s.id and id = s.head) as json
             from story s where card = ? order by updated desc, id desc`,
          ).all(card) as Row[]
        ).map((r) => ({
          id: r["id"] as Id,
          updated: r["updated"] as number,
          turns: r["turns"] as number,
          head: parse<unknown>(r) ?? null,
        })),
      create: (card: string): Id =>
        Number(q("insert into story (card, updated) values (?, ?)").run(card, Date.now()).lastInsertRowid),
      del: (id: Id) => void q("delete from story where id = ?").run(id), // its nodes cascade
    },
    /** One story's trace: calls by node id, in the order they were made. */
    calls: (story: Id) => ({
      list: (): Record<number, unknown[]> => {
        const by: Record<number, unknown[]> = {}
        for (const r of q("select node, json from call where story = ? order by seq").all(story) as Row[])
          (by[r["node"] as number] ??= []).push(parse<unknown>(r))
        return by
      },
      add: (node: Id, calls: readonly unknown[]) =>
        tx(() => {
          for (const c of calls)
            q("insert into call (story, node, json) values (?, ?, ?)").run(story, node, JSON.stringify(c))
        }),
    }),
    /** log.ts's Store over one story: read the tree whole, write each Change as rows in one transaction. */
    store: <T extends Noded>(story: Id): Store<T> => ({
      read: (): Snapshot<T> => {
        const s = q("select head, next from story where id = ?").get(story) as Row | undefined
        if (!s) throw new Error(`no story ${story}`)
        const nodes = (q("select json from node where story = ? order by id").all(story) as Row[]).map((r) =>
          parse<T>(r)!,
        )
        return { nodes, head: s["head"] as Id | null, next: s["next"] as Id }
      },
      write: (c: Change<T>, log: Log<T>) =>
        tx(() => {
          for (const id of c.dropped ?? []) q("delete from node where story = ? and id = ?").run(story, id)
          if (c.node)
            q("insert or replace into node (story, id, parent, json) values (?, ?, ?, ?)").run(
              story,
              c.node.id,
              c.node.parent,
              JSON.stringify(c.node),
            )
          q("update story set head = ?, next = ?, updated = ? where id = ?").run(log.head, log.next, Date.now(), story)
        }),
    }),
    close: () => db.close(),
  }
}
export type Data = ReturnType<typeof open>
