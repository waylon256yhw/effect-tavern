// One screen: the reading line as sections, the draft growing at its end, a composer at the bottom. Under each section a
// Record pill opens a full-page sheet of that turn's readings (src/record.ts projects them; this file only draws); the
// last section carries the Options container, whose rows fill the composer and never send. Shapes follow
// docs/client-design-brief-3.md and the canvas in docs/client-canvas/.
import { Dialog } from "@base-ui/react/dialog"
import { Meter } from "@base-ui/react/meter"
import { RegistryContext, useAtomValue } from "@effect/atom-react"
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { useEffect, useRef, useState } from "react"
import {
  Change,
  Close,
  Clue,
  Die,
  Insert,
  Next,
  Notes,
  Pin,
  Prev,
  Record,
  Reword,
  Send,
  Stop,
  Swipe,
} from "./icons.tsx"
import { imeController } from "./ime.ts"
import { record, type Element } from "./record.ts"
import {
  active,
  childrenOf,
  compose,
  draft,
  error,
  nodes,
  path,
  pin,
  prose,
  registry,
  rules,
  stage,
  type Id,
} from "./store.ts"
import { fetchNodes, fetchRules, send } from "./wire.ts"

const waiting: Record<string, string> = {
  lookup: "Reading",
  decide: "Rolling",
  direct: "Directing",
  narrate: "Writing",
  check: "Checking",
  record: "Recording",
}
const pct = (x: number) => `${Math.round(x * 100)}%`

const Paragraphs = ({ text }: { text: string }) => (
  <>
    {text
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .map((p, i) => (
        <p key={i}>{p}</p>
      ))}
  </>
)

const Said = ({ input }: { input: { text: string; note?: string } }) =>
  input.text ? <p className="said">{input.text}</p> : input.note ? <p className="said note">{input.note}</p> : null

// ───────── The Record sheet: one renderer per element kind ─────────
const Reading = ({ el }: { el: Element }) => {
  const pinned = useAtomValue(pin)
  switch (el.kind) {
    case "steps":
      return (
        <div className="steps" role="img" aria-label={`${el.path}: ${el.options[el.now]}`}>
          <div className="row">
            <span className="label">{el.path}</span>
          </div>
          <div className="track">
            {el.options.map((_, i) => (
              <i key={i} data-reached={i <= el.now || undefined} data-new={(i > el.was && i <= el.now) || undefined} />
            ))}
          </div>
          <div className="names">
            {el.options.map((o, i) => (i === el.now ? <b key={o}>{o}</b> : <span key={o}>{o}</span>))}
          </div>
        </div>
      )
    case "meter":
      return (
        <Meter.Root className="meter" value={el.now} min={el.min} max={el.max} aria-label={el.path}>
          <div className="row">
            <span className="label">{el.path}</span>
            <span className="num">
              {el.now} / {el.max}
            </span>
          </div>
          <Meter.Track className="track">
            <Meter.Indicator className="fill" />
          </Meter.Track>
        </Meter.Root>
      )
    case "value":
      return (
        <div className="row value">
          <span className="label">{el.path}</span>
          <span className="num">
            {String(el.was)} <Change aria-hidden /> {String(el.now)}
          </span>
        </div>
      )
    case "check": {
      const c = el.check
      return (
        <div className="check" role="img" aria-label={`${c.action}: ${c.hit ? "hit" : "miss"}, ${pct(c.chance)}`}>
          <div className="row">
            <Die aria-hidden />
            <span className="label">{c.action}</span>
            <span className="badge" data-hit={c.hit || undefined}>
              {c.hit ? "Hit" : "Miss"}
            </span>
            <span className="num">{pct(c.chance)}</span>
          </div>
          <div className="track">
            <i className="zone" style={{ width: pct(c.chance) }} />
            <i className="dot" style={{ left: pct(c.roll) }} />
          </div>
        </div>
      )
    }
    case "clue":
      return (
        <div className="clue">
          <Clue aria-hidden />
          <p>{el.text}</p>
          {el.pinnable && (
            <button
              className="icon"
              aria-label="Pin"
              aria-pressed={pinned === el.id}
              onClick={() => registry.set(pin, pinned === el.id ? null : el.id)}
            >
              <Pin weight={pinned === el.id ? "fill" : "regular"} />
            </button>
          )}
        </div>
      )
    case "notes":
      return (
        <div className="notes">
          <Notes aria-hidden />
          <ul>
            {el.items.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )
  }
}

const RecordSheet = ({
  node,
  n,
  busy,
  onSwipe,
  onReword,
}: {
  node: Node
  n: number
  busy: boolean
  onSwipe: () => void
  onReword: () => void
}) => {
  const r = useAtomValue(rules)
  const all = useAtomValue(nodes)
  const [open, setOpen] = useState(false)
  const act = (f: () => void) => {
    setOpen(false)
    f()
  }
  const prev = node.turn.parent === null ? undefined : all.get(node.turn.parent)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="record-pill">
        <Record aria-hidden />
        Record
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" />
        <Dialog.Popup className="sheet">
          <header>
            <Dialog.Title>Turn {n}</Dialog.Title>
            <Dialog.Close className="icon" aria-label="Close">
              <Close />
            </Dialog.Close>
          </header>
          <div className="record">{r && record(r, node, prev).map((el, i) => <Reading key={i} el={el} />)}</div>
          <footer className="actions">
            <span className="spacer" />
            <button className="icon" aria-label="Swipe" disabled={busy} onClick={() => act(onSwipe)}>
              <Swipe />
            </button>
            <button className="icon" aria-label="Reword" disabled={busy} onClick={() => act(onReword)}>
              <Reword />
            </button>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The raised container of this turn's options: a row fills the composer, never sends. */
const Options = ({ items }: { items: readonly string[] }) => (
  <div className="options">
    <header>
      <Reword aria-hidden />
      Options
    </header>
    {items.map((t, i) => (
      <button key={i} className="option" onClick={() => registry.set(compose, t)}>
        <span className="n">{i + 1}</span>
        <span>{t}</span>
        <Insert aria-hidden />
      </button>
    ))}
  </div>
)

const Section = ({
  node,
  n,
  last,
  busy,
  onSwipe,
  onReword,
}: {
  node: Node
  n: number
  last: boolean
  busy: boolean
  onSwipe: () => void
  onReword: () => void
}) => {
  const all = useAtomValue(nodes)
  const siblings = childrenOf(all, node.turn.parent)
  const at = siblings.findIndex((s) => s.turn.id === node.turn.id)
  const go = (i: number) => registry.update(active, (m) => new Map(m).set(node.turn.parent, siblings[i]!.turn.id))
  const options = node.turn.products.options as readonly string[] | undefined
  return (
    <section>
      <Said input={node.turn.input} />
      <Paragraphs text={prose(node)} />
      <footer className="actions">
        <RecordSheet node={node} n={n} busy={busy} onSwipe={onSwipe} onReword={onReword} />
        {siblings.length > 1 && (
          <span className="siblings">
            <button className="icon" aria-label="Previous version" disabled={at === 0} onClick={() => go(at - 1)}>
              <Prev />
            </button>
            {at + 1}/{siblings.length}
            <button
              className="icon"
              aria-label="Next version"
              disabled={at === siblings.length - 1}
              onClick={() => go(at + 1)}
            >
              <Next />
            </button>
          </span>
        )}
        {node.turn.end === "stopped" && <span className="end">Stopped</span>}
      </footer>
      {last && options?.length ? <Options items={options} /> : null}
    </section>
  )
}

const Composer = ({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean
  onSend: (text: string, note: boolean) => void
  onStop: () => void
}) => {
  const text = useAtomValue(compose)
  const pinned = useAtomValue(pin)
  const [note, setNote] = useState(false)
  const submit = () => {
    const t = text.trim()
    if (!t || busy) return false
    onSend(t, note)
    registry.set(compose, "")
    setNote(false)
    return true
  }
  const submitRef = useRef(submit)
  submitRef.current = submit
  const ime = useRef(imeController(() => submitRef.current()))
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="box">
        <textarea
          value={text}
          aria-label={note ? "Note to the narrator" : "Your line"}
          enterKeyHint="enter"
          onChange={(e) => registry.set(compose, e.target.value)}
          onCompositionStart={() => ime.current.compositionStart()}
          onCompositionEnd={() => ime.current.compositionEnd()}
          onKeyDown={(e) => ime.current.keyDown(e.nativeEvent)}
        />
        <div className="row">
          <div className="channel" role="radiogroup" aria-label="Channel">
            <button type="button" role="radio" aria-checked={!note} onClick={() => setNote(false)}>
              Act
            </button>
            <button type="button" role="radio" aria-checked={note} onClick={() => setNote(true)}>
              Note
            </button>
          </div>
          {pinned && (
            <button type="button" className="icon" aria-label="Unpin" onClick={() => registry.set(pin, null)}>
              <Pin weight="fill" />
            </button>
          )}
          <span className="spacer" />
          {busy ? (
            <button type="button" className="send" aria-label="Stop" onClick={onStop}>
              <Stop />
            </button>
          ) : (
            <button type="submit" className="send" aria-label="Send" disabled={!text.trim()}>
              <Send />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

const Reader = () => {
  const line = useAtomValue(path)
  const d = useAtomValue(draft)
  const phase = useAtomValue(stage)
  const err = useAtomValue(error)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => void Promise.all([fetchRules(), fetchNodes()]), [])

  const start = (parent: Id | null, input: { text: string; note?: string }, action: Parameters<typeof send>[0]) => {
    registry.set(error, null)
    registry.set(draft, { parent, input, text: "" })
    stop.current = send(action)
  }
  const onSend = (text: string, note: boolean) => {
    const parent = line.at(-1)?.turn.id ?? null
    const pinned = registry.get(pin)
    const input = { ...(note ? { text: "", note: text } : { text }), ...(pinned ? { pin: pinned } : {}) }
    registry.set(pin, null)
    start(parent, input, { kind: "act", parent, input })
  }
  const onSwipe = (n: Node) => start(n.turn.parent, n.turn.input, { kind: "swipe", node: n.turn.id })
  const onReword = (n: Node) => start(n.turn.parent, n.turn.input, { kind: "reword", node: n.turn.id })
  const onStop = async () => {
    if (!stop.current) return
    stop.current()
    // Before the first character the turn is withdrawn; after it, the server finishes a `stopped` node the closed
    // response never carried, so read the snapshot back until it shows up.
    const was = registry.get(nodes).size
    if ((registry.get(draft)?.text ?? "") === "") return registry.set(draft, null)
    for (let i = 0; i < 100 && registry.get(nodes).size === was; i++) {
      await new Promise((r) => setTimeout(r, 300))
      await fetchNodes()
    }
    registry.set(draft, null)
    registry.set(stage, null)
  }

  return (
    <main>
      {line.map((n, i) => (
        <Section
          key={n.turn.id}
          node={n}
          n={i + 1}
          last={!d && i === line.length - 1}
          busy={d !== null}
          onSwipe={() => onSwipe(n)}
          onReword={() => onReword(n)}
        />
      ))}
      {d && (
        <section className="draft">
          <Said input={d.input} />
          <Paragraphs text={d.text} />
          <p className="stage">{phase ? waiting[phase] : "…"}</p>
        </section>
      )}
      {err && <p className="error">{err}</p>}
      <Composer busy={d !== null} onSend={onSend} onStop={onStop} />
    </main>
  )
}

export const App = () => (
  <RegistryContext.Provider value={registry}>
    <Reader />
  </RegistryContext.Provider>
)
