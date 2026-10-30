import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { createEffect, createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js"
import { read } from "./bridge.ts"
import { Back, Check, Clue, Copy, Next, Prev, Record } from "./icons.tsx"
import {
  count,
  defaultTab,
  groups,
  isTray,
  pattern,
  regionHits,
  regions,
  rows,
  textOf,
  totals,
  type Call,
  type Row,
  type Tray,
} from "./inspect.ts"
import { KeyValues, PinButton, Reading, Shaped } from "./readings.tsx"
import { channelOf, fields, lineOf, parentOf, versions, whens } from "./record.ts"
import { calls, card, log, path, pin, registry, type Id } from "./store.ts"
import { close, open } from "./pages.ts"
import { t } from "./i18n.ts"

// the input's channel in the harness's own words (the inspector speaks English like its stage names)
const CHANNEL = { act: "act", note: "note", both: "act + note", greeting: "greeting" } as const

// ───────── The Inspect page: one turn from the harness's view ─────────
// A full page over the reader (the reader stays mounted, so a turn in flight keeps streaming under it), shaped by
// docs/inspector-prototype.html: two cards on the canvas. Left, the pipeline: only the calls that ran, each row's
// head carrying what the stage decided (the beat and its roll, the brief's must, the prose's first line, what check
// fired or missed, the readout answers), its time and tokens at the end; a two-draft turn folds each draft into a tray.
// A row opens into the request by cache region (tabs over one bounded scroller, so a long head never pushes the
// pipeline apart) and the answer. Right, the node: the input, the untold hooks (pinned from here: this is the only
// place the list shows), the state against the parent, the products by their declared shape. Without `inspect` on the
// server no call carries a request body: the rows keep their heads, time and tokens, open to their answers (the brief
// stays closed), and the right card is what the player came for. Opens on the path's last node; prev / next walk the
// path, `[` `]` too, Escape goes back (pages.ts). src/inspect.ts projects; this draws.
export const openInspector = () => {
  const id = registry.get(path).at(-1)?.turn.id
  if (id !== undefined) open({ inspect: id })
}
const fmt = (n: number) => n.toLocaleString("en-US")
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
// token readings in one grammar: ↑ in, ↓ out, ↻ cache read, + cache write (the last two only when not 0); the words
// live once, in the reading's title
const tokens = (u: Call["usage"], f: (n: number) => string) =>
  [`↑${f(u.input)}`, `↓${f(u.output)}`, u.cacheRead && `↻${f(u.cacheRead)}`, u.cacheWrite && `+${f(u.cacheWrite)}`]
    .filter(Boolean)
    .join(" ")
/** Text with every match of the (literal) query marked. */
const Marked = (props: { text: string; q: string }) => {
  const pieces = createMemo(() => (props.q ? props.text.split(pattern(props.q)) : [props.text]))
  return (
    <For each={pieces()} keyed={false}>
      {(p, i) => (
        <Show when={i % 2} fallback={p()}>
          <mark>{p()}</mark>
        </Show>
      )}
    </For>
  )
}
/** A row's head: what the stage decided, from the call's answer and the node's facts (never a written summary). */
const Digest = (props: { row: Row; node: Node; nth: number; dev: boolean }) => {
  const out = () => props.row.call.out as Record<string, unknown>
  const ids = (v: unknown) => (Array.isArray(v) ? (v as string[]).join(", ") : "")
  // decide: the nth beat of the turn; its judged check is the one among the beats with a chance up to it
  const beats = () => props.node.turn.beats
  const check = () =>
    beats()[props.nth]?.chance === undefined
      ? undefined
      : props.node.checks[
          beats()
            .slice(0, props.nth + 1)
            .filter((x) => x.chance !== undefined).length - 1
        ]
  const fired = () => (out().fired as string[] | undefined) ?? []
  const missed = () => props.node.turn.brief.must.filter((id) => !fired().includes(id))
  const violated = () => (out().violated as string[] | undefined) ?? []
  const products = () =>
    Object.entries(out())
      .filter(([k]) => k !== "answers")
      .map(([k, v]) => (Array.isArray(v) ? `${k} (${v.length})` : k))
      .join(" · ")
  // polish: the sentences sent (the marks in the request, when the trace carries it) against the ones that came back changed
  const sent = () =>
    new Map(
      props.row.call.msgs.flatMap((m) =>
        [...textOf(m).matchAll(/<target id="(hit-\d+)"[^>]*>(.*?)<\/target>/g)].map(([, id, s]) => [id!, s!] as const),
      ),
    )
  const changed = () => Object.entries(out()).filter(([k, v]) => sent().has(k) && sent().get(k) !== v).length
  const answers = () =>
    Object.entries((out().answers as Record<string, string> | undefined) ?? {}).map(([k, v]) => `${k}=${v}`)
  return (
    <Switch>
      <Match when={props.row.phase === "lookup"}>
        <Show when={ids(out().read)} fallback={<span class="pill">{t("inspector.nothingRead")}</span>}>
          {(r) => <span class="pill">read: {r()}</span>}
        </Show>
      </Match>
      <Match when={props.row.phase === "decide"}>
        <Show when={check()} fallback={<span class="pill">{beats()[props.nth]?.next ?? "end"}</span>}>
          {(c) => (
            <>
              <span class={{ pill: true, ok: c().hit, bad: !c().hit }}>
                {c().action} · {c().hit ? t("inspector.hit") : t("inspector.miss")}
              </span>
              <span class="dtext">
                {t("inspector.rollVs", { roll: c().roll.toFixed(2), chance: Math.round(c().chance * 100) })}
              </span>
            </>
          )}
        </Show>
      </Match>
      <Match when={props.row.phase === "direct"}>
        <Show when={ids(out().must)} fallback={<span class="pill">{t("inspector.noMust")}</span>}>
          {(m) => <span class="pill">must: {m()}</span>}
        </Show>
        <Show when={props.dev}>
          <span class="dtext">
            {[ids(out().may) && `may: ${ids(out().may)}`, out().tone && `tone: ${String(out().tone)}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Show>
      </Match>
      <Match when={props.row.phase === "narrate"}>
        <Show when={props.row.status === "stopped"}>
          <span class="pill bad">{t("common.stopped")}</span>
        </Show>
        <span class="dprose">{(typeof props.row.call.out === "string" ? props.row.call.out : "").split("\n")[0]}</span>
      </Match>
      <Match when={props.row.phase === "check"}>
        <Show
          when={props.dev}
          fallback={
            <span class={{ pill: true, bad: props.row.status === "failed", ok: props.row.status !== "failed" }}>
              {props.row.status === "failed" ? t("inspector.failedSecondDraft") : t("inspector.ok")}
            </span>
          }
        >
          <Show
            when={missed().length || violated().length}
            fallback={<span class="pill ok">{fired().length ? `met: ${fired().join(", ")}` : "ok"}</span>}
          >
            <span class="pill bad">
              {[...missed().map((m) => `missed: ${m}`), ...violated().map((v) => `rule: ${v}`)].join(" · ")}
            </span>
            <span class="dtext">fired: {fired().join(", ") || "none"}</span>
          </Show>
        </Show>
      </Match>
      <Match when={props.row.phase === "polish"}>
        <span class="pill">{t("inspector.targets", { n: Object.keys(out()).length })}</span>
        <Show when={sent().size}>
          <span class="dtext">{t("inspector.changed", { n: changed() })}</span>
        </Show>
      </Match>
      <Match when={props.row.phase === "record"}>
        <For each={answers()} keyed={false}>
          {(a) => <span class="pill">{a()}</span>}
        </For>
        <span class="dtext">{products()}</span>
      </Match>
    </Switch>
  )
}

/** One call: the head (stage, digest, time and tokens), opening to the request by region and the answer. */
const Step = (props: { row: Row; node: Node; nth: number; dev: boolean; q: string; open: boolean }) => {
  const c = () => props.row.call
  const regs = createMemo(() => regions(c().msgs))
  const rhits = createMemo(() => regionHits(regs(), props.q))
  // the request's hits and the answer's (marked too)
  const hits = createMemo(
    () => rhits().reduce((a, b) => a + b, 0) + (typeof c().out === "string" ? count(c().out as string, props.q) : 0),
  )
  // the brief is the one answer that stays closed without `inspect`; a stage without a body or an answer has nothing to open
  const opens = () => (props.dev && c().msgs.length > 0) || props.row.phase !== "direct"
  // the reader's pick (a region, or null for all) holds only under the query it was made with: a new query reopens
  // the well on its first region with hits
  const [pick, setPick] = createSignal<{ q: string; tab: number | null }>()
  const shownTab = () => {
    const p = pick()
    return p && p.q === props.q ? p.tab : defaultTab(rhits(), props.q)
  }
  const setTab = (tab: number | null) => setPick({ q: props.q, tab })
  // a query (or a tab) brings the well's first mark to its middle, by the well's own scrollTop so the pane stays put
  let well: HTMLDivElement | undefined
  createEffect(
    () => [props.q, shownTab()] as const,
    ([q]) => {
      if (!q) return
      const id = requestAnimationFrame(() => {
        const m = well?.querySelector("mark")
        if (!well || !m) return
        const w = well.getBoundingClientRect()
        const r = m.getBoundingClientRect()
        well.scrollTop += r.top - w.top - (well.clientHeight - r.height) / 2
      })
      return () => cancelAnimationFrame(id)
    },
  )
  const [copied, setCopied] = createSignal(false)
  const copy = () => {
    const out = { regions: regs().map(({ msgs, ...r }) => ({ ...r, messages: msgs })), answer: c().out }
    void navigator.clipboard?.writeText(JSON.stringify(out, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <details
      class={{ step: true, flat: !opens(), bad: props.row.status !== "ok" }}
      open={(opens() && (props.open || hits() > 0)) || undefined}
    >
      <summary onClick={(e) => !opens() && e.preventDefault()}>
        <span class="stage">
          <Next class="chev" aria-hidden="true" />
          <span class="nm">{props.row.phase}</span>
          <Show when={hits()}>{(h) => <span class="hits">{h()}</span>}</Show>
        </span>
        <span class="digest">
          <Digest row={props.row} node={props.node} nth={props.nth} dev={props.dev} />
        </span>
        <span class="metrics" title={t("inspector.tokenLegend")}>
          <span class="ms">{secs(c().ms)}</span> · {tokens(c().usage, fmt)}
        </span>
      </summary>
      <Show when={opens()}>
        <div class="body">
          <div class="well">
            <Show when={props.dev && regs().length > 0}>
              <div class="rtabs" role="tablist">
                <For each={regs()} keyed={false}>
                  {(r, i) => (
                    <button role="tab" aria-selected={shownTab() === i ? "true" : "false"} onClick={() => setTab(i)}>
                      <Show when={r().breakpoint}>
                        <i class="bp" aria-label={t("inspector.breakpoint")} />
                      </Show>
                      {r().name} <span class="chars">{fmt(r().chars)}c</span>
                      <Show when={rhits()[i]}>{(h) => <span class="hits">{h()}</span>}</Show>
                    </button>
                  )}
                </For>
                <button role="tab" aria-selected={shownTab() === null ? "true" : "false"} onClick={() => setTab(null)}>
                  {t("inspector.all")}
                </button>
                <button class="copy" aria-label={t("inspector.copyJson")} onClick={copy}>
                  <Show when={copied()} fallback={<Copy />}>
                    <Check />
                  </Show>
                </button>
              </div>
            </Show>
            <div class="wscroll" ref={(el) => (well = el)}>
              <Show when={props.dev}>
                <For each={regs()} keyed={false}>
                  {(r, i) => (
                    <Show when={shownTab() === null || shownTab() === i}>
                      <For each={r().msgs} keyed={false}>
                        {(m, j) => (
                          <div class="msg" data-role={m().role}>
                            <span class="role">
                              {shownTab() === null ? `${r().name} · ${m().role}` : m().role}
                              <Show when={r().breakpoint && j === r().msgs.length - 1}>
                                <span class="bptag">{t("inspector.breakpoint")}</span>
                              </Show>
                            </span>
                            <div class="txt">
                              <Marked text={textOf(m())} q={props.q} />
                            </div>
                          </div>
                        )}
                      </For>
                    </Show>
                  )}
                </For>
              </Show>
              <div class="answer">
                <span class="role">{t("inspector.answer")}</span>
                <Show
                  when={typeof c().out === "string"}
                  fallback={<KeyValues of={c().out as Record<string, unknown>} />}
                >
                  <p class="prose">
                    <Marked text={c().out as string} q={props.q} />
                  </p>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </details>
  )
}

export const Inspect = (props: { id: Id }) => {
  const all = read(log)
  const line = read(path)
  const trace = read(calls)
  const view = read(card)
  const pinned = read(pin)
  const node = () => all().nodes.get(props.id)
  const at = () => line().findIndex((x) => x.turn.id === props.id) // -1: a sibling off the reading line
  const parent = () => (node() ? parentOf(all(), node()!) : undefined)
  const vs = createMemo(() => (node() ? versions(all(), node()!) : { list: [], index: -1, varied: false }))
  const go = (d: number) => {
    const x = line()[at() + d]
    if (x) open({ inspect: x.turn.id })
  }
  const mine = () => trace().get(props.id) ?? []
  // the server's gate: without `inspect` no call carries a request body
  const dev = createMemo(() => [...trace().values()].some((l) => l.some((c) => c.msgs.length > 0)))
  const [pane, setPane] = createSignal<"pipeline" | "node">("pipeline")
  const [q, setQ] = createSignal("")
  const trows = createMemo(() => (node() ? rows(mine(), node()!.turn) : []))
  const grouped = createMemo(() => groups(trows()))
  const sums = createMemo(() => totals(mine()))
  const nth = (r: Row) =>
    trows()
      .slice(0, trows().indexOf(r))
      .filter((x) => x.phase === r.phase).length
  const lastNarrate = () => trows().findLast((r) => r.phase === "narrate")
  // the node's readings, drawn by the Record's own elements; only the fields here (checks and clues sit in the pipeline)
  const changes = createMemo(() => {
    const r = view()?.rules
    const x = node()
    return r && x ? fields(r, x, parent(), whens(view())) : []
  })
  const shapeOf = (id: string) => view()?.products.find((p) => p.id === id)?.shape
  const One = (p: { row: Row }) => (
    <Step row={p.row} node={node()!} nth={nth(p.row)} dev={dev()} q={q()} open={p.row === lastNarrate()} />
  )
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "[") go(-1)
      else if (e.key === "]") go(1)
      else return
      e.preventDefault()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })
  return (
    <div class="inspect" data-pane={pane()}>
      <header class="top">
        <button class="icon" aria-label={t("common.backToStory")} onClick={close}>
          <Back />
        </button>
        <h1>{view()?.title}</h1>
        <span class="nodenav">
          <button class="icon" aria-label={t("inspector.prevNode")} disabled={at() <= 0} onClick={() => go(-1)}>
            <Prev />
          </button>
          <span class="n">
            <b>{at() >= 0 ? t("common.turnN", { n: at() + 1 }) : `#${props.id}`}</b>
            <Show when={vs().list.length > 1}>
              <span class="v">
                {vs().index + 1}/{vs().list.length}
              </span>
            </Show>
          </span>
          <button
            class="icon"
            aria-label={t("inspector.nextNode")}
            disabled={at() < 0 || at() === line().length - 1}
            onClick={() => go(1)}
          >
            <Next />
          </button>
        </span>
        <span class="spacer" />
        <Show when={sums().calls}>
          <span class="sums" title={t("inspector.tokenLegend")}>
            {sums().calls}× · {secs(sums().ms)} · {tokens(sums(), (n) => compact.format(n))}
          </span>
        </Show>
        <span class="seg" role="tablist" aria-label={t("common.view")}>
          <button
            role="tab"
            aria-selected={pane() === "pipeline" ? "true" : "false"}
            onClick={() => setPane("pipeline")}
          >
            {t("inspector.pipeline")}
          </button>
          <button role="tab" aria-selected={pane() === "node" ? "true" : "false"} onClick={() => setPane("node")}>
            {t("common.node")}
            <Show when={node()?.readable.length}>{(n) => <span class="v">{n()}</span>}</Show>
          </button>
        </span>
      </header>
      <Show when={node()} fallback={<p class="dim">{t("inspector.noSuchNode")}</p>}>
        {(x) => (
          <div class="cols">
            <section class="pane pipeline" aria-label={t("inspector.pipeline")}>
              <div class="sechead">
                <span class="lbl">{t("inspector.pipeline")}</span>
                <Show when={dev()}>
                  <label class="search">
                    <Clue aria-hidden="true" />
                    <input
                      type="search"
                      aria-label={t("inspector.searchLabel")}
                      placeholder={t("inspector.searchPlaceholder")}
                      autocomplete="off"
                      value={q()}
                      onInput={(e) => !e.isComposing && setQ(e.currentTarget.value.trim())}
                      onCompositionEnd={(e) => setQ(e.currentTarget.value.trim())}
                    />
                  </label>
                </Show>
              </div>
              <Show when={mine().length} fallback={<p class="dim">{t("inspector.noCalls")}</p>}>
                <div class="spine">
                  <For each={grouped()} keyed={false}>
                    {(g) => (
                      <Show
                        when={isTray(g()) ? (g() as Tray) : undefined}
                        fallback={
                          <div class={{ knot: true, bad: (g() as Row).status !== "ok" }}>
                            <One row={g() as Row} />
                          </div>
                        }
                      >
                        {(tray) => (
                          <div class={{ knot: true, tray: true, bad: tray().failed, discarded: tray().failed }}>
                            <div class="thead">
                              <span>
                                {t("common.draft")} {tray().draft} ·{" "}
                                {tray().failed ? t("inspector.discarded") : t("inspector.final")}
                              </span>
                              <span class="meta">
                                {secs(tray().rows.reduce((n, r) => n + r.call.ms, 0))} ·{" "}
                                {tray().rows.some((r) => r.status === "stopped")
                                  ? t("common.stopped")
                                  : tray().failed
                                    ? t("inspector.checkFailed")
                                    : t("inspector.checkPassed")}
                              </span>
                            </div>
                            <For each={tray().rows} keyed={false}>
                              {(r) => <One row={r()} />}
                            </For>
                          </div>
                        )}
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
            </section>
            <aside class="pane node" aria-label={t("common.node")}>
              <div class="sechead">
                <span class="lbl">{t("inspector.input")}</span>
                <span class="meta">{CHANNEL[channelOf(x())]}</span>
              </div>
              <div class="inwell">
                <p class="line">{lineOf(x())}</p>
                <Show when={(x().turn.input.text && x().turn.input.note) || x().turn.input.pin}>
                  <div class="pills">
                    <Show when={x().turn.input.text && x().turn.input.note}>
                      <span class="pill">note: {x().turn.input.note}</span>
                    </Show>
                    <Show when={x().turn.input.pin}>
                      {(p) => (
                        <span class={{ pill: true, ok: x().turn.fired.some((d) => d.id === p()) }}>
                          pin: {p()} (
                          {x().turn.fired.some((d) => d.id === p())
                            ? t("inspector.toldState")
                            : t("inspector.untoldState")}
                          )
                        </span>
                      )}
                    </Show>
                  </div>
                </Show>
              </div>
              <div class="sechead">
                <span class="lbl">{t("inspector.untold")}</span>
              </div>
              <Show when={x().readable.length} fallback={<p class="dim">{t("inspector.nothingLeft")}</p>}>
                <div class="hooks">
                  <For each={x().readable} keyed={(r) => r.id}>
                    {(r) => (
                      <div class={{ hook: true, armed: pinned() === r().id }}>
                        <span class="hb">
                          <span class="hid">
                            {r().id}
                            {pinned() === r().id ? t("inspector.armed") : ""}
                          </span>
                          <span class="ht">{r().hook}</span>
                        </span>
                        <PinButton id={r().id} />
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div class="sechead">
                <span class="lbl">{t("inspector.state")}</span>
                <Show when={x().events.length}>
                  <span class="meta">{x().events.join(", ")}</span>
                </Show>
              </div>
              <Show when={changes().length} fallback={<p class="dim">{t("inspector.noFieldChanged")}</p>}>
                <div class="record">
                  <For each={changes()} keyed={false}>
                    {(el) => <Reading el={el()} />}
                  </For>
                </div>
              </Show>
              <div class="sechead">
                <span class="lbl">{t("inspector.products")}</span>
              </div>
              <For each={Object.entries(x().turn.products)} keyed={([k]) => k}>
                {(e) => (
                  <div class="prod">
                    <span class="pid">{e()[0]}</span>
                    <Show when={shapeOf(e()[0])} fallback={<KeyValues of={{ [e()[0]]: e()[1] }} />}>
                      {(sh) => <Shaped shape={sh()} value={e()[1]} />}
                    </Show>
                  </div>
                )}
              </For>
            </aside>
          </div>
        )}
      </Show>
    </div>
  )
}
