// Stateless host operations: candidates are returned to the author, never installed here.
import { object, type Model } from "@effect-tavern/provider"
import { decodeCard, Card } from "@effect-tavern/runtime/src/card.ts"
import { checkCard } from "@effect-tavern/runtime/support/author.ts"
import {
  applyCompile,
  applySort,
  CompileOutput,
  SortOutput,
  ReviewOutput,
  selectedText,
  cardPaths,
} from "@effect-tavern/runtime/support/workshop.ts"
import { Effect, Schema } from "effect"

const CompileRequest = Schema.Struct({ card: Card, select: Schema.Array(Schema.String), intent: Schema.String })
const SortRequest = Schema.Struct({
  card: Card,
  source: Schema.String,
  paragraphs: Schema.optionalKey(Schema.Array(Schema.String)),
})
const ReviewRequest = Schema.Struct({ card: Card })
// Compile sees selected prose and mechanical structure, never the author's rubric or unrelated prose.
const mechanical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(mechanical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (
        ["text", "label", "group", "title", "summary", "guard", "lexicon", "names", "source", "version"].includes(key)
      )
        return []
      if (key === "judge") return [["judged", true]]
      if (key === "layers" && Array.isArray(item)) return [[key, item.map(() => "")]]
      return [[key, mechanical(item)]]
    }),
  )
}
const prompts = {
  compile:
    "Compile mechanical increments and bindings from selected prose and intent; judged:true creates an empty author rubric, and slots are created only when explicitly requested.",
  sort: "Place whole paragraph indices at frame.<id>, fiction.<new-id>, greetings[n], or lore.<id>.layers[n]; append only and combine paragraphs in source order.",
  review: "Report consistency warnings at existing card paths.",
}
export const author = (model: () => Model) => {
  const ask = async <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
    schema: S,
    operation: keyof typeof prompts,
    input: unknown,
  ) => {
    const result = await Effect.runPromise(
      object(model(), schema, [
        {
          role: "system",
          content: prompts[operation],
        },
        { role: "user", content: JSON.stringify(input) },
      ]),
    )
    return Schema.decodeUnknownSync(schema)(result.value)
  }
  return {
    compile: async (value: unknown) => {
      const input = Schema.decodeUnknownSync(CompileRequest)(value)
      const card = decodeCard(input.card)
      if (!input.select.length || !input.intent.trim()) throw new Error("compile requires selected prose and intent")
      const selected = input.select.map((path) => ({ path, text: selectedText(card, path) }))
      const prompt = { card: mechanical(card), selected, intent: input.intent }
      let output = await ask(CompileOutput, "compile", prompt)
      let candidate = applyCompile(card, output)
      let diagnostics = checkCard(Bun.YAML.stringify(candidate)).diagnostics
      const repair = diagnostics.filter((d) => d.level === "error" && d.rule !== "empty-text")
      if (repair.length) {
        output = await ask(CompileOutput, "compile", { ...prompt, previous: output, diagnostics: repair })
        candidate = applyCompile(card, output)
        diagnostics = checkCard(Bun.YAML.stringify(candidate)).diagnostics
      }
      return { candidate, diagnostics }
    },
    sort: async (value: unknown) => {
      const input = Schema.decodeUnknownSync(SortRequest)(value)
      const card = decodeCard(input.card)
      const paragraphs =
        input.paragraphs ?? input.source.split(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/).filter((p) => p.trim())
      const placements = await ask(SortOutput, "sort", {
        card: mechanical(card),
        paragraphs,
        writableFrame: card.frame.filter((f) => f.text === undefined || f.text === "").map((f) => f.id),
      })
      return { candidate: applySort(card, paragraphs, placements), placements }
    },
    review: async (value: unknown) => {
      const { card } = Schema.decodeUnknownSync(ReviewRequest)(value)
      const paths = cardPaths(card)
      const diagnostics = await ask(ReviewOutput, "review", { card })
      return { diagnostics: diagnostics.filter((d) => paths.has(d.path)) }
    },
  }
}
export type Author = ReturnType<typeof author>
