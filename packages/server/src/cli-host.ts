// Only the operations the terminal uses. No retry policy or independent client package.
import { Effect, Stream } from "effect"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import type { ActiveContextView, TimelineNode, TurnDetail } from "@effect-tavern/runtime/src/projection.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import type { Library, PublicEvent } from "./library.ts"
import type { Draft } from "./turn.ts"
import { backup, markdown } from "./export.ts"
import { openHost } from "./host.ts"

export type CliEvent = PublicEvent | { kind: "attach"; phase: string | null; draft: Draft | null }
type Emit = (event: CliEvent) => void
export interface CliHost {
  install(card: Card): Promise<void>
  list(): Promise<ReturnType<Library["stories"]["list"]>>
  create(card: string): Promise<number>
  drop(id: number): Promise<void>
  export(id: number, format: "md" | "json"): Promise<string>
  timeline(id: number): Promise<{ head: number | null; nodes: readonly TimelineNode[] }>
  context(id: number, node: number | null): Promise<ActiveContextView>
  detail(id: number, node: number): Promise<TurnDetail>
  trace(id: number, node: number): Promise<unknown>
  input(id: number): Promise<"act" | "note">
  submit(id: number, action: Action, emit: Emit): Promise<void>
  attach(id: number, emit: Emit): Promise<void>
  stop(id: number): Promise<unknown>
  close(): void
}

// SSE frames may be split at any byte; TextDecoderStream also preserves split UTF-8 characters.
export const readEvents = async (response: Response, emit: Emit) => {
  if (response.status === 204) return
  if (!response.body) throw new Error("missing event stream")
  let buffer = ""
  let event = ""
  let data: string[] = []
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk
    let end: number
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, "")
      buffer = buffer.slice(end + 1)
      if (!line) {
        if (data.length) {
          const value = JSON.parse(data.join("\n"))
          emit(event === "attach" ? { ...value, kind: "attach" } : value)
        }
        event = ""
        data = []
      } else if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""))
    }
  }
  if (buffer.trim() || data.length) throw new Error("incomplete event stream")
}

export const connect = async (url?: string, fakeModel?: boolean): Promise<CliHost> => {
  if (!url) {
    const { lib, data } = await openHost(fakeModel)
    const drain = (stream: Stream.Stream<PublicEvent>, emit: Emit) =>
      Effect.runPromise(Stream.runForEach(stream, (e) => Effect.sync(() => emit(e))))
    return {
      install: async (card) => {
        lib.cards.put(card)
      },
      list: async () => lib.stories.list(),
      create: async (card) => lib.stories.create(card),
      drop: async (id) => {
        lib.stories.del(id)
      },
      export: async (id, format) => {
        const story = lib.stories.export(id)
        if (!story) throw new Error(`no story ${id}`)
        return format === "md" ? markdown(story) : JSON.stringify(backup(story), null, 2)
      },
      timeline: async (id) => lib.session(id).timeline(),
      context: async (id, node) => lib.session(id).activeContext(node),
      detail: async (id, node) => lib.session(id).detail(node),
      trace: async (id, node) => lib.trace(id, node, true),
      input: async (id) => lib.session(id).meta.input,
      submit: (id, action, emit) => drain(lib.submit(id, action), emit),
      attach: async (id, emit) => {
        const at = lib.attach(id)
        if (at) {
          emit({ kind: "attach", phase: at.phase, draft: at.draft })
          await drain(at.events, emit)
        }
      },
      stop: async (id) => lib.stop(id),
      close: () => data.close(),
    }
  }
  if (fakeModel) throw new Error("--model fake applies to local play; configure MODEL on the remote server")
  const base = url.replace(/\/$/, "").replace(/\/api$/, "") + "/api"
  const request = async (path: string, method = "GET", body?: unknown, story?: number) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(story === undefined ? {} : { "x-tavern-story": String(story) }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    return response
  }
  const json = async <T>(path: string, method = "GET", body?: unknown, story?: number): Promise<T> =>
    (await request(path, method, body, story)).json() as Promise<T>
  return {
    install: async (card) => {
      await request(`/cards/${encodeURIComponent(card.id)}`, "PUT", card)
    },
    list: async () => (await json<{ stories: Awaited<ReturnType<CliHost["list"]>> }>("/stories")).stories,
    create: async (card) => (await json<{ current: number }>("/stories", "POST", { card })).current,
    drop: async (id) => {
      await request(`/stories/${id}`, "DELETE")
    },
    export: async (id, format) => (await request(`/stories/${id}/export.${format}`)).text(),
    timeline: (id) => json("/nodes", "GET", undefined, id),
    context: (id, node) => json(`/context?node=${node ?? "root"}`, "GET", undefined, id),
    detail: (id, node) => json(`/nodes/${node}/detail`, "GET", undefined, id),
    trace: (id, node) => json(`/nodes/${node}/trace`, "GET", undefined, id),
    input: async (id) => (await json<{ input: "act" | "note" }>("/card", "GET", undefined, id)).input,
    submit: async (id, action, emit) => readEvents(await request("/", "POST", action, id), emit),
    attach: async (id, emit) => readEvents(await request("/turn", "GET", undefined, id), emit),
    stop: (id) => json("/stop", "POST", undefined, id),
    close: () => {},
  }
}
