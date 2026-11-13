// Shared library records and read contracts, independent of persistence and transport.
import type { Card, ShownGreeting as Greeting, Rules } from "./card.ts"
import type { Cond } from "./cond.ts"
import type { Input } from "./journal.ts"
import type { Id } from "./log.ts"
import type { Local, shown } from "./layer.ts"
import type { Facets, Phase } from "./session.ts"

export interface CardView {
  id: string
  title: string
  summary?: string // one line on what this card is
  facets: Facets // what the card is, off its structure (session.ts `facets`): the keys a client draws in its own words
  heading?: string // what titles a turn (Card.heading); absent, turns have no titles
  input: "act" | "note" // the default channel: participant mode (act) or author mode (note), fixed for the session
  greetings: readonly Greeting[] // the openings: a story starts with one (greet, by index) or, with none, with the player's line
  director: boolean
  guard: number // must-nots check enforces: a count, never the words
  lore: { entries: number; layers: number } // the card's size; what is readable now is on the node
  tokens: { head: number } // what the card's own text costs each turn, estimated
  fiction: readonly { id: string; label?: string; when?: Cond }[] // the fiction's modules without their text
  catalogs?: Card["catalogs"]
  rules: Rules
  local: Local
  mounts: readonly { id: string; name: string }[]
  persona: string | null // the persona this view wears: its story's, with no story the card's (server library.ts `personaFor`)
  layer: ReturnType<typeof shown>
}
export interface StoredStory {
  id: Id
  card: string
  title: string | null
  starred: boolean
  persona: string | null
  updated: number
  turns: number
  last: Input | null
}
export interface StoryRow extends StoredStory {
  busy: Phase | null
}
export interface Listing {
  current: Id | null
  stories: readonly StoryRow[]
}
export type CardRow = { id: string; title: string; summary?: string; facets?: Facets }
export interface Hit {
  id: Id
  turn: number
  kind: "input" | "note" | "reply"
  text: string
  count: number
}
export interface Persona {
  id: string
  name: string
  text: string
  default?: boolean // on the wire: the listing's mark (one persona or none), a write's mark or unmark
}
