// The library behind the wire: one card's stories and the player's personas, one story open. A story is a session over
// its rows in data.ts, with the player layer the library stores (it wins over the harness default given). A persona is
// the player's, a sibling of the card, not a step of a story: `Player.persona[card]` names the one in force, and the
// library reads its text into the per-card persona slot on every request (the card's default overridden by the slot
// rules, nothing else in the card touched), so an edit of the persona is in force from the next request and a change of
// pick is one head rewrite, no new story. Deleting a persona drops the pick (no silent fallback). Opening another story
// is another session; the wire
// adapter asks `session` on every request, so a switch is in force at once. Deleting the open story opens the newest
// remaining one, or a new one when none is left: there is always a story open.
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { decodePlayer, type Player } from "@effect-tavern/runtime/src/fragment.ts"
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import { makeSession, type Session, type SessionModel, type Turn } from "@effect-tavern/runtime/src/session.ts"
import type { Data } from "./data.ts"

export const library = ({
  data,
  card,
  player,
  model,
}: {
  data: Data
  card: Card
  player: Player
  model: SessionModel
}) => {
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
  const open = (id: Id): Session => {
    if (!data.stories.list(card.id).some((s) => s.id === id)) throw new Error(`no story ${id}`)
    return makeSession({ card, player, model, store: data.store<Turn>(id), players, persona })
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
