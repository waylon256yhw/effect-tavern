// The scripted narrator's reader: a fake call's stage document (src/request.ts writes it) read back into the fields the
// scripted models answer from, and a well-formed answer per stage. loop.ts, the dev server's MODEL=fake and the server
// tests answer through it, each overriding only what its scenario needs; test/request.ts asserts it against the writer.
import { fakeText, type FakeCall } from "@effect-tavern/provider"
import type { Phase } from "../src/session.ts"

export interface StageDoc {
  phase: Phase
  open: string[] // Open: ids
  index: [id: string, hook: string][] // lookup's Index: entries
  soFar: string[] // decide's So far: events
  rules: string[] // Rule: lines
  known: string[] // record's Known: items
  questions: { id: string; options: string[] }[] // record's readout questions, option ids
  asked: string[] // record's product asks
  targets: [id: string, sentence: string][] // polish's <target> marks
}

const after = (lines: readonly string[], label: string) => lines.find((l) => l.startsWith(label))?.slice(label.length)
const head = (s: string, sep: string) => s.slice(0, s.indexOf(sep)).trim()

export const readStage = (o: FakeCall): StageDoc => {
  const msgs = o.prompt.map(fakeText)
  const lines = msgs.flatMap((m) => m.split("\n"))
  const facts = msgs.find((m) => m.startsWith("Known: "))?.split("\n") ?? [] // record's Known / Current / asks message
  const qs =
    msgs
      .find((m) => m.includes("\nQuestions: "))
      ?.split("\nQuestions: ")[1]!
      .split("\n") ?? []
  return {
    phase: ((o.responseFormat?.type === "json" && o.responseFormat.name) || "narrate") as Phase,
    open: (after(lines, "Open: ")?.split(" | ") ?? []).map((e) => head(e, "=")),
    // an entry is `id=hook`; a hook may hold ", ", so an entry starts only where an `id=` follows
    index: (after(lines, "Index: ")?.split(/, (?=[^\s,=]+=)/) ?? []).map((e) => [
      head(e, "="),
      e.slice(e.indexOf("=") + 1),
    ]),
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
    asked: facts.flatMap((l) => /^(\w+): /.exec(l)?.[1] ?? []).filter((id) => id !== "Known" && id !== "Current"),
    targets: [...(msgs.at(-1) ?? "").matchAll(/<target id="(hit-\d+)"[^>]*>(.*?)<\/target>/g)].map(
      ([, id, s]) => [id!, s!] as [string, string],
    ),
  }
}

/** A well-formed answer for the stage, in `fake()`'s reply shape: lookup reads nothing, decide ends, direct opens what
 *  the gate offered, check is clean, polish echoes every target, record answers each question with its first option and
 *  fills each asked product from `canned`, narrate says hello. */
export const defaultAnswer = (doc: StageDoc, canned: Record<string, unknown> = {}): { text: string } => {
  const json = (v: unknown) => ({ text: JSON.stringify(v) })
  switch (doc.phase) {
    case "lookup":
      return json({ read: [] })
    case "decide":
      return json({ next: "end" })
    case "direct":
      return json({ must: [], may: doc.open, tone: "quiet" })
    case "check":
      return json({ fired: [], violated: [] })
    case "polish":
      return json(Object.fromEntries(doc.targets))
    case "record": {
      const products = Object.fromEntries(doc.asked.map((id) => [id, canned[id]]))
      const answers = Object.fromEntries(doc.questions.map((q) => [q.id, q.options[0]]))
      return json(doc.questions.length ? { ...products, answers } : products)
    }
    case "narrate":
      return { text: "hello world" }
  }
}
