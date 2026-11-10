import { createInterface } from "node:readline"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import type { CliEvent, CliHost } from "./cli-host.ts"

const idOf = (text: string) => {
  if (!/^\d+$/.test(text)) throw new Error(`expected node id, got ${text}`)
  return Number(text)
}
/** A field value as typed: JSON when it parses (`3`, `true`, `"a b"`), the raw text otherwise. */
const scalar = (raw: string) => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    value = raw
  }
  if (!["number", "boolean", "string"].includes(typeof value)) throw new Error("field value must be scalar")
  return value as string | number | boolean
}
const help =
  "/greet [index], /act text, /note text, /pin resource-id, /set field=value, /swipe [node], /reword [note], /checkout node|root, /tree, /context, /detail [node], /inspect [node], /attach, /stop, /quit"

export const play = async (
  host: CliHost,
  target: string,
  options: {
    input?: string
    jsonl: boolean
    card?: boolean
    // a new story's opening (the greet action): which greeting, `start` fields set, a note to the narrator
    greeting?: number
    set?: Record<string, string>
    note?: string
  },
) => {
  const numeric = /^\d+$/.test(target) && !options.card
  const opens = options.greeting !== undefined || options.set !== undefined || options.note !== undefined
  if (numeric && opens) throw new Error("--greeting, --set and --note open a new story: pass a card")
  if (numeric && !(await host.list()).some((s) => s.id === Number(target))) throw new Error(`no story ${target}`)
  const story = numeric ? Number(target) : await host.create(target)
  let head = (await host.timeline(story)).head
  const channel = await host.input(story)
  const emit = (event: CliEvent) => {
    if (event.kind === "change") head = event.head
    if (options.jsonl) console.log(JSON.stringify(event))
    else if (event.kind === "stage") console.error(`[${event.phase}]`)
    else if (event.kind === "delta" && event.part.type === "text-delta") process.stdout.write(event.part.text)
    else if (event.kind === "attach" && event.draft?.text) process.stdout.write(event.draft.text)
    else if (event.kind === "error") console.error(event.message)
  }
  const attach = async () => {
    let error: string | undefined
    await host.attach(story, (e) => {
      emit(e)
      if (e.kind === "error") error = e.message
    })
    head = (await host.timeline(story)).head
    if (error) throw new Error(error)
  }
  const send = async (action: Action) => {
    let error: string | undefined
    let streamed = false // a narrated opening already wrote its prose
    await host.submit(story, action, (e) => {
      emit(e)
      if (e.kind === "error") error = e.message
      if (e.kind === "delta") streamed = true
    })
    if (!options.jsonl) {
      console.log()
      if (head !== null) {
        const detail = await host.detail(story, head)
        for (const f of detail.fieldChanges) console.log(`${f.path}: ${f.was} → ${f.now}`)
        for (const c of detail.checks) console.log(`${c.action}: ${c.roll} / ${c.chance} ${c.hit ? "hit" : "miss"}`)
        if (detail.products.options) console.log(JSON.stringify(detail.products.options))
        if (action.kind === "greet" && !streamed)
          console.log((await host.timeline(story)).nodes.find((n) => n.id === head)?.prose ?? "")
      }
    }
    if (error) throw new Error(error)
  }
  const node = (value?: string) => {
    if (value) return idOf(value)
    if (head === null) throw new Error("story has no head")
    return head
  }
  const show = (kind: string, value: unknown) =>
    console.log(JSON.stringify(options.jsonl ? { kind, value } : value, null, options.jsonl ? undefined : 2))
  const line = async (text: string) => {
    if (!text.trim()) return
    if (!text.startsWith("/"))
      return send({ kind: "act", input: channel === "note" ? { text: "", note: text } : { text } })
    const [command, ...parts] = text.split(" ")
    const rest = parts.join(" ").trim()
    switch (command) {
      case "/help":
        console.error(help)
        return
      case "/greet":
        return send({ kind: "greet", greeting: rest ? idOf(rest) : 0 })
      case "/act":
        return send({ kind: "act", input: { text: rest } })
      case "/note":
        return send({ kind: "act", input: { text: "", note: rest } })
      case "/pin":
        return send({ kind: "act", input: { text: "", invoke: [rest] } })
      case "/set": {
        const split = rest.indexOf("=")
        if (split < 1) throw new Error("use /set field=value (strings may be JSON quoted)")
        return send({
          kind: "setField",
          node: node(),
          effects: [{ path: rest.slice(0, split), set: scalar(rest.slice(split + 1)) }],
        })
      }
      case "/swipe":
        return send({ kind: "swipe", node: node(rest) })
      case "/reword":
        return send({ kind: "reword", node: node(), note: rest || undefined })
      case "/checkout":
        return send({ kind: "checkout", node: rest === "root" ? null : idOf(rest) })
      case "/tree":
        show("tree", await host.timeline(story))
        return
      case "/context":
        show("context", await host.context(story, head))
        return
      case "/detail":
        show("detail", await host.detail(story, node(rest)))
        return
      case "/inspect":
        show("inspect", await host.trace(story, node(rest)))
        return
      case "/attach":
        return attach()
      case "/stop":
        show("stop", await host.stop(story))
        return
      default:
        throw new Error(`unknown command ${command}; /help lists commands`)
    }
  }
  console.error(`story ${story}`)
  if (options.jsonl) console.log(JSON.stringify({ kind: "story", id: story }))
  const stop = () => {
    void host.stop(story).catch((e) => console.error(String(e)))
  }
  process.on("SIGINT", stop)
  try {
    await attach()
    if (opens)
      await send({
        kind: "greet",
        ...(options.greeting !== undefined && { greeting: options.greeting }),
        ...(options.set && {
          opening: Object.entries(options.set).map(([path, v]) => ({ path, set: scalar(v) })),
        }),
        ...(options.note !== undefined && { note: options.note }),
      })
    if (options.input !== undefined) return await line(options.input)
    const interactive = Boolean(process.stdin.isTTY)
    const terminal = interactive && !options.jsonl
    const rl = createInterface({ input: process.stdin, terminal: false })
    // Serialize regular lines; stop bypasses the queue so it can interrupt the active turn.
    let pending = Promise.resolve()
    let failure: { error: unknown } | undefined
    rl.on("SIGINT", stop)
    rl.on("line", (text) => {
      if (failure) return
      if (text === "/quit") {
        rl.close()
        return
      }
      if (interactive && text === "/stop") {
        stop()
        return
      }
      pending = pending
        .then(() => (failure ? undefined : line(text)))
        .catch((e) => {
          if (interactive) {
            console.error(String(e))
            process.exitCode = 1
          } else {
            failure = { error: e }
            rl.close()
          }
        })
        .then(() => {
          if (terminal) process.stderr.write("> ")
        })
    })
    if (terminal) {
      console.error(help)
      process.stderr.write("> ")
    }
    await new Promise<void>((resolve) => rl.once("close", resolve))
    await pending
    if (failure) throw failure.error
  } finally {
    process.off("SIGINT", stop)
  }
}
