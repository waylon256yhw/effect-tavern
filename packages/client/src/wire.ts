// The seam to packages/server: `GET /card` and `GET /nodes` are the snapshot, `POST /` is one action whose events come back as SSE.
// Closing the response is the stop (before the first delta it withdraws the turn, after it the prose halts).
import type { Action, Node } from "@effect-tavern/runtime/src/session.ts"
import { apply, card, load, registry, type CardView, type Wire } from "./store.ts"

const base = "/api"

export const fetchNodes = async (): Promise<void> => load((await (await fetch(`${base}/nodes`)).json()) as Node[])
export const fetchCard = async (): Promise<void> =>
  registry.set(card, (await (await fetch(`${base}/card`)).json()) as CardView)

/** Sends one action; returns the stop. */
export const send = (action: Action): (() => void) => {
  const ac = new AbortController()
  void (async () => {
    try {
      const res = await fetch(base, { method: "POST", body: JSON.stringify(action), signal: ac.signal })
      if (!res.ok || !res.body) return apply({ kind: "error", message: `${res.status} ${await res.text()}` })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const ev = /^event: (.*)$/m.exec(block)?.[1]
          const data = /^data: (.*)$/m.exec(block)?.[1]
          if (ev && data) apply({ ...(JSON.parse(data) as object), kind: ev } as Wire)
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) apply({ kind: "error", message: String(e) })
    }
  })()
  return () => ac.abort()
}
