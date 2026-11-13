// The document each stage reads, assembled in one place. The ecosystem's preset did this job: one ordered text where the
// head, the history, this turn's lines and the question all point at the same people. Splitting it into fragments
// (fragment.ts), views (history.ts), asks and products left no module owning the assembled document, and each stage's
// list in session.ts drifted on its own: three stages ran with no head at all, so record did not know who "你" was.
// Two skeletons, one function. The narrator continues a conversation: `narrate.role` → the frame as one message
// (`<persona>`, `<setting>`, then the other slots' lines untagged) → each run of system fiction fragments as one
// `<fiction>` message (a user/assistant fragment stays its own message, in place) → transcript (ending in the last
// reply) → the player's line as the user message → one system message holding `<context>` (delivered entries, title and
// text) and `<turn>` (the `narrate.turn` lead, then Outcome … Player note), each omitted when empty (Anthropic takes a
// mid-conversation system message only directly after a user message, verified live; the one placement all three
// formats accept). The off-stage passes classify or extract (#167): `stage.role` and `<world>` (the same `<persona>` /
// `<setting>` tags inside) in the cached head prefix, this turn's state, ledger or rules as system lines, then one user
// message holding the tagged material (`<input>`, `<draft>`, `<scene>`) followed after its closing tag by the stage's
// task instruction—the identical message boundary across Anthropic, Gemini and OpenAI-compatible, never ending in an
// assistant prefill or a bare story line that invites roleplay continuation. The frame's slot ids come through from
// fragment.ts `head` (`Slotted`); a fragment's label never reaches the model.
// The frame (player zone → card frame: language, persona, pov, style, setting) is narrate's, with the fiction and the
// transcript; every other stage reads `stage.role` plus its `<world>` (layer.ts `worldOf`: who and where, no line on how
// to write). The input is one unit with an audience per stage: the line itself everywhere it is read,
// the thought ask wherever the line is (decide takes no action from a thought, record no fact), the note only where the
// README sends it, narrator and director. Cache breakpoints: the head's last message (the connection's TTL), the
// summary, and the last history message; everything before this turn's input is a cached read next turn.
// The connection's hat (fragment.ts `Hat`), by what a stage reads: narrate's head joins the head, its system messages
// after frame + fiction and its handshake (user/assistant) after every head system message, the breakpoint on the last
// head message (ai-sdk promotes only the leading system run to top-level system: a handshake first would demote the
// frame); narrate's tail ends the request, after this turn's directives and the player's tail fragments. check, polish
// and record wear review.head after `<world>`; lookup, decide and direct wear nothing.
// Data lines and wrappers live here: `<world>`, `<persona>`, `<setting>`, `<fiction>`, `<context>`, `<turn>`, `<input>`,
// `<draft>`, `<scene>`, State / Actions / So far, Rule, Open, Events, Must, Outcome, Current, MUST / MAY reveal, Tone,
// Player note, Known, Questions, Player's line.
import { breakpoint, type CacheTtl, type Message } from "@effect-tavern/provider/src/call.ts"
import type { Hat, Msg, Slotted } from "./fragment.ts"
import type { Input } from "./journal.ts"

/** The connection's say: whether past reasoning parts go back, and the head's cache lifetime. */
export interface Wire {
  reasoningBack?: boolean
  ttl?: CacheTtl
  hat?: Hat
}
/** What every stage shares: the evaluated frame, the off-stage framing line, this turn's input, and the thought ask. */
export interface Common {
  frame: readonly Slotted[] // narrate's alone
  world: readonly Slotted[] // the frame without its writing lines: what every other stage reads inside <world>
  role: string // `stage.role`: off-stage framing before <world> on every non-narrate stage
  narrator: string // `narrate.role`: what the narrate call is, before its frame
  directions: string // `narrate.turn`: the lead line of <turn>
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
  | {
      stage: "lookup"
      question: string
      ledger: readonly Msg[]
      context: readonly string[]
      current?: string
    }
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
      question: string // the `direct` ask: what must / may / tone each are, before the Open line
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
      told: readonly { title: string; text: string }[] // what lookup delivered: title and text, no id or revision
      outcome: readonly string[]
      current?: string
      must: readonly Told[]
      may: readonly Told[]
      tone?: string
      correction?: string
      blocks?: { question: string; asks: readonly string[] } // narrate products: the `narrate.blocks` ask, `<id>: <question>` lines
    }
  | {
      stage: "check"
      question: string
      rules: readonly string[]
      open: readonly Told[]
      must: readonly string[]
      prose: string
    }
  | { stage: "polish"; question: string; hints: readonly string[]; prose: string } // prose with <target> marks
  | {
      stage: "record"
      history?: readonly Msg[]
      tools?: string
      invoked?: readonly string[] // frozen player selections, including additions on a prose-preserving edit
      known: string
      current?: string
      asks: readonly string[] // `<product>: <question>` lines
      readout: string // the `record.readout` ask: how to answer the questions; sent only with them
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
/** Text enclosed in an XML tag, the one shape every wrapper here takes. */
export const tag = (name: string, body: string) => `<${name}>\n${body}\n</${name}>`
/** The slots that get a tag; every other frame line follows them untagged (the same split as layer.ts `worldOf`). */
const TAGGED = ["persona", "setting"]
/** Frame lines as one text: `<persona>`, `<setting>`, then the other slots' lines in their order, blank-line separated. */
const framed = (ms: readonly Slotted[]) =>
  [
    ...TAGGED.flatMap((id) => {
      const body = ms.filter((m) => m.id === id).map((m) => m.text)
      return body.length ? [tag(id, body.join("\n\n"))] : []
    }),
    ...ms.filter((m) => !TAGGED.includes(m.id ?? "")).map((m) => m.text),
  ].join("\n\n")
/** The off-stage `<world>` block, or "" when the card and player supplied none. decision-replay renders its state with it. */
export const worldBlock = (world: readonly Slotted[]) => (world.length ? tag("world", framed(world)) : "")
/** An off-stage pass's static head: `stage.role` first, then `<world>` when the card or player supplied one. */
const worldHead = (c: Common): Msg[] => [
  { role: "system", text: c.role },
  ...(c.world.length ? [{ role: "system" as const, text: worldBlock(c.world) }] : []),
]
/** Narrate's head before the hat: `narrate.role`, the frame's system lines as one message (a user/assistant frame
 *  fragment follows as its own), then each run of system fiction fragments as one `<fiction>` message, a user/assistant
 *  fragment kept as its own message in place. */
const narrateHead = (c: Common, fiction: readonly Msg[]): Msg[] => {
  const sysFrame = c.frame.filter((m) => m.role === "system")
  const out: Msg[] = [
    { role: "system", text: c.narrator },
    ...(sysFrame.length ? [{ role: "system" as const, text: framed(sysFrame) }] : []),
    ...c.frame.filter((m) => m.role !== "system"),
  ]
  let run: string[] = []
  const flush = () => {
    if (run.length) out.push({ role: "system", text: tag("fiction", run.join("\n\n")) })
    run = []
  }
  for (const m of fiction)
    if (m.role === "system") run.push(m.text)
    else {
      flush()
      out.push(m)
    }
  flush()
  return out
}
/** A delivered entry in narrate's <context>: title, then text; a lore or pack entry's title is its text's first sentence
 *  (lore.ts `hook`), so there the text alone. */
const entry = (d: { title: string; text: string }) => (d.text.startsWith(d.title) ? d.text : `${d.title}\n${d.text}`)
const rules = (rs: readonly string[]) => rs.map((r) => sys(`Rule: ${r}`))
const openLine = (open: readonly Told[]) => `Open: ${open.map((d) => `${d.id}=${d.text}`).join(" | ")}`

// ───────── The input and scene material ─────────
/** This turn's input text: the line when there is one, else the note itself (directed prose: the player writes to the
 *  narrator, not as anyone in the story). A chip-only turn continues the story: keep a nonempty boundary even if its
 *  invoked entries were removed before a rerun. */
const inputText = (i: Input) => i.text || i.note || "Continue the story."
const said = (i: Input): Message => usr(inputText(i))
/** An off-stage pass's single user message: the material enclosed in an XML tag, then the stage's task after it. */
const tagged = (name: "input" | "draft" | "scene", body: string, ...tasks: readonly string[]): Message =>
  usr([tag(name, body), ...tasks.filter(Boolean)].join("\n\n"))
/** The note line, only beside a line; alone it is already in the input text. */
const noteLine = (i: Input) => (i.text && i.note ? [`Player note: ${i.note}`] : [])
const noteOf = (i: Input) => noteLine(i).map(sys)
/** A thought (⦅ ⦆) in the line is a perception scope inside the fiction; every stage that reads the line hears what it is. */
const thoughtOf = (c: Common) => (/⦅/.test(c.input.text) ? [sys(c.thought)] : [])
/** The scene record reads: the player's line, marked as theirs, then the prose; an opening or a note-only turn is prose alone. */
const sceneBody = (i: Input, prose: string) => (i.text ? `Player's line: ${i.text}\n\n${prose}` : prose)

/** A hat's messages that say something: the settings editor keeps empty rows to type into, and Anthropic and Gemini
 *  refuse empty content, so every hat slot is read through this. */
const spoken = <M extends { text: string }>(ms: readonly M[] = []): M[] => ms.filter((m) => m.text.trim())

export const request = (c: Common, a: Ask, w: Wire = {}): Message[] => {
  const head = worldHead(c)
  const frame = zone(head, w)
  const reviewed = zone([...head, ...spoken(w.hat?.review?.head)], w)
  const hatHead = spoken(w.hat?.narrate?.head)
  switch (a.stage) {
    case "lookup":
      return [
        ...frame,
        ...a.ledger.map(toP(w)),
        ...a.context.map(sys),
        ...(a.current ? [sys(a.current)] : []),
        ...noteOf(c.input),
        ...thoughtOf(c),
        tagged("input", inputText(c.input), a.question),
      ]
    case "decide":
      return [
        ...frame,
        ...a.ledger.map(toP(w)),
        sys(`State: ${a.state}\nActions: ${a.menu.join(" | ")}\nSo far: ${a.soFar.join(",") || "-"}`),
        ...thoughtOf(c),
        tagged("input", inputText(c.input), a.question),
      ]
    case "direct":
      return [
        ...frame,
        ...rules(a.rules),
        ...a.ledger.map(toP(w)),
        sys(`${openLine(a.open)}\nEvents: ${a.events.join(",")}`),
        ...noteOf(c.input),
        ...thoughtOf(c),
        tagged("input", inputText(c.input), a.question),
      ]
    case "narrate": {
      const directions = [
        ...(a.outcome.length ? [`Outcome: ${a.outcome.join(", ")}`] : []),
        ...(a.current ? [a.current] : []),
        ...a.must.map((d) => `MUST reveal: ${d.text}`),
        ...a.may.map((d) => `MAY reveal: ${d.text}`),
        ...(a.tone ? [`Tone: ${a.tone}`] : []),
        ...noteLine(c.input),
      ]
      const now = [
        ...(a.told.length ? [tag("context", a.told.map(entry).join("\n\n"))] : []),
        ...(directions.length ? [tag("turn", [c.directions, ...directions].join("\n"))] : []),
      ]
      return [
        ...zone(
          [
            ...narrateHead(c, a.fiction),
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
        ...(now.length ? [sys(now.join("\n\n"))] : []),
        ...thoughtOf(c),
        ...(a.correction ? [sys(a.correction)] : []),
        ...(a.blocks?.asks.length ? [sys([a.blocks.question, ...a.blocks.asks].join("\n"))] : []),
        ...[...(c.tail ?? []), ...spoken(w.hat?.narrate?.tail)].map(toP(w)),
      ]
    }
    case "check": // nothing open (a guard-only turn): no empty Open / Must labels, the rules alone sit above <draft>
      return [
        ...reviewed,
        ...rules(a.rules),
        ...(a.open.length
          ? [sys([openLine(a.open), ...(a.must.length ? [`Must: ${a.must.join(",")}`] : [])].join("\n"))]
          : []),
        tagged("draft", a.prose, a.question),
      ]
    case "polish": // per-target hints above (when any), <draft> with <target> marks and the rewrite instruction below
      return [...reviewed, ...(a.hints.length ? [sys(a.hints.join("\n"))] : []), tagged("draft", a.prose, a.question)]
    case "record":
      return [
        ...reviewed,
        ...(a.invoked?.length
          ? [sys(`Invoked context (reference only; extract world facts from <scene> only):\n${a.invoked.join("\n\n")}`)]
          : []),
        sys([a.known, ...(a.current ? [a.current] : [])].join("\n")),
        ...thoughtOf(c),
        ...(a.history ?? []).map(toP(w)),
        tagged(
          "scene",
          a.history ? "Extract from the preceding story transcript for this interval." : sceneBody(c.input, a.prose),
          [...a.asks, ...(a.tools ? [a.tools] : [])].join("\n"),
          a.questions ? `${a.readout}\nQuestions: ${a.questions.join("\n")}` : "",
        ),
      ]
  }
}
