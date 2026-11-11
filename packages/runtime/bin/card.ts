#!/usr/bin/env bun
// Offline authoring command tree and I/O; pure preview lives in src/view.ts.
import { BunServices } from "@effect/platform-bun"
import { Cause, Console, Effect, Exit, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { readFileSync, writeFileSync } from "node:fs"
import { checkCard, scaffold, templates } from "../support/author.ts"
import { runScenario } from "../support/scenario.ts"
import { stages, view } from "../src/view.ts"
import { loadCard, player, readCard, cardNames } from "../support/cards.ts"

const card = Argument.String("card").pipe(
  Argument.withDescription("a template card by name (wuxia, yandao, ri, banxing), or a path to a .yaml card"),
)
const load = (name: string) =>
  Effect.tryPromise({
    try: async () => (cardNames.includes(name) ? loadCard(name) : readCard(name)),
    catch: (e) => (e as Error).message,
  })

const json = Flag.Boolean("json").pipe(Flag.withDefault(false))
const attempt = <A>(f: () => A) => Effect.try({ try: f, catch: (e) => String(e) })
const check = Command.make("check", { card, json }, ({ card: name, json }) =>
  Effect.gen(function* () {
    const report = yield* attempt(() =>
      readFileSync(cardNames.includes(name) ? new URL(`../cards/${name}.yaml`, import.meta.url) : name, "utf8"),
    ).pipe(
      Effect.match({
        onSuccess: checkCard,
        onFailure: (message): ReturnType<typeof checkCard> => ({
          diagnostics: [{ rule: "io", level: "error", path: name, message }],
          fields: [],
          fieldLines: [],
          greetings: [],
          sections: [],
          total: 0,
        }),
      }),
    )
    if (json) yield* Console.log(JSON.stringify(report))
    else {
      for (const d of report.diagnostics)
        yield* Console.log(`${d.level} ${d.rule} ${d.path}: ${d.message}${d.hint ? `\n    hint: ${d.hint}` : ""}`)
      for (const line of [...report.fieldLines, ...report.greetings]) yield* Console.log(line)
      for (const section of report.sections.filter((s) => s.tokens))
        yield* Console.log(`${section.name} ~${section.tokens} tokens`)
      yield* Console.log(`narrate document ~${report.total} tokens`)
    }
    if (report.diagnostics.some((d) => d.level === "error")) process.exitCode = 1
  }),
)
const init = Command.make(
  "init",
  {
    id: Argument.String("id"),
    template: Flag.Literals("template", templates).pipe(Flag.withDefault("chat")),
  },
  ({ id, template }) =>
    Effect.gen(function* () {
      yield* attempt(() => writeFileSync(`${id}.yaml`, scaffold(id, template), { flag: "wx" }))
      yield* Console.log(`Created ${id}.yaml`)
    }),
)
const test = Command.make(
  "test",
  {
    card,
    scenario: Argument.String("scenario").pipe(Argument.optional),
  },
  ({ card: name, scenario }) =>
    Effect.gen(function* () {
      const c = yield* load(name)
      const value = yield* attempt(() =>
        Option.isSome(scenario) ? Bun.YAML.parse(readFileSync(scenario.value, "utf8")) : undefined,
      )
      const results = yield* Effect.tryPromise({ try: () => runScenario(c, value), catch: (e) => String(e) })
      yield* Console.log(`PASS ${results.length} step(s), zero model tokens`)
    }),
)

const show = Command.make(
  "view",
  {
    card,
    json,
    events: Flag.String("events").pipe(Flag.optional),
    pin: Flag.String("pin").pipe(Flag.optional),
    persona: Flag.String("persona").pipe(Flag.optional),
    state: Flag.KeyValuePair("state").pipe(
      Flag.withDescription("field=value, set after the greeting; repeat the flag for more fields"),
      Flag.optional,
    ),
    greeting: Flag.Int("greeting").pipe(Flag.withDescription("apply greetings[n].do first (0-based)"), Flag.optional),
    stage: Flag.Literals("stage", stages).pipe(Flag.withDefault("narrate")),
    lore: Flag.Boolean("lore").pipe(
      Flag.withDescription("list every lore entry, the fully unlocked ones with no window included"),
      Flag.withDefault(false),
    ),
  },
  ({ card: name, state, greeting, stage, events, pin, persona, json, lore }) =>
    Effect.gen(function* () {
      const c = yield* load(name)
      const v = yield* Effect.try({
        try: () =>
          view(
            c,
            { ...player, ...(Option.isSome(persona) ? { persona: { name: "你", text: persona.value } } : {}) },
            {
              state: Option.getOrUndefined(state),
              greeting: Option.getOrUndefined(greeting),
              stage,
              events: Option.getOrUndefined(events)?.split(",").filter(Boolean),
              pin: Option.getOrUndefined(pin),
              lore,
            },
          ),
        catch: (e) => (e as Error).message,
      })
      yield* Console.log(json ? JSON.stringify(v) : v.text)
    }),
).pipe(Command.withDescription("Print the stage's document at a state, sectioned, with token estimates"))

export const authorCommands = [init, check, show, test]

const cli = Command.make("card").pipe(
  Command.withDescription("Card toolchain: init, check, view and test"),
  Command.withSubcommands(authorCommands),
)

export const runCli = async <Name extends string, Input, ContextInput, E>(
  command: Command.Command<Name, Input, ContextInput, E>,
  args = process.argv.slice(2),
) => {
  const exit = await Effect.runPromiseExit(
    Command.runWith(command, { version: "0.0.0" })(args).pipe(
      Effect.tapError((e) => (typeof e === "string" ? Console.error(e) : Effect.void)),
      Effect.provide(BunServices.layer),
    ),
  )
  if (Exit.isFailure(exit)) {
    if (Cause.hasDies(exit.cause)) console.error(Cause.pretty(exit.cause))
    process.exitCode = 1
  }
}
if (import.meta.main) await runCli(cli)
