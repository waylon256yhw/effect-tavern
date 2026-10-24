// The install's library: one SQLite file through `node:sqlite` (built into Bun and Node, no dependency), used as a
// document store: a row is an id and a JSON column, nothing is ever joined. Five tables mirror the types. `player`: one
// row, the Player (reading preferences: writing, language, asks, product toggles, snippets). `persona`: named frame
// fragments the player picks per story (who they are in the fiction; a card still gives a default in its frame).
// `card`: a Card as the workshop will write it (the four templates stay TS modules until then). `story`: one log tree,
// a card played as a persona, with the log's head and next beside it so an id never comes back after a drop. `node`: a
// Turn per row, appended by the store's write. The runtime never sees SQL: `store(story)` is log.ts's Store, whose
// write is one Change in one transaction. Cards and personas travel as JSON files; the library is the install's own.
// Only what has a caller is here: the rest of the tables get their reads and writes with the endpoint that needs them.
// Ceilings: full-text search over nodes; sync between two installs (the Android copy is a copy of this file).
import type { Change, Id, Log, Noded, Snapshot, Store } from "@effect-tavern/runtime/src/log.ts"
import { DatabaseSync } from "node:sqlite"

const schema = `
create table if not exists player (id integer primary key check (id = 1), json text not null);
create table if not exists persona (id text primary key, name text not null, json text not null);
create table if not exists card (id text primary key, title text not null, json text not null, updated integer not null);
create table if not exists story (id integer primary key autoincrement, card text not null, persona text, title text,
  head integer, next integer not null default 0, updated integer not null);
create table if not exists node (story integer not null references story (id) on delete cascade, id integer not null,
  parent integer, json text not null, primary key (story, id));
`
type Row = Record<string, unknown>
const parse = <T>(r: Row | undefined): T | undefined => (r ? (JSON.parse(r["json"] as string) as T) : undefined)

/** A named frame fragment the player picks per story: who they are in the fiction. */
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
    /** One card's stories, newest first: a story is a log tree played as one persona (by id; none = the card's default). */
    stories: {
      list: (card: string) =>
        q("select id, persona, updated from story where card = ? order by updated desc, id desc").all(card) as {
          id: Id
          persona: string | null
          updated: number
        }[],
      create: (card: string, persona?: string): Id =>
        Number(
          q("insert into story (card, persona, updated) values (?, ?, ?)").run(card, persona ?? null, Date.now())
            .lastInsertRowid,
        ),
      del: (id: Id) => void q("delete from story where id = ?").run(id), // its nodes cascade
    },
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
