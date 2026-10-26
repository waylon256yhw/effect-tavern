#!/usr/bin/env bun
// `card check <card>` and `card view <card>` (issue #28): the command tree and its I/O only. Linting is src/lint.ts,
// rendering src/view.ts; a card is loaded by name through test/cards/index.ts, with the test player layer.
import { Console, Effect, Exit, FileSystem, Layer, Option, Path, Stdio, Terminal } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { ChildProcessSpawner } from "effect/process"
import { lint } from "../src/lint.ts"
import { stages, view } from "../src/view.ts"
import { loadCard, player, readCard } from "../test/cards/index.ts"

const card = Argument.String("card").pipe(
  Argument.withDescription("a template card by name (wuxia, yandao, ri, banxing), or a path to a .yaml card"),
)
const load = (name: string) =>
  Effect.tryPromise({
    try: async () => (name.endsWith(".yaml") ? readCard(name) : loadCard(name)),
    catch: (e) => (e as Error).message,
  })

const check = Command.make("check", { card }, ({ card: name }) =>
  Effect.gen(function* () {
    const c = yield* load(name)
    const ds = lint(c)
    for (const d of ds)
      yield* Console.log(`${d.level} ${d.rule} ${d.path}: ${d.message}${d.hint ? `\n    hint: ${d.hint}` : ""}`)
    const v = view(c, player)
    for (const s of v.sections.filter((s) => s.tokens)) yield* Console.log(`${s.name} ~${s.tokens} tokens`)
    yield* Console.log(`narrate document ~${v.total} tokens`)
    const errors = ds.filter((d) => d.level === "error").length
    if (errors) return yield* Effect.fail(`${errors} error(s)`)
  }),
).pipe(Command.withDescription("Lint a card and estimate its tokens per section; exit 1 on any error"))

const show = Command.make(
  "view",
  {
    card,
    state: Flag.KeyValuePair("state").pipe(
      Flag.withDescription("field=value, set after the greeting; repeat the flag for more fields"),
      Flag.optional,
    ),
    greeting: Flag.Int("greeting").pipe(Flag.withDescription("apply greetings[n].do first (0-based)"), Flag.optional),
    stage: Flag.Literals("stage", stages).pipe(Flag.withDefault("narrate")),
  },
  ({ card: name, state, greeting, stage }) =>
    Effect.gen(function* () {
      const c = yield* load(name)
      const v = yield* Effect.try({
        try: () =>
          view(c, player, { state: Option.getOrUndefined(state), greeting: Option.getOrUndefined(greeting), stage }),
        catch: (e) => (e as Error).message,
      })
      yield* Console.log(v.text)
    }),
).pipe(Command.withDescription("Print the stage's document at a state, sectioned, with token estimates"))

const cli = Command.make("card").pipe(
  Command.withDescription("Card toolchain: check and view"),
  Command.withSubcommands([check, show]),
)

// ponytail: a hand-made platform layer (the CLI needs only Terminal and stdout); replace with `BunServices.layer` from
// `@effect/platform-bun` once effect 4.0.6 clears the repo's 7-day release gate (after 2026-10-29).
const env = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.sync(() => process.stdout.columns ?? 80),
      rows: Effect.sync(() => process.stdout.rows ?? 24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: (text) => Effect.sync(() => void process.stdout.write(text)),
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("unused")),
  ),
)

const exit = await Effect.runPromiseExit(
  Command.runWith(cli, { version: "0.0.0" })(process.argv.slice(2)).pipe(
    Effect.tapError((e) => (typeof e === "string" ? Console.error(e) : Effect.void)), // CliErrors render themselves
    Effect.provide(env),
  ),
)
if (Exit.isFailure(exit)) process.exitCode = 1
