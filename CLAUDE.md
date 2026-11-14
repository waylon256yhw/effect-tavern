<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp run verify` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Solid 2.0

The client (`packages/client`) uses Solid 2.0 (`solid-js` 2.x with `@solidjs/web`), pinned to one RC; move the
`solid-js`, `@solidjs/web`, `@solidjs/vite-plugin` and `@solidjs/diagnostics` pins together. Components run once; there
is no re-render. Read `packages/client/node_modules/solid-js/CHEATSHEET.md` before writing Solid code, especially its
last section, "What changed from 1.x".

Rules that matter most:

- Props are read, never destructured: `props.name` inside JSX, a memo, or an effect.
  `function Comp({ name })` loses reactivity. Pass values, not accessors: `<Child count={count()} />`.
- `createEffect(compute, apply)` takes two functions. The first reads reactive values and
  returns a result; the second receives it and performs side effects. One argument is an error.
- Stores are written through the draft: `setStore(s => { s.user.name = "Ada" })`.
  There are no path setters and no `produce`.
- Read reactive values inside JSX, a memo, or an effect, never at the top of a component body.
- Do not write a signal or store from a memo, an effect's compute function, or a component body.
  Write from event handlers, `onSettled`, or actions.

Names that no longer exist, and what to use:

- `solid-js/web` -> `@solidjs/web`; `solid-js/store` -> `solid-js`
- `Suspense` -> `Loading`; `SuspenseList` -> `Reveal`; `ErrorBoundary` -> `Errored`
- `mergeProps` -> `merge`; `splitProps` -> `omit`; `unwrap` -> `snapshot`; `onMount` -> `onSettled`
- `createResource` -> an async `createMemo` or `createStore(fn)` read under `<Loading>`
- `createSelector` -> `createProjection`; `createComputed` -> `createMemo` or a two-function `createEffect`
- `batch` -> writes batch on a microtask (`flush()` applies them now); `on()` -> the compute half of `createEffect`
- `startTransition` / `useTransition` -> built in; `isPending()` reports an in-flight change
- `Index` -> `<For keyed={false}>`; `indexArray` -> `mapArray`; `createMutable` -> `createStore` with draft setters
- `onError` / `catchError` -> `<Errored>` or the `error` option of `createEffect`
- `classList` -> `class={{ active: isActive() }}`; `use:` directives -> `ref={factory(args)}`
- `Context.Provider` -> `<Context value={...}>`; `equalFn` -> `isEqual`; `getListener` -> `getObserver`

Tooling:

- Skills: pnpm links the ones the Solid packages ship into `.claude/skills/pnpm-*` (gitignored, re-created by
  `vp install`; `permissions.<pkg>.skills` in pnpm-workspace.yaml is the approval): `reactivity-diagnostics` (every
  warning code and its fix), `agent-loops` (capture evidence, assert budgets), `server-components` (unused, no SSR).
  The `solid-2.0` primer skill ships from rc.16 on; until the pin moves, the cheatsheet is the primer.
- A console warning with a bracketed code, such as `[REACTIVE_WRITE_IN_OWNED_SCOPE]`, is a defect.
  Look it up in the repair guide; do not suppress it.
- Verify a reactive change with `captureArtifact` and `expectNoDiagnostics` from `@solidjs/diagnostics`,
  or `POST /__solid/diagnostics` on the dev server with `{"method":"begin"}` ... `{"method":"end"}`.
- `vp check` runs `eslint-plugin-solid/configs/v2` through oxlint (root `vite.config.ts`).
- Docs: https://v2.solidjs.com/llms.txt; append `.md` to any page URL for its Markdown.

## UI SDK (`@ui-sdk`)

Interactive controls, overlays, and gesture primitives in `packages/client` build on `@ui-sdk/solid` and `@ui-sdk/core` (pinned together on Solid 2.0 RC; skill linked at `.claude/skills/pnpm-@ui-sdk+core-ui-sdk` via `pnpm-workspace.yaml`), replacing ad-hoc native `<select>`, `<dialog>`, `[popover]`, Escape/outside-click listeners, and raw pointer drag loops so behavior converges across desktop and touch browsers:

- **Behavior vs. styling:** `@ui-sdk` owns focus management, keyboard navigation, Escape/scrim dismissal, background inertness, popup positioning, pointer velocity/rubber-band/spring physics (`@ui-sdk/core/gesture`), and responsive adaptation (`presentation="auto"`). Styling stays strictly in our stylesheets under the five-layer cascade `@layer ui-sdk, tokens, components, card, user` (`src/app.css`), so component rules override `@ui-sdk` defaults without `!important`.
- **Shared controls & primitives:** Reuse the wrappers in `src/controls.tsx` (`Menu` on `Select`, `Switch`, `Modal` and `Prompt` on `Dialog` + `createDialogController`, `Confirm` on `AlertDialog` + `createConfirm`), `src/readings.tsx` (`Sheet` on `Dialog`, `Demand` on `Menu`), `src/shell.tsx` (phone `Drawer`), `src/composer.tsx` + `src/invocation-menu.tsx` (`Popover` + multi-page `Command`), and `src/edge.tsx` (`definePrimitive` separator with `bindDrag`, `rubberBand`, and `solveSpring` over `src/fold.ts`). When building a control `@ui-sdk` does not ship, author it with `definePrimitive` and `createParts` rather than raw DOM listeners.
- **Agent bridge & browser check (`#181`):** Every interactive control an agent should reach is an `@ui-sdk` part (or `definePrimitive` declaring `agent: { actions }`) with an accessible name, mounted in `packages/client/test/controls.tsx`. `vp run verify:ui` in `packages/client` (kept out of `verify` because it launches headless Chrome; set `CHROME` when not at the macOS default) drives `test/controls.tsx` through `createAgent` (`snapshot` / `act`) and `@solidjs/diagnostics`, failing on any unnamed control, unreachable action, or Solid reactivity diagnostic.
- **Browser bundle boundary:** `packages/client/test/imports.ts` (run in `vp run verify`) walks value imports from `packages/client/src/` across workspace packages and fails if any `node:*` module or `@effect-tavern/provider`'s root barrel (which pulls AI SDK drivers and Node code) becomes reachable in the browser. Import pure provider helpers by explicit subpath (`@effect-tavern/provider/src/names.ts`, `url.ts`) or `import type`.

## Interface words (i18n, #67)

The chrome's words live in `packages/client/src/locales/zh-CN.ts` (the source, Chinese) and `en.ts` (English, the same
keys), read with `t("side.stories")` from `src/i18n.ts` where the word is drawn (JSX, a memo, an effect); a module-level
table holds keys, not words. A new word: add the key to both files (or `x18n set <key> --locale <l> --value <v>` in
packages/client), then use it. `x18n check` runs in `vp run verify` and fails on a key used but undeclared, declared
but unused, missing in a locale, or a `{hole}` the English drops; `x18n extract --list` finds hard-coded strings.
A card's own text (labels, group names, openings) and the model's words are never translated.

## Dev

Tests are `vp run verify` (bun assert scripts per package, `test/*.ts`); the `vp test` built-in finds no vitest files and exits 1. Run `vp run verify:ui` in `packages/client` whenever client controls, dialogs, popups, or gestures change (see `## UI SDK`).

`bun --bun vp run dev` at the root (`bun --bun vp dev` in `packages/client`; `--bun` makes the `node` Vite+ launches resolve to Bun) is the whole stack: the session (`packages/server/src/dev.ts`) runs inside the Vite process through its module runner, mounted at `/api`; client edits are HMR, runtime/server edits take effect on the next request. `MODEL=fake` scripts the model, `CARDS=<dir>` puts a directory of YAML cards on the shelf (default: the four templates), the library lives in `.dev/tavern.db` (gitignored; `DATA=<dir>` moves it; delete it to start every story over). The user starts and stops `vp dev` in their own terminal; an agent uses it and never starts, restarts or kills it.

`bun src/main.ts` in `packages/server` is the standalone app, the one-port form a phone runs: `/api` plus the client build (`vp build` in `packages/client` → `dist`) under every other path. It is the production host (`start.ts` → `host.ts`, shared with `tavern serve`), not the dev session: the library is `.tavern/tavern.db` (`DATA=<dir>` moves it; `DATA=.dev` opens the dev library), the harness is the minimal one, no local key is imported, and call bodies stay out of the Inspector unless `TAVERN_INSPECT=1` (`tavern serve --inspect`). A schema change to the library needs a new `user_version` step in `data.ts` `upgrade`: a stamped library no longer runs the create statements on open.

Decision-model calibration instruments live in `packages/server/bin/` (`decision-probe.ts`, `decision-replay.ts`, `decision-lookup.ts`): they open a library read-only (defaulting to `.dev/tavern.db` without locking a running dev server) and send labeled scenes, stored node prose, or `lookup` catalog pools to the saved `decision` service to measure probability thresholds (`LO`, `HI`, `LOOKUP` in `packages/runtime/src/decision.ts`), latency, and block rates. Pass `--dry` (`decision-replay.ts`, `decision-lookup.ts`) to inspect built requests without calling the network.
