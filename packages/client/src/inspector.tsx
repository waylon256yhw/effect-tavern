import { AsyncView } from "./async-view.tsx"
import { fetchDetail, fetchTrace, fetchContext } from "./wire.ts"
import { HI, LO } from "@effect-tavern/runtime/src/decision.ts"
import { createEffect, createMemo, createSignal, For, Match, onSettled, Show, Switch, untrack } from "solid-js"
import { read } from "./bridge.ts"
import { Back, Change, Check, Clue, Copy, Next, Prev, Read } from "./icons.tsx"
import {
  cached,
  defaultView,
  digest,
  groups,
  isTray,
  nativeTrace,
  ordinals,
  pattern,
  pieces,
  polishPairs,
  precheck,
  regions,
  rowHits,
  rows,
  settledAt,
  stepOps,
  textOf,
  totals,
  type Call,
  type Facts,
  type Op,
  type Pill,
  type Row,
  type Tray,
} from "./inspect.ts"
import { KeyValues, Reading, Shaped } from "./readings.tsx"
import { channelOf, fields, lineOf, versions, whens } from "./record.ts"
import { card, log, path, registry, type Id } from "./store.ts"
import { close, open } from "./pages.ts"
import { t } from "./i18n.ts"

// the input's channel in the harness's own words (the inspector speaks English like its stage names)
const CHANNEL = { act: "act", note: "note", both: "act + note", invoke: "invoke", greeting: "greeting" } as const

// ───────── The Inspect page: one turn from the harness's view ─────────
// A full page over the reader (the reader stays mounted, so a turn in flight keeps streaming under it), two cards on
// the canvas. Left, the pipeline: only the calls that ran, one row each in one grid of fixed slots (stage, what the
// stage decided, time, ↑, ↓, cache), so the numbers line up down the page and through a draft's tray. One row at a
// time opens into a well with three views: its result, its prompt (the request with the cache breakpoints as
// hairlines), the stored call as JSON. Right, the node: the input, the untold hooks, the state against the parent, the
// products by their declared shape. Without `inspect` on the server no call carries a request body: the rows keep
// their heads and numbers, open to their results (the brief stays closed), and no prompt view. Opens on the path's
// last node; prev / next walk the path, `[` `]` too, Escape goes back (pages.ts). src/inspect.ts projects; this draws.
export const openInspector = () => {
  const id = registry.get(path).at(-1)?.id
  if (id !== undefined) open({ inspect: id })
}
const fmt = (n: number) => n.toLocaleString("en-US")
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`

/** The number slots: time, ↑ in, ↓ out, and the cache (read, or written when nothing was read) when the turn has
 *  any. The words live in each slot's hint. */
const Metrics = (props: { ms?: number; usage?: Call["usage"]; cache: boolean }) => (
  <span class="metrics">
    <span class="mt" title={t("inspector.time")}>
      {props.ms === undefined ? "" : secs(props.ms)}
    </span>
    <span class="mt" title={t("inspector.in")}>
      <Show when={props.usage}>
        {(u) => (
          <>
            <i>↑</i>
            {fmt(u().input)}
          </>
        )}
      </Show>
    </span>
    <span class="mt" title={t("inspector.out")}>
      <Show when={props.usage}>
        {(u) => (
          <>
            <i>↓</i>
            {fmt(u().output)}
          </>
        )}
      </Show>
    </span>
    <Show when={props.cache}>
      <Show
        when={props.usage?.cacheRead || !props.usage?.cacheWrite}
        fallback={
          <span class="mt" title={t("inspector.cacheWrite")}>
            <i>+</i>
            {fmt(props.usage?.cacheWrite ?? 0)}
          </span>
        }
      >
        <span class="mt" title={t("inspector.cacheRead")}>
          <Show when={props.usage?.cacheRead}>
            {(n) => (
              <>
                <i>↻</i>
                {fmt(n())}
              </>
            )}
          </Show>
        </span>
      </Show>
    </Show>
  </span>
)

/** Text with every match of the (literal) query marked. */
const Marked = (props: { text: string; q: string }) => {
  const parts = createMemo(() => (props.q ? props.text.split(pattern(props.q)) : [props.text]))
  return (
    <For each={parts()} keyed={false}>
      {(p, i) => (
        <Show when={i % 2} fallback={p()}>
          <mark>{p()}</mark>
        </Show>
      )}
    </For>
  )
}

const Pills = (props: { pills: readonly Pill[] }) => {
  const word = (p: Pill) =>
    p.word === "precheck"
      ? t("inspector.precheck")
      : p.word === "escalate"
        ? t("inspector.escalate")
        : p.word === "stopped"
          ? t("common.stopped")
          : p.word === "exhausted"
            ? t("inspector.exhausted")
            : p.word === "failed"
              ? t("inspector.failed")
              : p.word === "sentences"
                ? t("inspector.sentences", { n: p.n ?? 0 })
                : ""
  return (
    <For each={props.pills} keyed={false}>
      {(p) => (
        <span class={{ pill: true, [p().tone ?? "plain"]: true }} title={p().hint}>
          {p().text ?? word(p())}
        </span>
      )}
    </For>
  )
}

// a record operation's word, the Record's own (readings.tsx); a tool this page does not know keeps its name
const verb = (v: string) =>
  v === "insert" || v === "patch" || v === "remove" || v === "replace" ? t(`readings.${v}`) : v
const is = <K extends Op["kind"]>(o: Op, k: K) => (o.kind === k ? (o as Extract<Op, { kind: K }>) : undefined)
/** The result of a tool stage: one line per step, what it did on the left, its own time and tokens on the right. */
const Steps = (props: { call: Call; facts: Facts; cache: boolean }) => (
  <Show when={nativeTrace(props.call.out)}>
    {(trace) => (
      <For each={trace().steps.filter((s) => stepOps(s, props.facts).length)} keyed={(s) => s.index}>
        {(step) => (
          <div class="sline">
            <span class="ops">
              <For each={stepOps(step(), props.facts)} keyed={false}>
                {(op) => (
                  <span class="op">
                    <Switch>
                      <Match when={is(op(), "search")}>
                        {(o) => (
                          <>
                            <Clue aria-hidden="true" />
                            <span class="q">{o().query}</span>
                            <Show when={o().n !== undefined}>
                              <span class="n">→ {o().n}</span>
                            </Show>
                          </>
                        )}
                      </Match>
                      <Match when={is(op(), "read")}>
                        {(o) => (
                          <>
                            <Read aria-hidden="true" />
                            <Pills pills={o().titles.map((text) => ({ text }))} />
                          </>
                        )}
                      </Match>
                      <Match when={is(op(), "op")}>
                        {(o) => (
                          <Show
                            when={o().verb !== "read"}
                            fallback={
                              <>
                                <Read aria-hidden="true" />
                                <span class="pill">{o().target}</span>
                              </>
                            }
                          >
                            <span class="n">{verb(o().verb)}</span>
                            <Show when={o().target}>
                              <span class="pill">{o().target}</span>
                            </Show>
                          </Show>
                        )}
                      </Match>
                      <Match when={is(op(), "wrote")}>
                        {(o) => <Pills pills={o().names.map((text) => ({ text }))} />}
                      </Match>
                    </Switch>
                    <Show when={op().error}>{(e) => <span class="pill bad">{e()}</span>}</Show>
                  </span>
                )}
              </For>
            </span>
            <Metrics ms={step().ms} usage={step().usage} cache={props.cache} />
          </div>
        )}
      </For>
    )}
  </Show>
)

/** One call: the head in the row's slots, opening to its result, its prompt or the stored call. */
const Step = (props: {
  row: Row
  facts: Facts
  nth: number
  ord: number | undefined
  dev: boolean
  cache: boolean
  q: string
  open: boolean
  onToggle: () => void
}) => {
  const c = () => props.row.call
  const head = createMemo(() => digest(props.row, props.nth, props.facts))
  const hits = createMemo(() => rowHits(props.row, props.q))
  // the brief is the one answer that stays closed without `inspect`
  const opens = () => (props.dev && c().msgs.length > 0) || props.row.phase !== "direct"
  // the reader's pick of a view holds only under the query it was made with: a new query reopens the well where its
  // marks are (the prompt when the request has them)
  const [pick, setPick] = createSignal<{ q: string; view: "result" | "prompt" | "json" }>()
  const view = () => {
    const p = pick()
    return p && p.q === props.q ? p.view : defaultView(props.row, props.q)
  }
  // a query (or a view, or the step opening under one) brings the well's first mark to its middle, by the well's own
  // scrollTop so the pane stays put
  let well: HTMLDivElement | undefined
  createEffect(
    () => [props.q, view(), props.open] as const,
    ([q, , open]) => {
      if (!q || !open) return // a closed step has no geometry; it scrolls when it opens under the query
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
    void navigator.clipboard?.writeText(JSON.stringify(c(), null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const Tab = (p: { v: "result" | "prompt" | "json"; children: string }) => (
    <button
      role="tab"
      aria-selected={view() === p.v ? "true" : "false"}
      onClick={() => setPick({ q: props.q, view: p.v })}
    >
      {p.children}
    </button>
  )
  return (
    <details
      class={{ step: true, flat: !opens(), bad: props.row.status !== "ok" }}
      open={(opens() && props.open) || undefined}
    >
      {/* Solid owns the attribute: the browser's own toggle never runs, the page's one open step is the state */}
      <summary
        onClick={(e) => {
          e.preventDefault()
          if (opens()) props.onToggle()
        }}
      >
        <span class="stage">
          <Next class="chev" aria-hidden="true" />
          <span class="nm">
            {props.row.phase}
            <Show when={props.ord}>{(n) => <span class="ord">{n()}</span>}</Show>
          </span>
          <Show when={hits()}>{(h) => <span class="hits">{h()}</span>}</Show>
        </span>
        <span class="digest">
          <Pills pills={head().pills} />
          <Show when={head().note}>{(n) => <span class="dtext">{n()}</span>}</Show>
          <Show when={head().line}>{(l) => <span class="dprose">{l()}</span>}</Show>
        </span>
        <Metrics ms={c().ms} usage={c().usage} cache={props.cache} />
      </summary>
      <Show when={opens()}>
        <div class="body">
          <div class="well">
            <div class="wbar" role="tablist">
              <Tab v="result">{t("inspector.result")}</Tab>
              <Show when={c().msgs.length > 0}>
                <Tab v="prompt">{t("inspector.prompt")}</Tab>
              </Show>
              <Tab v="json">{t("inspector.json")}</Tab>
              <button class="copy" aria-label={t("inspector.copyJson")} onClick={copy}>
                <Show when={copied()} fallback={<Copy />}>
                  <Check />
                </Show>
              </button>
            </div>
            <div class="wscroll" ref={(el) => (well = el)}>
              <Switch>
                <Match when={view() === "prompt"}>
                  <For each={regions(c().msgs)} keyed={false}>
                    {(r) => (
                      <>
                        <For each={r().msgs} keyed={false}>
                          {(m) => (
                            <div class="msg" data-role={m().role}>
                              <span class="role">{m().role}</span>
                              <div class="txt">
                                <Marked text={textOf(m())} q={props.q} />
                              </div>
                            </div>
                          )}
                        </For>
                        <Show when={r().breakpoint}>
                          <div class="bp" title={t("inspector.breakpoint")}>
                            {r().name} {fmt(r().chars)}c
                          </div>
                        </Show>
                      </>
                    )}
                  </For>
                </Match>
                <Match when={view() === "json"}>
                  <pre>{JSON.stringify(c(), null, 2)}</pre>
                </Match>
                <Match when={nativeTrace(c().out)}>
                  <Steps call={c()} facts={props.facts} cache={props.cache} />
                </Match>
                <Match when={c().via === "decision"}>
                  <For each={precheck(c().out).lines} keyed={false}>
                    {(l) => (
                      <div class="pline">
                        <span class="lb">{l().label}</span>
                        <span
                          class="bar"
                          style={{ "--bar-p": l().p ?? 0, "--bar-lo": LO, "--bar-hi": HI }}
                          data-none={l().p === null || undefined}
                        />
                        <span class="pv">{l().p === null ? "" : l().p!.toFixed(2)}</span>
                      </div>
                    )}
                  </For>
                  <Show when={precheck(c().out).error}>{(e) => <KeyValues of={{ error: e() }} />}</Show>
                </Match>
                <Match when={typeof c().out === "string"}>
                  <For each={pieces(c().out as string)} keyed={false}>
                    {(p) => (
                      <div class="piece">
                        <Show when={p().id}>{(id) => <span class="pill">{id()}</span>}</Show>
                        <p class="prose">
                          <Marked text={p().text} q={props.q} />
                        </p>
                      </div>
                    )}
                  </For>
                </Match>
                <Match when={props.row.phase === "polish"}>
                  <For each={polishPairs(c())} keyed={false}>
                    {(x) => (
                      <div class="rewrite">
                        <Show when={x().before}>
                          {(b) => (
                            <>
                              <span class="was">
                                <Marked text={b()} q={props.q} />
                              </span>
                              <Change aria-hidden="true" />
                            </>
                          )}
                        </Show>
                        <span>
                          <Marked text={x().after} q={props.q} />
                        </span>
                      </div>
                    )}
                  </For>
                </Match>
                <Match when={true}>
                  <KeyValues of={(c().out ?? {}) as Record<string, unknown>} />
                </Match>
              </Switch>
            </div>
          </div>
        </div>
      </Show>
    </details>
  )
}

const InspectBody = (props: { id: Id }) => {
  const all = read(log)
  const line = read(path)
  const view = read(card)
  const trace = createMemo(() => {
    all()
    return fetchTrace(props.id)
  })
  const detail = createMemo(() => {
    all()
    return fetchDetail(props.id)
  })
  const context = createMemo(() => {
    all()
    view()
    return fetchContext(props.id)
  })
  const node = createMemo(() => {
    const n = all().nodes.get(props.id)
    return n ? { ...n, ...detail() } : undefined
  })
  const at = () => line().findIndex((x) => x.id === props.id) // -1: a sibling off the reading line
  const vs = createMemo(() => (node() ? versions(all(), node()!) : { list: [], index: -1, varied: false }))
  const go = (d: number) => {
    const x = line()[at() + d]
    if (x) open({ inspect: x.id })
  }
  const mine = () => trace()
  // the server's gate: without `inspect` no call carries a request body
  const dev = createMemo(() => trace().some((c) => c.msgs.length > 0))
  const [pane, setPane] = createSignal<"pipeline" | "node">("pipeline")
  const [q, setQ] = createSignal("")
  const trows = createMemo(() => (node() ? rows(mine(), node()!) : []))
  const grouped = createMemo(() => groups(trows()))
  const sums = createMemo(() => totals(mine()))
  const ords = createMemo(() => ordinals(trows()))
  const cache = createMemo(() => cached(mine()))
  const nth = (r: Row) =>
    trows()
      .slice(0, trows().indexOf(r))
      .filter((x) => x.phase === r.phase).length
  const lastNarrate = () =>
    trows()
      .slice(0, settledAt(trows()))
      .findLast((r) => r.phase === "narrate")
  // the one open step, by its index in trows(): the reader's pick holds on the node it was made on; elsewhere the
  // last narrate is open. undefined: every step closed
  const [picked, setPicked] = createSignal<{ id: Id; index: number | undefined }>()
  const openAt = (): number | undefined => {
    const p = picked()
    if (p && p.id === props.id) return p.index
    const l = lastNarrate()
    return l && trows().indexOf(l)
  }
  const toggle = (i: number) => setPicked({ id: props.id, index: openAt() === i ? undefined : i })
  // a query (or a node under one) keeps the open step when it has hits, else opens the first step that has
  createEffect(
    () => [q(), props.id] as const,
    ([q]) => {
      if (!q) return
      untrack(() => {
        const hits = trows().map((r) => rowHits(r, q))
        const at = openAt()
        const first = hits.findIndex((h) => h > 0)
        if ((at === undefined || !hits[at]) && first >= 0) setPicked({ id: props.id, index: first })
      })
    },
  )
  // the node's readings, drawn by the Record's own elements; only the fields here (checks and clues sit in the pipeline)
  const changes = createMemo(() => {
    const r = view()?.rules
    const x = node()
    return r && x ? fields(r, x, whens(view())) : []
  })
  const shapeOf = (id: string) => view()?.layer?.products.find((p) => p.id === id)?.shape
  const facts = createMemo((): Facts => ({
    beats: node()?.beats ?? [],
    checks: node()?.checks ?? [],
    must: node()?.brief.must ?? [],
    label: (id) => view()?.layer?.products.find((p) => p.id === id)?.label ?? id,
    fields: (answers) => {
      const r = view()?.rules
      const paths = Object.entries(answers).flatMap(
        ([q, o]) =>
          r?.readouts
            ?.find((x) => x.id === q)
            ?.options.find((x) => x.id === o)
            ?.do.flatMap((e) => ("path" in e ? [e.path] : [])) ?? [],
      )
      return [...new Set(paths)].map((p) => r?.fields.find((f) => f.path === p)?.label ?? p)
    },
  }))
  const One = (p: { row: Row }) => (
    <Step
      row={p.row}
      facts={facts()}
      nth={nth(p.row)}
      ord={ords()[trows().indexOf(p.row)]}
      dev={dev()}
      cache={cache()}
      q={q()}
      open={trows().indexOf(p.row) === openAt()}
      onToggle={() => toggle(trows().indexOf(p.row))}
    />
  )
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
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
    <div class={{ inspect: true, cache: cache() }} data-pane={pane()}>
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
          <span class="sums">
            <Metrics ms={sums().ms} usage={sums()} cache={cache()} />
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
            <Show when={context().playerCatalog.length}>{(n) => <span class="v">{n()}</span>}</Show>
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
                              <span class="tl">
                                {t("common.draft")} {tray().draft}
                                <Show when={tray().failed}>
                                  <span class="pill">{t("inspector.discarded")}</span>
                                </Show>
                              </span>
                              <span class="metrics">
                                <span class="mt">{secs(tray().rows.reduce((n, r) => n + r.call.ms, 0))}</span>
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
                <Show when={(x().input.text && x().input.note) || x().input.invoke?.length}>
                  <div class="pills">
                    <Show when={x().input.text && x().input.note}>
                      <span class="pill">note: {x().input.note}</span>
                    </Show>
                    <For each={x().invocations} keyed={(i) => i.resourceId}>
                      {(item) => <span class="pill">{item().title}</span>}
                    </For>
                  </div>
                </Show>
              </div>
              <div class="sechead">
                <span class="lbl">{t("inspector.untold")}</span>
              </div>
              <Show when={context().playerCatalog.length} fallback={<p class="dim">{t("inspector.nothingLeft")}</p>}>
                <div class="hooks">
                  <For each={context().playerCatalog} keyed={(r) => r.resourceId}>
                    {(r) => (
                      <div class="hook">
                        <span class="hb">
                          <span class="hid">{r().title}</span>
                          <span class="ht">{r().summary}</span>
                        </span>
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
              <For each={Object.entries(x().products)} keyed={([k]) => k}>
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

export const Inspect = (props: { id: Id }) => (
  <AsyncView>
    <InspectBody id={props.id} />
  </AsyncView>
)
