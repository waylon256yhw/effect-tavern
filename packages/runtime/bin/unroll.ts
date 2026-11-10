#!/usr/bin/env bun
// Reading instrument for SillyTavern cards (#31): unroll a V2/V3 card into the document ST's own assembly would
// produce, for a person or an agent to read. It reads a card and never writes one; it imports nothing from src/.
// Assembly rules follow docs/card-reading.md §1.
import { BunServices } from "@effect/platform-bun"
import { Cause, Console, Effect, Exit } from "effect"
import { Argument, Command, Flag } from "effect/cli"

type Raw = Record<string, any>
export type Block = {
  kind: string
  heading: string
  text: string
  entry?: { name: string; constant: boolean; position: string; order: number; depth?: number; role?: string }
}
export type Trigger = { name: string; order: number; keys: string[]; secondary: string[]; logic?: string }
export type Unrolled = {
  name: string
  spec: string
  blocks: Block[]
  triggers: Trigger[]
  disabled: Block[]
  macros: string[]
  extensions: string[]
}

const PNG = [137, 80, 78, 71, 13, 10, 26, 10]

/** A card file's bytes → the card JSON. PNG: the `ccv3` tEXt chunk if present, else `chara`; CRCs are not checked. */
export const parseCard = (bytes: Uint8Array): Raw => {
  if (!PNG.every((b, i) => bytes[i] === b)) return JSON.parse(new TextDecoder().decode(bytes))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const texts = new Map<string, string>()
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    if (type === "tEXt") {
      const nul = data.indexOf(0)
      texts.set(
        Buffer.from(data.subarray(0, nul)).toString("latin1"),
        Buffer.from(data.subarray(nul + 1)).toString("latin1"),
      )
    }
    if (type === "IEND") break
    at += 12 + length
  }
  const text = texts.get("ccv3") ?? texts.get("chara")
  if (text === undefined) throw new Error("no ccv3 or chara tEXt chunk in the PNG")
  return JSON.parse(Buffer.from(text, "base64").toString("utf8"))
}

// ST's extension numbers (world-info.js): position, role, selectiveLogic.
const positions = ["before_char", "after_char", "an_top", "an_bottom", "at_depth", "em_top", "em_bottom", "outlet"]
const roles = ["system", "user", "assistant"]
const logics = ["AND_ANY", "NOT_ALL", "NOT_ANY", "AND_ALL"]

// `card sort` places whole source paragraphs (split on blank lines), so a field keeps its own paragraphs; the heading
// is a paragraph of its own that sort never places.
const paragraph = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n")
    .trim()
const section = (heading: string, text: string) => [heading, paragraph(text)].filter(Boolean).join("\n\n")

/** ST's example parsing: force a leading <START>, split on it, prefix each block with the marker, drop line 0,
 *  open a message on a line starting `name:`; lines before the first speaker ride into the first message. */
export const examples = (raw: string, user: string, char: string) => {
  let s = raw.replace(/\r\n?/g, "\n").trim()
  if (!s) return []
  if (!s.startsWith("<START>")) s = `<START>\n${s}`
  return s
    .split(/<START>/i)
    .slice(1)
    .map((block) => {
      const out: { role: "example_user" | "example_assistant"; text: string }[] = []
      let lines: string[] = []
      let speaker: "example_user" | "example_assistant" | undefined
      const flush = () => {
        if (!speaker) return
        out.push({
          role: speaker,
          text: lines
            .join("\n")
            .replace(speaker === "example_user" ? `${user}:` : `${char}:`, "")
            .trim(),
        })
        lines = []
      }
      for (const line of `<START>\n${block.trim()}\n`.split("\n").slice(1)) {
        const next = line.startsWith(`${user}:`)
          ? "example_user"
          : line.startsWith(`${char}:`)
            ? "example_assistant"
            : undefined
        if (next && next !== speaker) {
          flush()
          speaker = next
        }
        lines.push(line)
      }
      flush()
      return out
    })
}

export const unroll = (card: Raw, user = "User"): Unrolled => {
  if (card.spec !== "chara_card_v2" && card.spec !== "chara_card_v3")
    throw new Error(`not a V2/V3 card (spec: ${card.spec ?? "none"}); V1 cards are not handled`)
  const data: Raw = card.data ?? {}
  const char = String(data.name ?? "")
  const macros = new Set<string>()
  const expand = (s: unknown) => {
    const out = (typeof s === "string" ? s : "").replace(/\{\{char\}\}/gi, char).replace(/\{\{user\}\}/gi, user)
    for (const m of out.matchAll(/\{\{[^{}]*\}\}/g)) macros.add(m[0])
    return out
  }
  const entries = ((data.character_book?.entries ?? []) as Raw[])
    .map((e, i) => {
      const ext: Raw = e.extensions ?? {}
      const position =
        typeof ext.position === "number"
          ? (positions[ext.position] ?? `position ${ext.position}`)
          : (e.position ?? "before_char")
      return {
        enabled: e.enabled !== false,
        meta: {
          name: String(e.comment || e.name || `#${e.id ?? i}`),
          constant: e.constant === true,
          position,
          order: Number(e.insertion_order ?? 100),
          ...(position === "at_depth" && {
            depth: Number(ext.depth ?? 4),
            role: roles[ext.role ?? 0] ?? String(ext.role),
          }),
        },
        selective: e.selective !== false,
        logic: logics[ext.selectiveLogic ?? 0] ?? String(ext.selectiveLogic),
        keys: ((e.keys ?? []) as unknown[]).map(String),
        secondary: ((e.secondary_keys ?? []) as unknown[]).map(String),
        content: e.content,
      }
    })
    // ST sorts activated entries by order and inserts so the highest order sits last, nearest the card text.
    .sort((a, b) => a.meta.order - b.meta.order)
  const entryBlock = (e: (typeof entries)[number]): Block => {
    const m = e.meta
    const where = m.position === "at_depth" ? `at_depth ${m.depth} ${m.role}` : m.position
    return {
      kind: "entry",
      heading: `${where} · ${m.name} (${m.constant ? "constant" : "selective"}, order ${m.order})`,
      text: expand(e.content),
      entry: m,
    }
  }
  const live = entries.filter((e) => e.enabled)
  const at = (...ps: string[]) => live.filter((e) => ps.includes(e.meta.position)).map(entryBlock)
  const field = (kind: string, value: unknown): Block[] =>
    typeof value === "string" && value.trim() ? [{ kind, heading: kind, text: expand(value) }] : []
  const depth = live
    .filter((e) => !["before_char", "after_char", "em_top", "em_bottom"].includes(e.meta.position))
    .sort((a, b) => (b.meta.depth ?? -1) - (a.meta.depth ?? -1) || a.meta.order - b.meta.order)
    .map(entryBlock)
  const blocks: Block[] = [
    ...field("system_prompt", data.system_prompt),
    ...at("before_char"),
    ...field("description", data.description),
    ...field("personality", data.personality),
    ...field("scenario", data.scenario),
    ...at("after_char"),
    ...at("em_top"),
    ...examples(expand(data.mes_example), user, char)
      .filter((ms) => ms.length)
      .map((ms, i) => ({
        kind: "mes_example",
        heading: `mes_example ${i + 1}`,
        text: ms.map((m) => `${m.role}: ${m.text}`).join("\n"),
      })),
    ...at("em_bottom"),
    ...field("first_mes", data.first_mes),
    ...((data.alternate_greetings ?? []) as unknown[]).flatMap((g, i) => field(`alternate_greetings[${i}]`, g)),
    ...depth,
    ...field("post_history_instructions", data.post_history_instructions),
  ]
  return {
    name: char,
    spec: card.spec,
    blocks,
    triggers: live
      .filter((e) => !e.meta.constant)
      .map((e) => ({
        name: e.meta.name,
        order: e.meta.order,
        keys: e.keys.map(expand),
        secondary: e.secondary.map(expand),
        ...(e.selective && e.secondary.length && { logic: e.logic }),
      })),
    disabled: entries.filter((e) => !e.enabled).map(entryBlock),
    macros: [...macros],
    extensions: Object.keys(data.extensions ?? {}),
  }
}

export const markdown = (u: Unrolled) =>
  [
    `# ${u.name}\n${u.spec}; extensions: ${u.extensions.join(", ") || "none"}`,
    ...u.blocks.map((b) => section(`## ${b.heading}`, b.text)),
    ...(u.triggers.length
      ? [
          `## triggers\n\n${u.triggers
            .map(
              (t) =>
                `- ${t.name} (order ${t.order}): ${t.keys.join(", ")}${t.secondary.length ? `; secondary ${t.secondary.join(", ")}${t.logic ? ` (${t.logic})` : ""}` : ""}`,
            )
            .join("\n")}`,
        ]
      : []),
    ...(u.disabled.length ? ["## disabled", ...u.disabled.map((b) => section(`### ${b.heading}`, b.text))] : []),
    `not expanded: ${u.macros.join(" ") || "none"}`,
  ].join("\n\n")

const cli = Command.make(
  "unroll",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("a SillyTavern card: PNG with a chara/ccv3 chunk, or V2/V3 JSON"),
    ),
    user: Flag.String("user").pipe(Flag.withDescription("the name {{user}} expands to"), Flag.withDefault("User")),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
  },
  ({ file, user, json }) =>
    Effect.gen(function* () {
      const u = yield* Effect.tryPromise({
        try: async () => unroll(parseCard(await Bun.file(file).bytes()), user),
        catch: (e) => (e as Error).message,
      })
      yield* Console.log(json ? JSON.stringify(u, null, 2) : markdown(u))
    }),
).pipe(Command.withDescription("Print a SillyTavern card in ST's assembly order, with its trigger list"))

if (import.meta.main) {
  const exit = await Effect.runPromiseExit(
    Command.runWith(cli, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.tapError((e) => (typeof e === "string" ? Console.error(e) : Effect.void)),
      Effect.provide(BunServices.layer),
    ),
  )
  if (Exit.isFailure(exit)) {
    if (Cause.hasDies(exit.cause)) console.error(Cause.pretty(exit.cause))
    process.exitCode = 1
  }
}
