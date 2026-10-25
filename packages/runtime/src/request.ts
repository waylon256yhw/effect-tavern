// The document each stage reads, assembled in one place. The ecosystem's preset did this job: one ordered text where the
// head, the history, this turn's lines and the question all point at the same people. Splitting it into fragments
// (fragment.ts), views (history.ts), asks and products left no module owning the assembled document, and each stage's
// list in session.ts drifted on its own: three stages ran with no head at all, so record did not know who "你" was.
// Two skeletons, one function. The narrator continues a conversation: head → transcript (ending in the last reply) →
// the player's line as the user message → this turn's directives as system lines (Anthropic takes a mid-conversation
// system message only directly after a user message, verified live; the one placement all three formats accept). The
// structured stages classify or extract: every system line first (frame, ledger or facts, the question), then the
// one user message being judged (the input, the prose, the scene). A structured call never ends in an assistant message
// (current Claude rejects the prefix, docs/provider-reading.md §7), so record's scene is one user message.
// The frame (player zone → card frame: language, persona, pov, style, setting) is in every stage; the fiction and the
// transcript only in narrate. The input is one unit with an audience per stage: the line itself everywhere it is read,
// the thought ask wherever the line is (decide takes no action from a thought, record no fact), the note only where the
// README sends it, narrator and director. Cache breakpoints: the head's last message (the connection's TTL), the
// summary, and the last history message; everything before this turn's input is a cached read next turn.
// The connection's hat (fragment.ts `Hat`), by what a stage reads: narrate's head joins the head, its system messages
// after frame + fiction and its handshake (user/assistant) after every head system message, the breakpoint on the last
// head message (ai-sdk promotes only the leading system run to top-level system: a handshake first would demote the
// frame); narrate's tail ends the request, after this turn's directives and the player's tail fragments. check, polish
// and record wear review.head after the frame; lookup, decide and direct wear nothing. No hat: today's document, byte for byte.
// Data lines are format and live here: Index, State / Actions / So far, Rule, Open, Events, Must, Outcome, Current,
// MUST / MAY reveal, Tone, Player note, Known, Questions, Player's line.
import { breakpoint, type CacheTtl, type Message } from "@effect-tavern/provider"
import type { Hat, Msg } from "./fragment.ts"
import type { Input } from "./journal.ts"

/** The connection's say: whether past reasoning parts go back, and the head's cache lifetime. */
export interface Wire {
  reasoningBack?: boolean
  ttl?: CacheTtl
  hat?: Hat
}
/** What every stage shares: the evaluated frame, this turn's input, and the ask that explains a thought in it. */
export interface Common {
  frame: readonly Msg[]
  input: Input
  thought: string
  tail?: readonly Msg[] // the player's tail-placed fragments; only narrate reads them
}
/** An entry with its text: what Open lines and reveal directives carry. */
export interface Told {
  id: string
  text: string
}
export type Ask =
  | { stage: "lookup"; question: string; index: readonly string[] } // entries as `id=hook`
  | {
      stage: "decide"
      ledger: readonly Msg[]
      question: string
      state: string
      menu: readonly string[]
      soFar: readonly string[]
    }
  | {
      stage: "direct"
      ledger: readonly Msg[]
      rules: readonly string[]
      open: readonly Told[]
      events: readonly string[]
    }
  | {
      stage: "narrate"
      fiction: readonly Msg[]
      history: readonly Msg[]
      summarized: boolean // history[0] is the fold
      told: readonly string[] // what lookup delivered this turn
      outcome: readonly string[]
      current?: string
      must: readonly Told[]
      may: readonly Told[]
      tone?: string
      correction?: string
    }
  | { stage: "check"; rules: readonly string[]; open: readonly Told[]; must: readonly string[]; prose: string }
  | { stage: "polish"; question: string; hints: readonly string[]; prose: string } // prose with <target> marks
  | {
      stage: "record"
      known: string
      current?: string
      asks: readonly string[] // `<product>: <question>` lines
      questions?: readonly string[] // readout lines, when the card declares any
      prose: string
    }

const sys = (content: string): Message => ({ role: "system", content })
const usr = (content: string): Message => ({ role: "user", content })
const toP =
  (w: Wire) =>
  (m: Msg): Message =>
    (m.parts && w.reasoningBack ? { role: m.role, content: m.parts } : { role: m.role, content: m.text }) as Message
/** A head zone: its last message carries the breakpoint, so the zone is a cached read while it stays byte-stable. */
const zone = (msgs: readonly Msg[], w: Wire): Message[] =>
  msgs.map((m, i) => (i === msgs.length - 1 ? breakpoint(toP(w)(m), w.ttl) : toP(w)(m)))
const rules = (rs: readonly string[]) => rs.map((r) => sys(`Rule: ${r}`))
const openLine = (open: readonly Told[]) => `Open: ${open.map((d) => `${d.id}=${d.text}`).join(" | ")}`

// ───────── The input as one unit ─────────
/** This turn's user message: the line when there is one, else the note itself (directed prose: the player writes to the
 *  narrator, not as anyone in the story). */
const said = (i: Input) => usr(i.text || i.note || "")
/** The note as a system line, only beside a line; alone it is already the user message. */
const noteOf = (i: Input) => (i.text && i.note ? [sys(`Player note: ${i.note}`)] : [])
/** A thought (⦅ ⦆) in the line is a perception scope inside the fiction; every stage that reads the line hears what it is. */
const thoughtOf = (c: Common) => (/⦅/.test(c.input.text) ? [sys(c.thought)] : [])
/** The scene record reads: the player's line, marked as theirs, then the prose; an opening or a note-only turn is prose alone. */
const scene = (i: Input, prose: string) => usr(i.text ? `Player's line: ${i.text}\n\n${prose}` : prose)

export const request = (c: Common, a: Ask, w: Wire = {}): Message[] => {
  const frame = zone(c.frame, w)
  const reviewed = zone([...c.frame, ...(w.hat?.review?.head ?? [])], w)
  const hatHead = w.hat?.narrate?.head ?? []
  switch (a.stage) {
    case "lookup":
      return [...frame, sys(`${a.question}\nIndex: ${a.index.join(", ")}`), ...thoughtOf(c), said(c.input)]
    case "decide":
      return [
        ...frame,
        ...a.ledger.map(toP(w)),
        sys(`${a.question}\nState: ${a.state}\nActions: ${a.menu.join(" | ")}\nSo far: ${a.soFar.join(",") || "-"}`),
        ...thoughtOf(c),
        said(c.input),
      ]
    case "direct":
      return [
        ...frame,
        ...rules(a.rules),
        ...a.ledger.map(toP(w)),
        sys(`${openLine(a.open)}\nEvents: ${a.events.join(",")}`),
        ...noteOf(c.input),
        ...thoughtOf(c),
        said(c.input),
      ]
    case "narrate":
      return [
        ...zone(
          [
            ...c.frame,
            ...a.fiction,
            ...hatHead.filter((m) => m.role === "system"),
            ...hatHead.filter((m) => m.role !== "system"),
          ],
          w,
        ),
        // the fold is byte-stable until the boundary moves; the last message is the end of what next turn resends verbatim
        ...a.history.map((m, i, all) =>
          i === all.length - 1 || (i === 0 && a.summarized) ? breakpoint(toP(w)(m)) : toP(w)(m),
        ),
        said(c.input),
        ...a.told.map(sys),
        ...(a.outcome.length ? [sys(`Outcome: ${a.outcome.join(", ")}`)] : []),
        ...(a.current ? [sys(a.current)] : []),
        ...a.must.map((d) => sys(`MUST reveal: ${d.text}`)),
        ...a.may.map((d) => sys(`MAY reveal: ${d.text}`)),
        ...(a.tone ? [sys(`Tone: ${a.tone}`)] : []),
        ...noteOf(c.input),
        ...thoughtOf(c),
        ...(a.correction ? [sys(a.correction)] : []),
        ...[...(c.tail ?? []), ...(w.hat?.narrate?.tail ?? [])].map(toP(w)),
      ]
    case "check": // nothing open (a guard-only turn): no empty Open / Must labels, the rules alone are the question
      return [
        ...reviewed,
        ...rules(a.rules),
        ...(a.open.length
          ? [sys([openLine(a.open), ...(a.must.length ? [`Must: ${a.must.join(",")}`] : [])].join("\n"))]
          : []),
        usr(a.prose),
      ]
    case "polish": // check's shape, the rules swapped for the rewrite and its per-target hints
      return [...reviewed, sys([a.question, ...a.hints].join("\n")), usr(a.prose)]
    case "record":
      return [
        ...reviewed,
        sys([a.known, ...(a.current ? [a.current] : []), ...a.asks].join("\n")),
        ...(a.questions ? [sys(`Questions: ${a.questions.join("\n")}`)] : []),
        ...thoughtOf(c),
        scene(c.input, a.prose),
      ]
  }
}
