// The settings page's 模型服务 section: the provider list, one provider's detail (key, endpoint, grouped models), its
// two drawers (request settings, the service's model list), the key vault's drawer (the section's, with or without a
// provider in hand) and its dialogs (add a provider, one model's settings, add a
// model by id). Every write goes through wire.ts and comes back as the list; the drafts here are the drawer's and the
// dialogs', written on Save, on close and on submit.
import type { Effort } from "@effect-tavern/provider/src/call.ts"
import { DEFAULTS, type Capabilities } from "@effect-tavern/provider/src/capabilities.ts"
import { lookup } from "@effect-tavern/provider/src/names.ts"
import type { ModelEntry, Probe, Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import { createEffect, createSignal, For, onSettled, Show, untrack } from "solid-js"
import { read } from "./bridge.ts"
import {
  ask,
  Avatar,
  Drawer,
  FORMAT,
  FORMATS,
  grouped,
  Menu,
  Modal,
  Name,
  newId,
  preview,
  Switch,
  ToList,
  type Pane,
} from "./controls.tsx"
import { Family } from "./family.tsx"
import {
  Check,
  Clue,
  Close,
  Copy,
  Eye,
  EyeOff,
  Fold,
  Key,
  Minus,
  Next,
  Settings as Gear,
  Snippets as Plus,
  Sync,
  Trash,
} from "./icons.tsx"
import { hats, names, providers, registry, secrets } from "./store.ts"
import {
  addSecret,
  deleteProvider,
  deleteSecret,
  listModels,
  putProvider,
  secretValue,
  setSecret,
  testProvider,
  type Listed,
} from "./wire.ts"

const EFFORTS: [Effort, string][] = [
  ["off", "关闭"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["max", "最高"],
]
const providerOf = (id: string) => registry.get(providers).find((p) => p.id === id)
/** For handlers and snapshots (the registry, not a tracked read); JSX reads `vault()` itself. */
const secretOf = (p: Provider): SecretView | undefined => registry.get(secrets).find((s) => s.id === p.secret)
/** Added as listed: with the format the listing put them under when that is off the provider's default. One already
 *  there with no format of its own takes the listing's too (添加全部 fixes what 更正 would), one the player set stays. */
const addModels = (p: Provider, models: readonly Listed[]) =>
  void putProvider({
    ...p,
    models: [
      ...p.models.map((x) => {
        const listed = models.find((m) => m.id === x.id)
        return x.format === undefined && listed?.format ? { ...x, format: listed.format } : x
      }),
      ...models
        .filter((m) => !p.models.some((x) => x.id === m.id))
        .map(({ id, format }) => ({ id, ...(format && { format }) })),
    ],
  })
const removeModels = (p: Provider, ids: readonly string[]) =>
  void putProvider({ ...p, models: p.models.filter((m) => !ids.includes(m.id)) })
/** A model id matches a search by itself or by its table name. */
const hit = (id: string, q: string) =>
  `${id} ${lookup(read(names)(), id)?.name ?? ""}`.toLowerCase().includes(q.toLowerCase())
/** A model row's text: the table's name over the raw id, or the id alone when the table does not know it. */
const ModelName = (props: { id: string }) => (
  <Show when={lookup(read(names)(), props.id)} fallback={<span class="m-name">{props.id}</span>}>
    {(m) => (
      <span class="m-name">
        {m().name}
        <span class="m-id mono">{props.id}</span>
      </span>
    )}
  </Show>
)
/** A button inside a group's summary: it acts, the summary does not fold. */
const quiet = (run: () => void) => (e: MouseEvent) => (e.preventDefault(), e.stopPropagation(), run())
/** The endpoints with one format's URL set, or dropped when it is emptied. */
const setUrl = (p: Provider, f: Format, url: string): Provider["endpoints"] => {
  const { [f]: old, ...rest } = p.endpoints
  return url.trim() ? { ...rest, [f]: { ...old, url: url.trim() } } : rest
}
const AUTH: { value: SecretView["type"]; label: string }[] = [
  { value: "api_key", label: "API Key Header" },
  { value: "auth_token", label: "Bearer Token" },
]
/** A key onto the clipboard, then `flash` for a moment. A plain-http page off localhost (a phone on the LAN) has no
 *  clipboard: the button then does nothing. */
const copyKey = async (value: string | Promise<string>, flash: (on: boolean) => void) => {
  const v = await value
  if (!v || !navigator.clipboard) return
  await navigator.clipboard.writeText(v)
  flash(true)
  setTimeout(() => flash(false), 1200)
}
/** A latency for a slot of one width: `240ms`, `1.2s` past a second. */
const took = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
/** What a probe that could not be made looks like (the server refused the request: no key, no endpoint): no URL. */
const refused = (e: unknown): Probe => ({
  formats: [],
  url: "",
  method: "",
  status: 0,
  ms: 0,
  ok: false,
  error: e instanceof Error ? e.message : String(e),
})
/** A listing probe's verdict, by the status first (0: nothing answered, the proxy or the route), then by what the
 *  address said: a listing, a refused key, no listing there, a page that is not an API, some other status. */
const verdict = (p: Probe): { text: string; tone: "ok" | "bad" | "" } =>
  !p.url
    ? { text: "无法检测", tone: "bad" }
    : p.status === 0
      ? { text: "不通", tone: "bad" }
      : p.ok
        ? { text: `已连通 · ${took(p.ms)}`, tone: "ok" }
        : p.status === 401 || p.status === 403
          ? { text: "已连通 · key 被拒", tone: "bad" }
          : p.status === 404
            ? { text: "已连通 · 该端点不提供模型列表", tone: "" }
            : p.status < 300
              ? { text: "已连通 · 不是模型列表", tone: "bad" }
              : { text: `已连通 · HTTP ${p.status}`, tone: "bad" }
/** The request a probe made, for a hint: `GET https://… → HTTP 400`. */
const sent = (p: Probe) => (p.url ? `${p.method} ${p.url}${p.status ? ` → HTTP ${p.status}` : ""}` : undefined)
const ERR_CAP = 300
/** The bar under a probe that failed: the request as sent, the socket's code, the error to ERR_CAP characters (a
 *  gateway's error body can be a whole page; the copy carries all of it). Wraps; never on the row it explains. */
const ProbeError = (props: { probe: Probe }) => {
  const [copied, setCopied] = createSignal(false)
  const error = () => props.probe.error ?? ""
  // the code, unless the message already opens with it (Bun's fetch errors do)
  const code = () => (props.probe.code && !error().startsWith(props.probe.code) ? `${props.probe.code}: ` : "")
  const full = () => [sent(props.probe), `${code()}${error()}`].filter(Boolean).join("\n")
  return (
    <div class="probe-err">
      <div class="probe-err-text">
        <Show when={sent(props.probe)}>{(s) => <span class="mono">{s()}</span>}</Show>
        <span>
          {code()}
          {error().length > ERR_CAP ? `${error().slice(0, ERR_CAP)}…` : error()}
        </span>
      </div>
      <button
        type="button"
        class="icon sm"
        aria-label="复制报错"
        data-hint="复制报错"
        onClick={() => void copyKey(full(), setCopied)}
      >
        <Show when={copied()} fallback={<Copy />}>
          <Check />
        </Show>
      </button>
    </div>
  )
}
const DRAWER_OUT = 250 // ms: past the drawer's --dur-3 slide, so its content leaves with it
/** Opens a dialog component from its parent: the dialog hands its open function up through `opener`. */
type Opener<A> = (open: (a: A) => void) => void

export const Providers = (props: Pane) => {
  const list = read(providers)
  const [search, setSearch] = createSignal("")
  const shown = () => list().filter((p) => p.name.toLowerCase().includes(search().toLowerCase()))
  const current = () => list().find((p) => p.id === props.picked) ?? list()[0]
  let openAdd: () => void = () => {}
  // the vault drawer: the section's, so it opens with no provider too; `vaultFor` is the provider it was opened from
  const [vaultOpen, setVaultOpen] = createSignal(false)
  const [vaultFor, setVaultFor] = createSignal<string | undefined>()
  const openVault = (id: string | undefined) => (setVaultFor(id), setVaultOpen(true))
  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(":popover-open, dialog[open]") && vaultOpen())
        setVaultOpen(false)
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })
  return (
    <>
      <aside class="master-card" aria-label="服务商">
        <div class="master-top">
          <div class="input-box">
            <Clue aria-hidden="true" />
            <input
              type="search"
              placeholder="搜索模型平台..."
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="master-list scroller">
          <For each={shown()} keyed={(p) => p.id}>
            {(p) => (
              <button
                type="button"
                class="p-row"
                aria-selected={p().id === current()?.id ? "true" : "false"}
                onClick={() => props.onPick(p().id)}
              >
                <Avatar name={p().name} />
                <span class="p-name">{p().name}</span>
                <span class={{ dot: true, on: p().enabled }} />
              </button>
            )}
          </For>
        </div>
        <div class="master-foot row">
          <button type="button" class="btn" onClick={() => openAdd()}>
            <Plus /> <span>添加服务商</span>
          </button>
          <button
            type="button"
            class="icon boxed"
            aria-label="密钥库"
            data-hint="密钥库"
            onClick={() => (props.onPick(props.picked ?? ""), openVault(undefined))}
          >
            <Key />
          </button>
        </div>
      </aside>
      <section class="detail-card" aria-label="服务商详情">
        {/* keyed by id: another provider is a fresh detail (key, probe, search, drawer start over), a save is not */}
        <Show when={current()?.id} keyed fallback={<div class="empty">尚未添加服务商</div>}>
          {(id) => <ProviderDetail id={id} onBack={props.onBack} onVault={() => openVault(id)} />}
        </Show>
        <Drawer open={vaultOpen()} label="密钥库" onClose={() => setVaultOpen(false)}>
          <VaultDrawer for={vaultFor()} onClose={() => setVaultOpen(false)} />
        </Drawer>
      </section>
      <AddProviderDialog opener={(f) => (openAdd = () => f(undefined))} onAdded={props.onPick} />
    </>
  )
}

const ProviderDetail = (props: { id: string; onBack: () => void; onVault: () => void }) => {
  const list = read(providers)
  const vault = read(secrets)
  const p = () => list().find((x) => x.id === props.id)
  const save = (f: (p: Provider) => Provider) => {
    const x = p()
    if (x) void putProvider(f(x))
  }
  const [typed, setTyped] = createSignal("") // a key being typed
  const [reveal, setReveal] = createSignal(false)
  // the stored key while the eye is open, read on that click and dropped when it closes or the secret changes
  const [plain, setPlain] = createSignal<{ id: string; value: string } | null>(null)
  const [copied, setCopied] = createSignal(false)
  // the probes' results, this detail's only (it remounts per provider): the connectivity's, and one per model tested.
  // They answer the configuration they ran on, so a change to it clears them (the effects below)
  const [reach, setReach] = createSignal<Probe[] | "running" | null>(null)
  const [tests, setTests] = createSignal<Record<string, Probe | "running" | undefined>>({})
  const [batch, setBatch] = createSignal<AbortController | null>(null) // 检测全部 in flight
  let reachRun: object | null = null // the connectivity run whose result may land; another run or a clear voids it
  const inflight = new Map<string, number>() // per model, the test whose result may land, the same way
  const clearResults = () => {
    reachRun = null
    inflight.clear()
    batch()?.abort()
    setBatch(null)
    setReach(null)
    setTests({})
  }
  const [mq, setMq] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [folded, setFolded] = createSignal(false)
  const [drawer, setDrawer] = createSignal<"endpoint" | "sync" | null>(null)
  // what the drawer shows: set as it opens, kept while it slides out (DRAWER_OUT)
  const [shown, setShown] = createSignal<"endpoint" | "sync" | null>(null)
  const open = (d: "endpoint" | "sync") => (setShown(d), setDrawer(d))
  const shut = () => {
    setDrawer(null)
    setTimeout(() => drawer() || setShown(null), DRAWER_OUT)
  }
  let openModel: (m: ModelEntry) => void = () => {}
  let openAddModel: () => void = () => {}

  /** A typed key goes up once. Retyped on the provider's own secret (the one named after it), the value is replaced in
   *  place; on a secret the player named in the vault, it is a new secret under the provider's name. */
  // the key's write in flight: a drawer's first request and the probe wait for it, or they would go out keyless
  let savingKey: Promise<void> | undefined
  const keySaved = () => savingKey ?? Promise.resolve()
  const storeKey = (): Promise<void> => {
    const run: Promise<void> = writeKey()
      .then((how) => {
        // a key replaced in place changes nothing the effects below watch: the results go here, and the address
        // is tried with the new key (a new secret changes the provider, and the effect does the same)
        if (how === "rekeyed") {
          clearResults()
          void runReach()
        }
      })
      .finally(() => {
        if (savingKey === run) savingKey = undefined
      })
    savingKey = run
    return run
  }
  /** The key's type is the key's to say (the server reads it off the value); the vault's menu overrides it there. */
  const writeKey = async (): Promise<"rekeyed" | "added" | undefined> => {
    const x = p()
    const value = typed().trim()
    if (!x || !value) return
    const own = secretOf(x)
    setTyped("")
    setPlain(null)
    if (own && own.name === x.name) {
      await setSecret(own.id, { name: own.name, value })
      return "rekeyed"
    }
    const s = await addSecret({ name: x.name, value })
    await putProvider({ ...x, secret: s.id })
    return "added"
  }
  /** What the field holds: the typed text, else the stored key while the eye is open on it. */
  const shownKey = (x: Provider) => typed() || (reveal() && plain()?.id === x.secret ? plain()!.value : "")
  const flipReveal = async () => {
    const on = !reveal() // a write lands on the next microtask: read the new value from here, not the signal
    setReveal(on)
    const x = p()
    if (!on) return setPlain(null)
    if (x && !typed() && secretOf(x)) setPlain({ id: x.secret!, value: await secretValue(x.secret!) })
  }
  const stored = (x: Provider) => (secretOf(x) ? secretValue(x.secret!) : "")
  /** Connectivity: the listing from every endpoint the provider has, through its proxy with its key; no model, no
   *  token. A key being typed goes up first, or the probe would go out without it. */
  const runReach = async () => {
    const x = p()
    if (!x) return
    if (typed().trim()) void storeKey()
    await keySaved()
    const run = (reachRun = {})
    setReach("running")
    const got = await testProvider(x.id).catch((e: unknown) => [refused(e)])
    if (reachRun === run) setReach(got)
  }
  /** One model: a one-token request under its format. */
  const testOne = async (id: string) => {
    const x = p()
    if (!x) return
    if (typed().trim()) void storeKey() // a key still in the field goes up first, as on runReach
    await keySaved()
    const n = (inflight.get(id) ?? 0) + 1
    inflight.set(id, n)
    setTests((t) => ({ ...t, [id]: "running" }))
    const got = await testProvider(x.id, id).then(
      (r) => r[0] ?? refused(new Error("no probe")),
      (e: unknown) => refused(e),
    )
    if (inflight.get(id) === n) setTests((t) => ({ ...t, [id]: got }))
  }
  /** Every model the list shows (a search narrows it), three at a time, in list order; the stop lets the three in
   *  flight finish and starts no more. */
  const testAll = async () => {
    const x = p()
    if (!x || batch()) return
    if (typed().trim()) void storeKey() // once, ahead of the queue: a rekey clears the results, so before any lands
    await keySaved()
    const ac = new AbortController()
    setBatch(ac)
    const queue = models(x)
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined && !ac.signal.aborted; id = queue.shift()) await testOne(id)
    }
    await Promise.all([worker(), worker(), worker()])
    if (batch() === ac) setBatch(null)
  }
  const stopAll = () => {
    batch()?.abort()
    setBatch(null)
  }
  const done = (t: Probe | "running" | undefined): Probe | undefined => (t && t !== "running" ? t : undefined)
  const failed = (t: Probe | "running" | undefined): Probe | undefined => (done(t)?.ok === false ? done(t) : undefined)
  const slot = (t: Probe | "running" | undefined) =>
    t === undefined ? "检测" : t === "running" ? "…" : t.ok ? took(t.ms) : "失败"
  // the results answer the configuration they ran on: the address, the proxy, the headers, the key or the default
  // protocol changed clears them all and tries the address again (it was just saved: this is the moment to know);
  // a model's own protocol changed clears that model's
  createEffect(
    () => {
      const x = p()
      return x && JSON.stringify([x.endpoints, x.proxy, x.headers, x.secret, x.defaultFormat])
    },
    (fp, prev) => {
      if (prev !== undefined && fp !== undefined && fp !== prev) {
        clearResults()
        void runReach()
      }
    },
  )
  createEffect(
    () => {
      const x = p()
      return Object.fromEntries((x?.models ?? []).map((m) => [m.id, m.format ?? x!.defaultFormat]))
    },
    (now, prev) => {
      if (!prev) return
      const changed = Object.keys(now).filter((id) => prev[id] !== undefined && prev[id] !== now[id])
      if (!changed.length) return
      for (const id of changed) inflight.delete(id)
      setTests((t) => Object.fromEntries(Object.entries(t).filter(([id]) => !changed.includes(id))))
    },
  )
  const endpoints = (x: Provider) => FORMATS.filter((f) => x.endpoints[f]?.url.trim()).length
  const models = (x: Provider) => x.models.map((m) => m.id).filter((id) => hit(id, mq()))

  onSettled(() => {
    // the page's Escape leaves the drawer to this: it closes the drawer, not the page (settings.tsx checks the DOM)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(":popover-open, dialog[open]") && drawer()) shut()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })

  return (
    <Show when={p()}>
      {(x) => (
        <>
          <header class="detail-header">
            <ToList onBack={props.onBack} />
            <Name value={x().name} label="服务商名称" onCommit={(name) => save((y) => ({ ...y, name }))} />
            <span class="spacer" />
            <button
              type="button"
              class="icon sm"
              aria-label="删除服务商"
              onClick={() => ask(`删除服务商「${x().name}」？`, () => void deleteProvider(x().id))}
            >
              <Trash />
            </button>
            <Switch on={x().enabled} label="启用服务商" onFlip={() => save((y) => ({ ...y, enabled: !y.enabled }))} />
          </header>
          <div class="detail-scroll scroller">
            <div class="block">
              <div class="block-title">
                <h3>API 密钥</h3>
              </div>
              <div
                class="row keyrow"
                onFocusOut={(e) =>
                  !e.currentTarget.contains(e.relatedTarget as Node | null) && typed().trim() && void storeKey()
                }
              >
                <div class="input-box grow">
                  <input
                    type={reveal() ? "text" : "password"}
                    class="mono"
                    autocomplete="off"
                    value={shownKey(x())}
                    placeholder={vault().find((s) => s.id === x().secret)?.hint ?? "输入或从密钥库选择"}
                    aria-label="API 密钥"
                    onInput={(e) => (setTyped(e.currentTarget.value), setPlain(null))}
                    onKeyDown={(e) => e.key === "Enter" && void storeKey()}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={reveal() ? "隐藏密钥" : "显示密钥"}
                    data-hint={reveal() ? "隐藏密钥" : "显示密钥"}
                    onClick={() => void flipReveal()}
                  >
                    <Show when={reveal()} fallback={<Eye />}>
                      <EyeOff />
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label="复制密钥"
                    data-hint="复制密钥"
                    onClick={() => void copyKey(typed().trim() || stored(x()), setCopied)}
                  >
                    <Show when={copied()} fallback={<Copy />}>
                      <Check />
                    </Show>
                  </button>
                </div>
                <button
                  type="button"
                  class="icon boxed"
                  aria-label="密钥库"
                  data-hint="密钥库"
                  onClick={() => (typed().trim() && void storeKey(), props.onVault())}
                >
                  <Key />
                </button>
                {/* connectivity: a tag per distinct listing URL, each a button that runs it again (the proxy may have
                    changed outside this page); a verdict is one of a few fixed strings, so the tags hold their width */}
                <div class="probes">
                  <Show
                    when={reach()}
                    fallback={
                      <button type="button" class="tag act" onClick={() => void runReach()}>
                        检测
                      </button>
                    }
                  >
                    {(r) => (
                      <Show
                        when={r() !== "running" ? (r() as Probe[]) : undefined}
                        fallback={<span class="tag">…</span>}
                      >
                        {(probes) => (
                          <For each={probes()} keyed={false}>
                            {(pr) => {
                              const v = () => verdict(pr())
                              return (
                                <button
                                  type="button"
                                  class={{ tag: true, act: true, ok: v().tone === "ok", bad: v().tone === "bad" }}
                                  data-hint={sent(pr())}
                                  onClick={() => void runReach()}
                                >
                                  {probes().length > 1
                                    ? `${pr()
                                        .formats.map((f) => FORMAT[f])
                                        .join("/")} · `
                                    : ""}
                                  {v().text}
                                </button>
                              )
                            }}
                          </For>
                        )}
                      </Show>
                    )}
                  </Show>
                </div>
              </div>
              {/* a failed probe explains itself under the row; a 404 does not: the address answered, it just lists nothing */}
              <Show when={reach() !== "running" ? (reach() as Probe[] | null) : null}>
                {(probes) => (
                  <For each={probes().filter((pr) => !pr.ok && pr.status !== 404)} keyed={false}>
                    {(pr) => <ProbeError probe={pr()} />}
                  </For>
                )}
              </Show>
            </div>

            <div class="block">
              <div class="block-title">
                <h3>API 地址</h3>
                <button type="button" class="link" onClick={() => open("endpoint")}>
                  添加端点
                </button>
                <div class="right">
                  <span class="tag">
                    {FORMAT[x().defaultFormat]} · 默认
                    {endpoints(x()) > 1 ? ` (+${endpoints(x()) - 1})` : ""}
                  </span>
                </div>
              </div>
              <div class="row">
                <div class="input-box grow">
                  <input
                    type="url"
                    class="mono"
                    value={x().endpoints[x().defaultFormat]?.url ?? ""}
                    placeholder="https://api.example.com"
                    aria-label="API 地址"
                    onChange={(e) =>
                      save((y) => ({ ...y, endpoints: setUrl(y, y.defaultFormat, e.currentTarget.value) }))
                    }
                  />
                </div>
                <button type="button" class="icon boxed" aria-label="请求配置" onClick={() => open("endpoint")}>
                  <Gear />
                </button>
              </div>
            </div>

            <div class="block">
              <div class="block-title">
                <h3>模型</h3>
                <button
                  type="button"
                  class="icon sm"
                  aria-label="展开或折叠分组"
                  aria-pressed={folded() ? "true" : "false"}
                  onClick={() => setFolded(!folded())}
                >
                  <Fold />
                </button>
                <label class="inline-search" data-open={searching() || !!mq() ? "true" : "false"}>
                  <Clue aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="搜索模型..."
                    aria-label="搜索模型"
                    value={mq()}
                    onFocus={() => setSearching(true)}
                    onBlur={() => setSearching(false)}
                    onInput={(e) => setMq(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") return
                      e.preventDefault() // the search's Escape: the page stays
                      setMq("")
                      e.currentTarget.blur()
                    }}
                  />
                </label>
                <div class="right">
                  <Show when={x().models.length}>
                    <Show
                      when={batch()}
                      fallback={
                        <button type="button" class="btn sm ghost" onClick={() => void testAll()}>
                          检测全部
                        </button>
                      }
                    >
                      <button type="button" class="btn sm ghost" onClick={stopAll}>
                        停止
                      </button>
                    </Show>
                  </Show>
                  <div class="btn-join">
                    <button type="button" class="btn sm" onClick={() => open("sync")}>
                      <Sync /> <span>同步模型</span>
                    </button>
                    <button type="button" class="btn sm" aria-label="手动添加模型" onClick={() => openAddModel()}>
                      <Plus />
                    </button>
                  </div>
                </div>
              </div>
              <div class="groups">
                <For
                  each={grouped(models(x()))}
                  keyed={(g) => g[0]}
                  fallback={
                    <div class="empty-card">
                      <span>{mq() ? "无匹配模型" : "尚未添加模型"}</span>
                      <Show when={!mq()}>
                        <button type="button" class="btn sm" onClick={() => open("sync")}>
                          <Sync /> 同步模型列表
                        </button>
                      </Show>
                    </div>
                  }
                >
                  {(g) => (
                    <details class="group" open={!folded()}>
                      <summary>
                        <Next class="chev" />
                        <span>{g()[0]}</span>
                        <span class="acts">
                          <button
                            type="button"
                            class="icon sm"
                            aria-label="移除分组"
                            onClick={quiet(() =>
                              ask(`移除「${g()[0]}」分组的 ${g()[1].length} 个模型？`, () => removeModels(x(), g()[1])),
                            )}
                          >
                            <Trash />
                          </button>
                        </span>
                      </summary>
                      <For each={g()[1]} keyed={(id) => id}>
                        {(id) => {
                          const t = () => tests()[id()]
                          return (
                            <>
                              <div class="m-row">
                                <Family id={id()} />
                                <ModelName id={id()} />
                                {/* the test's slot: one width through its states, so the row never reflows; a
                                    result shows the time or 失败, and a press tests again */}
                                <button
                                  type="button"
                                  class={{ "m-probe": true, ok: !!done(t())?.ok, bad: !!failed(t()) }}
                                  aria-label={`检测 ${id()}`}
                                  data-hint={done(t()) && sent(done(t())!)}
                                  disabled={t() === "running"}
                                  onClick={() => void testOne(id())}
                                >
                                  {slot(t())}
                                </button>
                                <button
                                  type="button"
                                  class="icon sm"
                                  aria-label="模型设置"
                                  onClick={() => openModel(x().models.find((m) => m.id === id())!)}
                                >
                                  <Gear />
                                </button>
                                <button
                                  type="button"
                                  class="icon sm"
                                  aria-label="移除模型"
                                  onClick={() => removeModels(x(), [id()])}
                                >
                                  <Minus />
                                </button>
                              </div>
                              <Show when={failed(t())}>{(pr) => <ProbeError probe={pr()} />}</Show>
                            </>
                          )
                        }}
                      </For>
                    </details>
                  )}
                </For>
              </div>
            </div>
          </div>

          <Drawer open={!!drawer()} label={shown() === "sync" ? "同步模型" : "请求配置"} onClose={shut}>
            <Show when={shown() === "endpoint"}>
              <RequestDrawer id={props.id} ready={keySaved} onClose={shut} />
            </Show>
            <Show when={shown() === "sync"}>
              <SyncDrawer id={props.id} ready={keySaved} onClose={shut} />
            </Show>
          </Drawer>
          <ModelDialog id={props.id} opener={(f) => (openModel = f)} />
          <AddModelDialog id={props.id} opener={(f) => (openAddModel = () => f(undefined))} />
        </>
      )}
    </Show>
  )
}

// ───────── The request drawer: a draft of the provider's request settings, written on Save ─────────
interface Request {
  defaultFormat: Format
  endpoints: Record<Format, { url: string; exactPrefix: boolean }>
  ttl: "5m" | "1h"
  proxy: "env" | "direct" | "custom"
  proxyUrl: string
  headers: [string, string][]
}
const requestOf = (p: Provider): Request => ({
  defaultFormat: p.defaultFormat,
  endpoints: Object.fromEntries(
    FORMATS.map((f) => [f, { url: p.endpoints[f]?.url ?? "", exactPrefix: !!p.endpoints[f]?.exactPrefix }]),
  ) as Request["endpoints"],
  ttl: p.cacheTtl ?? "5m",
  proxy: p.proxy === undefined ? "env" : p.proxy === false ? "direct" : "custom",
  proxyUrl: typeof p.proxy === "string" ? p.proxy : "",
  headers: Object.entries(p.headers ?? {}),
})
const applied = (p: Provider, r: Request): Provider => {
  const headers = Object.fromEntries(r.headers.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]))
  const { cacheTtl: _t, proxy: _p, headers: _h, ...rest } = p
  return {
    ...rest,
    defaultFormat: r.defaultFormat,
    endpoints: Object.fromEntries(
      FORMATS.filter((f) => r.endpoints[f].url.trim()).map((f) => [
        f,
        { url: r.endpoints[f].url.trim(), ...(r.endpoints[f].exactPrefix && { exactPrefix: true }) },
      ]),
    ),
    ...(r.ttl === "1h" && { cacheTtl: "1h" as const }),
    ...(r.proxy === "direct" && { proxy: false as const }),
    ...(r.proxy === "custom" && r.proxyUrl.trim() && { proxy: r.proxyUrl.trim() }),
    ...(Object.keys(headers).length && { headers }),
  }
}

const RequestDrawer = (props: { id: string; ready: () => Promise<void>; onClose: () => void }) => {
  const start = untrack(() => providerOf(props.id))
  const [r, setR] = createSignal<Request | undefined>(start && requestOf(start))
  const edit = (f: (r: Request) => Request) => setR((x) => (x ? f(x) : x))
  const setEndpoint = (f: Format, patch: Partial<Request["endpoints"][Format]>) =>
    edit((x) => ({ ...x, endpoints: { ...x.endpoints, [f]: { ...x.endpoints[f], ...patch } } }))
  const sample = () => providerOf(props.id)?.models[0]?.id
  const save = async () => {
    await props.ready()
    const p = providerOf(props.id)
    const d = r()
    if (!p || !d) return
    await putProvider(applied(p, d))
    props.onClose()
  }
  return (
    <Show when={r()}>
      {(d) => (
        <>
          <div class="drawer-head">
            <h3>请求配置</h3>
            <span class="spacer" />
            <button type="button" class="icon sm" aria-label="关闭" onClick={() => props.onClose()}>
              <Close />
            </button>
          </div>
          <div class="drawer-body scroller">
            <For each={FORMATS} keyed={(f) => f}>
              {(f) => (
                <div class="field-group">
                  <div class="label-row">
                    <span class="fmt">
                      <strong>{FORMAT[f()]}</strong>
                      <Show
                        when={d().defaultFormat === f()}
                        fallback={
                          <button
                            type="button"
                            class="btn xs"
                            onClick={() => edit((x) => ({ ...x, defaultFormat: f() }))}
                          >
                            设为默认
                          </button>
                        }
                      >
                        <span class="tag ok">默认</span>
                      </Show>
                    </span>
                    <span class="exact">
                      <span>精确前缀</span>
                      <Switch
                        on={d().endpoints[f()].exactPrefix}
                        label={`${FORMAT[f()]} 精确前缀`}
                        onFlip={() => setEndpoint(f(), { exactPrefix: !d().endpoints[f()].exactPrefix })}
                      />
                    </span>
                  </div>
                  <div class="input-box">
                    <input
                      type="url"
                      class="mono"
                      value={d().endpoints[f()].url}
                      placeholder="Base URL: https://example.com"
                      aria-label={`${FORMAT[f()]} 地址`}
                      onInput={(e) => setEndpoint(f(), { url: e.currentTarget.value })}
                    />
                  </div>
                  <Show when={d().endpoints[f()].url.trim()}>
                    {(url) => {
                      const pv = () => preview(f(), url(), d().endpoints[f()].exactPrefix, sample())
                      return <div class={{ resolved: true, err: !pv().ok }}>{pv().text}</div>
                    }}
                  </Show>
                </div>
              )}
            </For>
            <div class="drawer-more">
              {/* no auth menu here: how a key is sent is the key's (the vault's), not the endpoint's */}
              <div class="pair">
                <div class="field-group">
                  <span class="label">缓存有效期</span>
                  <Menu
                    small
                    label="缓存有效期"
                    value={d().ttl}
                    options={[
                      { value: "5m", label: "5 分钟" },
                      { value: "1h", label: "1 小时" },
                    ]}
                    onPick={(ttl) => edit((x) => ({ ...x, ttl }))}
                  />
                </div>
                <div class="field-group">
                  <span class="label">网络代理</span>
                  <Menu
                    small
                    label="网络代理"
                    value={d().proxy}
                    options={[
                      { value: "env", label: "跟随系统环境" },
                      { value: "direct", label: "强制直连" },
                      { value: "custom", label: "自定义代理地址" },
                    ]}
                    onPick={(proxy) => edit((x) => ({ ...x, proxy }))}
                  />
                </div>
              </div>
              <Show when={d().proxy === "custom"}>
                <div class="input-box sm">
                  <input
                    type="url"
                    class="mono"
                    placeholder="http://127.0.0.1:7890"
                    aria-label="代理地址"
                    value={d().proxyUrl}
                    onInput={(e) => {
                      const proxyUrl = e.currentTarget.value
                      edit((x) => ({ ...x, proxyUrl }))
                    }}
                  />
                </div>
              </Show>
              <div class="field-group">
                <span class="label">自定义请求头</span>
                <For each={d().headers} keyed={false}>
                  {(h, i) => (
                    <div class="header-row">
                      <div class="input-box sm">
                        <input
                          type="text"
                          class="mono"
                          placeholder="Header"
                          aria-label="请求头名称"
                          value={h()[0]}
                          onInput={(e) => {
                            const k = e.currentTarget.value
                            edit((x) => ({ ...x, headers: x.headers.map((y, j) => (j === i ? [k, y[1]] : y)) }))
                          }}
                        />
                      </div>
                      <div class="input-box sm">
                        <input
                          type="text"
                          class="mono"
                          placeholder="Value"
                          aria-label="请求头值"
                          value={h()[1]}
                          onInput={(e) => {
                            const v = e.currentTarget.value
                            edit((x) => ({ ...x, headers: x.headers.map((y, j) => (j === i ? [y[0], v] : y)) }))
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        class="icon sm"
                        aria-label="移除请求头"
                        onClick={() => edit((x) => ({ ...x, headers: x.headers.filter((_, j) => j !== i) }))}
                      >
                        <Close />
                      </button>
                    </div>
                  )}
                </For>
                <button
                  type="button"
                  class="dashed"
                  onClick={() => edit((x) => ({ ...x, headers: [...x.headers, ["", ""]] }))}
                >
                  <Plus /> <span>添加请求头</span>
                </button>
              </div>
            </div>
          </div>
          <div class="drawer-foot">
            <button type="button" class="btn" onClick={() => props.onClose()}>
              取消
            </button>
            <button type="button" class="btn primary" onClick={() => void save()}>
              保存
            </button>
          </div>
        </>
      )}
    </Show>
  )
}

// ───────── The vault drawer: every secret, named, typed, revealed or copied one click at a time ─────────
const VaultDrawer = (props: { for: string | undefined; onClose: () => void }) => {
  const vault = read(secrets)
  const list = read(providers)
  const target = () => list().find((p) => p.id === props.for)
  const [draft, setDraft] = createSignal<{ name: string; type: SecretView["type"]; value: string }>({
    name: "",
    type: "api_key",
    value: "",
  })
  const add = async () => {
    const d = draft()
    if (!d.name.trim() || !d.value.trim()) return
    await addSecret({ name: d.name.trim(), type: d.type, value: d.value.trim() })
    setDraft({ ...d, name: "", value: "" })
  }
  return (
    <>
      <div class="drawer-head">
        <h3>密钥库</h3>
        <Show when={target()}>{(t) => <span class="tag">{t().name}</span>}</Show>
        <span class="spacer" />
        <button type="button" class="icon sm" aria-label="关闭" onClick={() => props.onClose()}>
          <Close />
        </button>
      </div>
      <div class="drawer-body scroller">
        <div class="field-group">
          <span class="label">添加密钥</span>
          <div class="row">
            <div class="input-box sm grow">
              <input
                type="text"
                placeholder="密钥名称"
                aria-label="密钥名称"
                value={draft().name}
                onInput={(e) => {
                  const name = e.currentTarget.value
                  setDraft((d) => ({ ...d, name }))
                }}
              />
            </div>
            <Menu
              small
              label="认证方式"
              value={draft().type}
              options={AUTH}
              onPick={(type) => setDraft((d) => ({ ...d, type }))}
            />
          </div>
          <div class="row">
            <div class="input-box sm grow">
              <input
                type="password"
                class="mono"
                autocomplete="off"
                placeholder="密钥"
                aria-label="密钥"
                value={draft().value}
                onInput={(e) => {
                  const value = e.currentTarget.value
                  setDraft((d) => ({ ...d, value }))
                }}
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
            </div>
            <button
              type="button"
              class="btn sm"
              disabled={!draft().name.trim() || !draft().value.trim()}
              onClick={() => void add()}
            >
              添加
            </button>
          </div>
        </div>
        <For each={vault()} keyed={(s) => s.id} fallback={<p class="none">密钥库为空</p>}>
          {(s) => {
            const [plain, setPlain] = createSignal<string | null>(null) // read on the eye's click, dropped on the next
            const [copied, setCopied] = createSignal(false)
            const flip = async () => setPlain(plain() === null ? await secretValue(s().id) : null)
            return (
              <div class="setting-card vault-card">
                <div class="row">
                  <div class="input-box sm grow">
                    <input
                      type="text"
                      value={s().name}
                      aria-label="密钥名称"
                      onChange={(e) => {
                        const name = e.currentTarget.value.trim()
                        if (name) void setSecret(s().id, { name, type: s().type })
                      }}
                    />
                  </div>
                  <Menu
                    small
                    label="认证方式"
                    value={s().type}
                    options={AUTH}
                    onPick={(type) => void setSecret(s().id, { name: s().name, type })}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label="删除密钥"
                    data-hint="删除密钥"
                    onClick={() =>
                      ask(`删除密钥「${s().name}」？用到它的服务商将没有密钥。`, () => void deleteSecret(s().id))
                    }
                  >
                    <Trash />
                  </button>
                </div>
                <div class="row">
                  <span class="mono hint grow">{plain() ?? s().hint}</span>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={plain() === null ? "显示密钥" : "隐藏密钥"}
                    data-hint={plain() === null ? "显示密钥" : "隐藏密钥"}
                    onClick={() => void flip()}
                  >
                    <Show when={plain() !== null} fallback={<Eye />}>
                      <EyeOff />
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label="复制密钥"
                    data-hint="复制密钥"
                    onClick={() => void copyKey(secretValue(s().id), setCopied)}
                  >
                    <Show when={copied()} fallback={<Copy />}>
                      <Check />
                    </Show>
                  </button>
                  <Show when={target()}>
                    {(t) => (
                      <Show
                        when={t().secret === s().id}
                        fallback={
                          <button
                            type="button"
                            class="btn xs"
                            onClick={() => void putProvider({ ...t(), secret: s().id })}
                          >
                            使用
                          </button>
                        }
                      >
                        <span class="tag ok">使用中</span>
                      </Show>
                    )}
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </>
  )
}

// ───────── The sync drawer: the service's own model list, toggled into the provider's ─────────
const SyncDrawer = (props: { id: string; ready: () => Promise<void>; onClose: () => void }) => {
  const list = read(providers)
  const p = () => list().find((x) => x.id === props.id)
  const [remote, setRemote] = createSignal<{ models?: Listed[]; error?: string } | null>(null)
  const [q, setQ] = createSignal("")
  const shown = () => (remote()?.models ?? []).map((m) => m.id).filter((id) => hit(id, q()))
  /** Ids back to their listing rows (the groups are over ids), to add them as listed. */
  const pick = (ids: readonly string[]) => {
    const rows = new Map((remote()?.models ?? []).map((m) => [m.id, m]))
    return ids.map((id) => rows.get(id) ?? { id })
  }
  /** Models already in the list on the provider's default protocol that the listing puts on another endpoint: their
   *  format unset (one the player set stays), the listing's set. The only place a stored format is corrected. */
  const stale = (x: Provider) =>
    (remote()?.models ?? []).filter((r) => r.format && x.models.some((m) => m.id === r.id && m.format === undefined))
  const correct = (x: Provider) => {
    const fix = new Map(stale(x).map((r) => [r.id, r.format!]))
    void putProvider({ ...x, models: x.models.map((m) => (fix.has(m.id) ? { ...m, format: fix.get(m.id)! } : m)) })
  }
  onSettled(() => {
    void props
      .ready()
      .then(() => listModels(props.id))
      .then(
        (models) => setRemote({ models }),
        (e: unknown) => setRemote({ error: e instanceof Error ? e.message : String(e) }),
      )
  })
  return (
    <Show when={p()}>
      {(x) => (
        <>
          <div class="drawer-head">
            <h3>{x().name} 模型</h3>
            <Show when={remote()?.models}>{(models) => <span class="tag mono">{models().length}</span>}</Show>
            <span class="spacer" />
            <button
              type="button"
              class="btn sm ghost"
              disabled={!remote()?.models?.length}
              onClick={() => addModels(x(), remote()?.models ?? [])}
            >
              <Plus /> <span>添加全部</span>
            </button>
            <button type="button" class="icon sm" aria-label="关闭" onClick={() => props.onClose()}>
              <Close />
            </button>
          </div>
          <div class="drawer-search">
            <div class="input-box">
              <Clue aria-hidden="true" />
              <input
                type="search"
                placeholder="搜索模型..."
                aria-label="搜索模型"
                value={q()}
                onInput={(e) => setQ(e.currentTarget.value)}
              />
            </div>
          </div>
          <Show when={stale(x()).length}>
            {(n) => (
              <div class="drawer-note">
                <span>{n()} 个已添加模型的协议与服务商列表不符</span>
                <button type="button" class="btn xs" onClick={() => correct(x())}>
                  更正
                </button>
              </div>
            )}
          </Show>
          <div class="drawer-body scroller">
            <Show when={remote()} fallback={<p class="none">正在获取模型列表…</p>}>
              {(r) => (
                <Show when={!r().error} fallback={<p class="none err">{r().error}</p>}>
                  <For each={grouped(shown())} keyed={(g) => g[0]} fallback={<p class="none">无匹配模型</p>}>
                    {(g) => (
                      <details class="group" open>
                        <summary>
                          <Next class="chev" />
                          <span>{g()[0]}</span>
                          <span class="tag mono">{g()[1].length}</span>
                          <span class="acts">
                            <button
                              type="button"
                              class="icon sm"
                              aria-label="添加分组全部模型"
                              disabled={g()[1].every((id) => x().models.some((m) => m.id === id))}
                              onClick={quiet(() => addModels(x(), pick(g()[1])))}
                            >
                              <Plus />
                            </button>
                            <button
                              type="button"
                              class="icon sm"
                              aria-label="移除分组全部模型"
                              disabled={!g()[1].some((id) => x().models.some((m) => m.id === id))}
                              onClick={quiet(() => removeModels(x(), g()[1]))}
                            >
                              <Minus />
                            </button>
                          </span>
                        </summary>
                        <For each={g()[1]} keyed={(id) => id}>
                          {(id) => {
                            const added = () => x().models.some((m) => m.id === id())
                            return (
                              <div class={{ "m-row": true, added: added() }}>
                                <Family id={id()} />
                                <ModelName id={id()} />
                                <button
                                  type="button"
                                  class="icon sm"
                                  aria-label={added() ? "移除模型" : "添加模型"}
                                  onClick={() => (added() ? removeModels(x(), [id()]) : addModels(x(), pick([id()])))}
                                >
                                  <Show when={added()} fallback={<Plus />}>
                                    <Minus />
                                  </Show>
                                </button>
                              </div>
                            )
                          }}
                        </For>
                      </details>
                    )}
                  </For>
                </Show>
              )}
            </Show>
          </div>
        </>
      )}
    </Show>
  )
}

// ───────── The model dialog: a draft of one entry, written when the dialog closes ─────────
const formatOf = (p: Provider, m: ModelEntry) => m.format ?? p.defaultFormat
const capOf = <K extends keyof Capabilities>(p: Provider, m: ModelEntry, k: K): Capabilities[K] =>
  (m.capabilities?.[k] as Capabilities[K] | undefined) ?? DEFAULTS[formatOf(p, m)][k]
const without = <K extends Exclude<keyof ModelEntry, "id">>(
  m: ModelEntry,
  k: K,
  v: ModelEntry[K] | undefined,
): ModelEntry => {
  const { [k]: _, ...rest } = m
  return (v === undefined ? rest : { ...rest, [k]: v }) as ModelEntry
}

const ModelDialog = (props: { id: string; opener: Opener<ModelEntry> }) => {
  const list = read(providers)
  const hatList = read(hats)
  const p = () => list().find((x) => x.id === props.id)
  let el!: HTMLDialogElement
  const [entry, setEntry] = createSignal<ModelEntry | null>(null)
  const change = (f: (m: ModelEntry) => ModelEntry) => setEntry((m) => (m ? f(m) : m))
  /** An override set only where it differs from the format's default. */
  const setCap = <K extends keyof Capabilities>(k: K, v: Capabilities[K]) => {
    const x = p()
    if (x)
      change((m) => {
        const { [k]: _, ...caps } = m.capabilities ?? {}
        const next = v === DEFAULTS[formatOf(x, m)][k] ? caps : { ...caps, [k]: v }
        const { capabilities: _c, ...rest } = m
        return Object.keys(next).length ? { ...rest, capabilities: next } : rest
      })
  }
  const conflict = (x: Provider, m: ModelEntry) =>
    hatList()
      .find((h) => h.id === m.hat)
      ?.narrate?.tail?.at(-1)?.role === "assistant" && !capOf(x, m, "prefill")
  const commit = () => {
    const m = entry()
    const x = p()
    setEntry(null)
    const stored = x?.models.find((y) => y.id === m?.id)
    if (m && x && JSON.stringify(m) !== JSON.stringify(stored))
      void putProvider({ ...x, models: x.models.map((y) => (y.id === m.id ? m : y)) })
  }
  return (
    <Modal
      title={entry()?.id ?? ""}
      dialog={(d) => {
        el = d
        props.opener((m) => (setEntry(m), d.showModal()))
      }}
      onClose={commit}
    >
      <Show when={entry() && p() ? { m: entry()!, x: p()! } : undefined}>
        {(c) => (
          <>
            <div class="modal-body scroller">
              <Show when={conflict(c().x, c().m)}>
                <div class="warn">所选提示词模板以 Assistant 消息结尾，请开启下方「允许预填续写」。</div>
              </Show>
              <div class="pair">
                <div class="field-group">
                  <span class="label">提示词模板</span>
                  <Menu
                    label="提示词模板"
                    value={c().m.hat ?? ""}
                    options={[
                      { value: "", label: "无模板" },
                      ...hatList().map((h) => ({ value: h.id, label: h.name })),
                    ]}
                    onPick={(v) => change((m) => without(m, "hat", v || undefined))}
                  />
                </div>
                <div class="field-group">
                  <span class="label">请求端点协议</span>
                  <Menu
                    label="请求端点协议"
                    value={c().m.format ?? ""}
                    options={[
                      { value: "", label: `默认 (${FORMAT[c().x.defaultFormat]})` },
                      ...FORMATS.map((f) => ({ value: f, label: FORMAT[f] })),
                    ]}
                    onPick={(v) => change((m) => without(m, "format", (v || undefined) as Format | undefined))}
                  />
                </div>
              </div>
              <div class="field-group">
                <span class="label">结构化输出方式</span>
                <Menu
                  label="结构化输出方式"
                  value={capOf(c().x, c().m, "structured")}
                  options={[
                    { value: "schema", label: "JSON Schema (原生)" },
                    { value: "tool", label: "Tool Call (强制工具)" },
                    { value: "json", label: "JSON Object (提示词内嵌)" },
                  ]}
                  onPick={(v) => setCap("structured", v)}
                />
              </div>
              <Effort value={c().m.effort} onPick={(v) => change((m) => without(m, "effort", v))} />
              <div class="pair">
                <label class="field-group">
                  <span class="label">上下文上限 (Token)</span>
                  <input
                    class="field mono"
                    type="number"
                    min="1024"
                    step="1024"
                    placeholder="默认"
                    value={c().m.contextTokens ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10)
                      change((m) => without(m, "contextTokens", n > 0 ? n : undefined))
                    }}
                  />
                </label>
                <label class="field-group">
                  <span class="label">最大输出 (Token)</span>
                  <input
                    class="field mono"
                    type="number"
                    min="256"
                    step="256"
                    placeholder="默认"
                    value={c().m.maxOutputTokens ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10)
                      change((m) => without(m, "maxOutputTokens", n > 0 ? n : undefined))
                    }}
                  />
                </label>
              </div>
              <div class="inline-row">
                <span>允许预填续写 (Prefill)</span>
                <Switch
                  on={capOf(c().x, c().m, "prefill")}
                  label="允许预填续写"
                  onFlip={() => setCap("prefill", !capOf(c().x, c().m, "prefill"))}
                />
              </div>
              <div class="inline-row">
                <span>回传历史思考过程</span>
                <Switch
                  on={capOf(c().x, c().m, "reasoningBack")}
                  label="回传历史思考过程"
                  onFlip={() => setCap("reasoningBack", !capOf(c().x, c().m, "reasoningBack"))}
                />
              </div>
            </div>
            <div class="modal-foot">
              <button type="button" class="btn primary" onClick={() => el.close()}>
                完成
              </button>
            </div>
          </>
        )}
      </Show>
    </Modal>
  )
}

/** The effort stepper: five stops on a rail; unset reads 默认, and pressing the set stop unsets it. */
const Effort = (props: { value: Effort | undefined; onPick: (v: Effort | undefined) => void }) => {
  const at = () => EFFORTS.findIndex(([e]) => e === props.value)
  return (
    <div class="field-group">
      <div class="label-row">
        <span class="label">思考强度</span>
        <span class="tag mono">{EFFORTS[at()]?.[1] ?? "默认"}</span>
      </div>
      <div class="effort" role="radiogroup" aria-label="思考强度">
        <div class="rail">
          <div class="fill" style={{ width: `${Math.max(0, at()) * 25}%` }} />
        </div>
        <div class="stops">
          <For each={EFFORTS} keyed={false}>
            {(e, i) => (
              <button
                type="button"
                role="radio"
                aria-checked={at() === i ? "true" : "false"}
                class={{ stop: true, passed: i < at(), active: at() === i }}
                onClick={() => props.onPick(props.value === e()[0] ? undefined : e()[0])}
              >
                <span class="dot" />
                <span class="tick">{e()[1]}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

// ───────── Add a model by id; add a provider ─────────
const AddModelDialog = (props: { id: string; opener: Opener<undefined> }) => {
  let el!: HTMLDialogElement
  const [id, setId] = createSignal("")
  return (
    <Modal
      title="添加模型"
      narrow
      dialog={(d) => {
        el = d
        props.opener(() => (setId(""), d.showModal()))
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const p = providerOf(props.id)
          if (p && id().trim()) addModels(p, [{ id: id().trim() }])
          el.close()
        }}
      >
        <div class="modal-body scroller">
          <label class="field-group">
            <span class="label">
              模型 ID <span class="req">*</span>
            </span>
            <input
              class="field mono"
              type="text"
              required
              placeholder="例如 claude-opus-4-6"
              value={id()}
              onInput={(e) => setId(e.currentTarget.value)}
            />
          </label>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onClick={() => el.close()}>
            取消
          </button>
          <button type="submit" class="btn primary">
            添加
          </button>
        </div>
      </form>
    </Modal>
  )
}

const BASE_URL: Record<Format, string> = {
  "openai-compatible": "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
}
const AddProviderDialog = (props: { opener: Opener<undefined>; onAdded: (id: string) => void }) => {
  let el!: HTMLDialogElement
  const fresh = () => ({
    name: "",
    key: "",
    def: "openai-compatible" as Format,
    urls: { "openai-compatible": "https://api.openai.com", anthropic: "", gemini: "" } as Record<Format, string>,
  })
  const [draft, setDraft] = createSignal(fresh())
  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    const d = draft()
    const id = newId("provider")
    const s = d.key.trim() ? await addSecret({ name: d.name.trim(), type: "api_key", value: d.key.trim() }) : undefined
    await putProvider({
      id,
      name: d.name.trim(),
      enabled: true,
      defaultFormat: d.def,
      endpoints: Object.fromEntries(
        FORMATS.filter((f) => d.urls[f]?.trim()).map((f) => [f, { url: d.urls[f].trim() }]),
      ),
      ...(s && { secret: s.id }),
      models: [],
    })
    el.close()
    props.onAdded(id)
  }
  return (
    <Modal
      title="添加自定义服务商"
      dialog={(d) => {
        el = d
        props.opener(() => (setDraft(fresh()), d.showModal()))
      }}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div class="modal-body scroller">
          <div class="pair">
            <label class="field-group">
              <span class="label">
                服务商名称 <span class="req">*</span>
              </span>
              <input
                class="field"
                type="text"
                required
                placeholder="例如 OpenAI / 硅基中转"
                value={draft().name}
                onInput={(e) => {
                  const name = e.currentTarget.value
                  setDraft((d) => ({ ...d, name }))
                }}
              />
            </label>
            <label class="field-group">
              <span class="label">API 密钥</span>
              <input
                class="field mono"
                type="password"
                autocomplete="off"
                placeholder="输入 API 密钥"
                value={draft().key}
                onInput={(e) => {
                  const key = e.currentTarget.value
                  setDraft((d) => ({ ...d, key }))
                }}
              />
            </label>
          </div>
          <div class="endpoints">
            <span class="label dim">端点设置</span>
            <For each={FORMATS} keyed={(f) => f}>
              {(f) => (
                <div class="field-group">
                  <div class="label-row">
                    <span class="label">{FORMAT[f()]}</span>
                    <Show
                      when={draft().def === f()}
                      fallback={
                        <button type="button" class="btn xs" onClick={() => setDraft((d) => ({ ...d, def: f() }))}>
                          设为默认
                        </button>
                      }
                    >
                      <span class="tag ok">默认</span>
                    </Show>
                  </div>
                  <input
                    class="field mono"
                    type="url"
                    placeholder={`Base URL: ${BASE_URL[f()]}`}
                    aria-label={`${FORMAT[f()]} 地址`}
                    value={draft().urls[f()] ?? ""}
                    onInput={(e) => {
                      const url = e.currentTarget.value
                      setDraft((d) => ({ ...d, urls: { ...d.urls, [f()]: url } }))
                    }}
                  />
                  <Show when={draft().urls[f()]?.trim()}>
                    {(url) => {
                      const pv = () => preview(f(), url(), false)
                      return <div class={{ resolved: true, err: !pv().ok }}>{pv().text}</div>
                    }}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onClick={() => el.close()}>
            取消
          </button>
          <button type="submit" class="btn primary">
            添加
          </button>
        </div>
      </form>
    </Modal>
  )
}
