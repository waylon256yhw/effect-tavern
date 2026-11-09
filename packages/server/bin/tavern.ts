#!/usr/bin/env bun
import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { authorCommands, runCli } from "@effect-tavern/runtime/bin/card.ts"
import { checkCard } from "@effect-tavern/runtime/support/author.ts"
import { decodeCard } from "@effect-tavern/runtime/src/card.ts"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { connect, type CliHost } from "../src/cli-host.ts"
import { start } from "../src/start.ts"
import { play } from "../src/play.ts"

const url = Flag.String("url").pipe(Flag.optional)
const json = Flag.Boolean("json").pipe(Flag.withDefault(false))
const task = (f: () => Promise<void>) => Effect.tryPromise({ try: f, catch: (e) => String(e) })
const withHost = async (url: Option.Option<string>, work: (host: CliHost) => Promise<void>, fakeModel?: boolean) => {
  const host = await connect(Option.getOrUndefined(url), fakeModel)
  try {
    await work(host)
  } finally {
    host.close()
  }
}
const install = Command.make("install", { file: Argument.String("file"), url, json }, ({ file, url, json }) =>
  task(async () => {
    const source = readFileSync(file, "utf8")
    const report = checkCard(source)
    for (const d of report.diagnostics)
      console.error(`${d.level} ${d.path}: ${d.message}${d.hint ? `\n  hint: ${d.hint}` : ""}`)
    if (report.diagnostics.some((d) => d.level === "error")) throw new Error("card check failed")
    const card = decodeCard(Bun.YAML.parse(source))
    await withHost(url, async (host) => {
      await host.install(card)
    })
    console.log(json ? JSON.stringify({ id: card.id, installed: true }) : `Installed ${card.id}`)
  }),
)
const storyId = Argument.Int("id")
const remove = (name: "delete" | "drop") =>
  Command.make(name, { url, id: storyId, json }, ({ url, id, json }) =>
    task(() =>
      withHost(url, async (host) => {
        await host.drop(id)
        console.log(json ? JSON.stringify({ id, deleted: true }) : `Deleted ${id}`)
      }),
    ),
  )
const story = Command.make("story").pipe(
  Command.withSubcommands([
    Command.make("list", { url, json }, ({ url, json }) =>
      task(() =>
        withHost(url, async (host) => {
          const rows = await host.list()
          console.log(
            json
              ? JSON.stringify(rows)
              : rows.map((r) => `${r.id}\t${r.card}\t${r.title ?? ""}\t${r.turns} turns`).join("\n"),
          )
        }),
      ),
    ),
    Command.make("new", { url, card: Argument.String("card"), json }, ({ url, card, json }) =>
      task(() =>
        withHost(url, async (host) => {
          const id = await host.create(card)
          console.log(json ? JSON.stringify({ id }) : id)
        }),
      ),
    ),
    Command.make("show", { url, id: storyId, json }, ({ url, id, json }) =>
      task(() =>
        withHost(url, async (host) => {
          const timeline = await host.timeline(id)
          console.log(
            json
              ? JSON.stringify(timeline)
              : [
                  `Story ${id}, head ${timeline.head ?? "root"}`,
                  ...timeline.nodes.map((n) => `#${n.id} ← ${n.parent ?? "root"} [${n.end}]\n${n.prose}`),
                ].join("\n\n"),
          )
        }),
      ),
    ),
    remove("delete"),
    remove("drop"),
    Command.make(
      "export",
      { url, id: storyId, json, format: Flag.Literals("format", ["md", "json"]).pipe(Flag.optional) },
      ({ url, id, format, json }) =>
        task(() =>
          withHost(url, async (host) => {
            if (json && Option.contains(format, "md")) throw new Error("--json conflicts with --format md")
            console.log(await host.export(id, json ? "json" : Option.getOrElse(format, () => "md" as const)))
          }),
        ),
    ),
  ]),
)
const playing = Command.make(
  "play",
  {
    target: Argument.String("card-or-story"),
    card: Flag.Boolean("card").pipe(
      Flag.withDefault(false),
      Flag.withDescription("treat target as a card id, including numeric ids"),
    ),
    url,
    model: Flag.Literals("model", ["fake"]).pipe(Flag.optional),
    input: Flag.String("input").pipe(Flag.optional),
    jsonl: Flag.Boolean("jsonl").pipe(Flag.withDefault(false)),
  },
  ({ target, card, url, input, jsonl, model }) =>
    task(() =>
      withHost(
        url,
        (host) => play(host, target, { input: Option.getOrUndefined(input), jsonl, card }),
        Option.isSome(model) ? true : undefined,
      ),
    ),
)
const serving = Command.make(
  "serve",
  {
    port: Flag.Int("port").pipe(Flag.withDefault(Number(process.env["PORT"] ?? 7777))),
    headless: Flag.Boolean("headless").pipe(Flag.withDefault(false)),
  },
  ({ port, headless }) =>
    task(() =>
      start({ port, dist: headless ? undefined : fileURLToPath(new URL("../../client/dist/", import.meta.url)) }),
    ),
)
const cli = Command.make("tavern").pipe(
  Command.withSubcommands([
    Command.make("card").pipe(Command.withSubcommands([...authorCommands, install])),
    story,
    playing,
    serving,
  ]),
)
await runCli(cli)
