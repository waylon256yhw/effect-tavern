// The scripted narrator's reader: a fake call's stage document (src/request.ts writes it) read back into the fields the
// scripted models answer from, and a well-formed answer per stage. loop.ts, the dev server's MODEL=fake and the server
// tests answer through it, each overriding only what its scenario needs; test/request.ts asserts it against the writer.
import { fakeText, type FakeCall, type FakeReply } from "@effect-tavern/provider"
import type { Phase } from "../src/session.ts"

export interface StageDoc {
  phase: Phase
  subject: string // the unwrapped <input> / <draft> / <scene> text, or the last message's text on narrate
  open: string[] // Open: ids
  soFar: string[] // decide's So far: events
  rules: string[] // Rule: lines
  known: string[] // record's Known: items
  questions: { id: string; options: string[] }[] // record's readout questions, option ids
  asked: string[] // record's product asks
  tools: string[]
  targets: [id: string, sentence: string][] // polish's <target> marks
}

const after = (lines: readonly string[], label: string) => lines.find((l) => l.startsWith(label))?.slice(label.length)
const head = (s: string, sep: string) => s.slice(0, s.indexOf(sep)).trim()
const unwrap = (s: string) =>
  /^<(?:input|draft|scene)>\n([\s\S]*?)\n<\/(?:input|draft|scene)>(?:\n|$)/.exec(s)?.[1] ?? s

export const readStage = (o: FakeCall): StageDoc => {
  const msgs = o.prompt.map(fakeText)
  const last = msgs.at(-1) ?? ""
  const lines = msgs.flatMap((m) => m.split("\n"))
  const facts = msgs.find((m) => m.startsWith("Known: "))?.split("\n") ?? []
  const recordTask = last.split("\n</scene>\n\n")[1]?.split("\nQuestions: ")[0]?.split("\n") ?? []
  const qs =
    msgs
      .find((m) => m.includes("\nQuestions: "))
      ?.split("\nQuestions: ")[1]!
      .split("\n") ?? []
  const tools = o.tools?.filter((t) => t.type === "function").map((t) => t.name) ?? []
  return {
    tools,
    subject: unwrap(last),
    phase: (tools.includes("finish_record")
      ? "record"
      : tools.includes("search_context")
        ? "lookup"
        : (o.responseFormat?.type === "json" && o.responseFormat.name) || "narrate") as Phase,
    open: (after(lines, "Open: ")?.split(" | ") ?? []).map((e) => head(e, "=")),
    soFar:
      after(lines, "So far: ")
        ?.split(",")
        .filter((e) => e !== "-") ?? [],
    rules: lines.filter((l) => l.startsWith("Rule: ")).map((l) => l.slice(6)),
    known: after(facts, "Known: ")?.split("; ").filter(Boolean) ?? [],
    questions: qs.flatMap((l) => {
      const m = /^(\S+): .*\[(.*)\]$/.exec(l)
      return m ? [{ id: m[1]!, options: m[2]!.split(" | ").map((x) => head(x, ":")) }] : []
    }),
    asked: recordTask.flatMap((l) => /^(\w+): /.exec(l)?.[1] ?? []),
    targets: [...last.matchAll(/<target id="(hit-\d+)"[^>]*>(.*?)<\/target>/g)].map(
      ([, id, s]) => [id!, s!] as [string, string],
    ),
  }
}

/** A well-formed answer for the stage, in `fake()`'s reply shape: lookup reads nothing, decide ends, direct opens what
 *  the gate offered, check is clean, polish echoes every target, record answers each question with its first option and
 *  fills each asked product from `canned`, narrate says hello. */
export const defaultAnswer = (doc: StageDoc, canned: Record<string, unknown> = {}): FakeReply => {
  const json = (v: unknown) => ({ text: JSON.stringify(v) })
  switch (doc.phase) {
    case "lookup":
      return { text: "No additional context needed." }
    case "decide":
      return json({ next: "end" })
    case "direct":
      return json({ must: [], may: doc.open, tone: "quiet" })
    case "check":
      return json({ fired: [], violated: [] })
    case "polish":
      return json(Object.fromEntries(doc.targets))
    case "record": {
      const cross = new Set(doc.tools.filter((t) => t.startsWith("read_")).map((t) => t.slice(5)))
      const products = Object.fromEntries(doc.asked.filter((id) => !cross.has(id)).map((id) => [id, canned[id]]))
      const calls: NonNullable<FakeReply["toolCalls"]>[number][] = []
      for (const id of cross) {
        const value = canned[id]
        if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue
        if (doc.tools.includes(`insert_${id}`))
          for (const data of value as unknown[]) calls.push({ name: `insert_${id}`, input: { data } })
        else calls.push({ name: `replace_${id}`, input: { value } })
      }
      const answers = canned.answers ?? Object.fromEntries(doc.questions.map((q) => [q.id, q.options[0]]))
      calls.push({ name: "finish_record", input: doc.questions.length ? { ...products, answers } : products })
      return { text: "", toolCalls: calls }
    }
    case "narrate":
      return { text: "hello world" }
  }
}

/** Scripted native retrieval, used by integration fixtures. Real tool output supplies IDs. */
export const lookupAnswer = (o: FakeCall, query?: string): FakeReply => {
  const tool = o.prompt.findLast((m) => m.role === "tool")
  if (tool?.role === "tool") {
    const result = tool.content.at(-1)!
    if (
      result.type === "tool-result" &&
      result.toolName === "search_context" &&
      "value" in result.output &&
      typeof result.output.value === "string"
    ) {
      const value = JSON.parse(result.output.value as string)
      return {
        text: "",
        toolCalls: [
          { name: "read_context", input: { refs: value.value.map((r: { resourceId: string }) => r.resourceId) } },
        ],
      }
    }
    return { text: "Context ready." }
  }
  return query
    ? { text: "", toolCalls: [{ name: "search_context", input: { query } }] }
    : { text: "No additional context needed." }
}
