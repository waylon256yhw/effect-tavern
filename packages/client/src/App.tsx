// One screen: the reading line as sections, the draft growing at its end, a composer at the bottom. Design in
// docs/client-shape.md; this is the skeleton that proves the loop on the real server, not the page's final shape.
import { RegistryContext, useAtomValue } from "@effect/atom-react"
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { useEffect, useRef, useState } from "react"
import { imeController } from "./ime.ts"
import { active, childrenOf, draft, error, nodes, path, prose, registry, stage, type Id } from "./store.ts"
import { fetchNodes, send } from "./wire.ts"

const waiting: Record<string, string> = {
  lookup: "翻阅",
  decide: "掷骰",
  direct: "导演",
  narrate: "落笔",
  check: "检查",
  record: "记账",
}

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
  input.text ? <p className="said">{input.text}</p> : input.note ? <p className="note">{input.note}</p> : null

const Section = ({ node, last, onSwipe }: { node: Node; last: boolean; onSwipe: () => void }) => {
  const all = useAtomValue(nodes)
  const siblings = childrenOf(all, node.turn.parent)
  const at = siblings.findIndex((s) => s.turn.id === node.turn.id)
  const go = (i: number) => registry.update(active, (m) => new Map(m).set(node.turn.parent, siblings[i]!.turn.id))
  return (
    <section>
      <Said input={node.turn.input} />
      <Paragraphs text={prose(node)} />
      <footer>
        {siblings.length > 1 && (
          <span className="siblings">
            <button disabled={at === 0} onClick={() => go(at - 1)}>
              ‹
            </button>
            {at + 1}/{siblings.length}
            <button disabled={at === siblings.length - 1} onClick={() => go(at + 1)}>
              ›
            </button>
          </span>
        )}
        {node.turn.end === "stopped" && <span className="end">（停）</span>}
        {last && <button onClick={onSwipe}>重来</button>}
      </footer>
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
  const [text, setText] = useState("")
  const [note, setNote] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const submit = () => {
    const t = text.trim()
    if (!t || busy) return false
    onSend(t, note)
    setText("")
    setNote(false)
    return true
  }
  const ime = useRef(imeController(submit))
  ime.current = imeController(submit)
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={ref}
        value={text}
        placeholder={note ? "给叙述者的话，不进故事" : "说或做"}
        enterKeyHint="enter"
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => ime.current.compositionStart()}
        onCompositionEnd={() => ime.current.compositionEnd()}
        onKeyDown={(e) => ime.current.keyDown(e.nativeEvent)}
      />
      <div className="row">
        <button type="button" className={note ? "mode off" : "mode"} onClick={() => setNote((n) => !n)}>
          {note ? "场外" : "角色"}
        </button>
        {busy ? (
          <button type="button" onClick={onStop}>
            停
          </button>
        ) : (
          <button type="submit" disabled={!text.trim()}>
            发
          </button>
        )}
      </div>
    </form>
  )
}

const Reader = () => {
  const line = useAtomValue(path)
  const d = useAtomValue(draft)
  const phase = useAtomValue(stage)
  const err = useAtomValue(error)
  const current = useRef<ReturnType<typeof send> | null>(null)
  useEffect(() => void fetchNodes(), [])

  const start = (parent: Id | null, input: { text: string; note?: string }, action: Parameters<typeof send>[0]) => {
    registry.set(error, null)
    registry.set(draft, { parent, input, text: "" })
    current.current = send(action)
  }
  const onSend = (text: string, note: boolean) => {
    const parent = line.at(-1)?.turn.id ?? null
    const input = note ? { text: "", note: text } : { text }
    start(parent, input, { kind: "act", parent, input })
  }
  const onSwipe = (n: Node) => start(n.turn.parent, n.turn.input, { kind: "swipe", node: n.turn.id })
  const onStop = async () => {
    const c = current.current
    if (!c) return
    c.stop()
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
        <Section key={n.turn.id} node={n} last={!d && i === line.length - 1} onSwipe={() => onSwipe(n)} />
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
