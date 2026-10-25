// The settings page (issue #33; docs/settings-prototype.html and its brief): the player's assets that hold across cards
// and stories, in four sections: the model providers (模型服务), which model runs each stage (默认模型), the hats
// (提示词模板 in the UI) and the personas (玩家人设). Desktop: three cards on the canvas (nav, list, detail), two for
// the routing; a phone shows the list or the detail under a bar of four icons. Opened from the session's tools,
// Escape or Back returns to the story. Every edit is one write the server answers with the list it changed (wire.ts);
// text commits on change (blur or Enter), the model dialog on close, the request drawer on Save. A key is typed once
// and comes back as a hint; the URL preview under each endpoint is the provider's own url.ts, run here.
import type { Effort } from "@effect-tavern/provider/src/call.ts"
import type { Capabilities } from "@effect-tavern/provider/src/connection.ts"
import type { ModelEntry, Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import { normalize, plan, type Format } from "@effect-tavern/provider/src/url.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import type { Phase } from "@effect-tavern/runtime/src/session.ts"
import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { Dynamic, type JSX } from "@solidjs/web"
import { read } from "./bridge.ts"
import { Family } from "./family.tsx"
import {
  Back,
  Caret,
  Check,
  Close,
  Clue,
  Eye,
  EyeOff,
  Fold,
  Key,
  Minus,
  Next,
  Plugs,
  Settings as Gear,
  Sliders,
  Snippets as Plus,
  Sync,
  Template,
  Trash,
  User,
} from "./icons.tsx"
import { roam } from "./side.tsx"
import { card, hats, page, personas, player, providers, registry, routing, secrets, type Pair } from "./store.ts"
import {
  addSecret,
  deleteHat,
  deletePersona,
  deleteProvider,
  deleteSecret,
  fetchHats,
  fetchProviders,
  fetchRouting,
  fetchSecrets,
  listModels,
  putHat,
  putPersona,
  putProvider,
  putRouting,
  setSecret,
  testProvider,
} from "./wire.ts"

export const openSettings = () => registry.set(page, "settings")
const close = () => registry.set(page, "reader")

type Section = "providers" | "routing" | "templates" | "personas"
const SECTIONS: [Section, string, (p: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element][] = [
  ["providers", "模型服务", Plugs],
  ["routing", "默认模型", Sliders],
  ["templates", "提示词模板", Template],
  ["personas", "玩家人设", User],
]
const FORMATS: Format[] = ["openai-compatible", "anthropic", "gemini"]
const FORMAT: Record<Format, string> = { "openai-compatible": "OpenAI", anthropic: "Anthropic", gemini: "Gemini" }
// provider connection.ts DEFAULTS, copied: importing it would pull ai-sdk into the client
const DEFAULTS: Record<Format, Capabilities> = {
  anthropic: { prefill: false, structured: "schema", reasoningBack: false },
  "openai-compatible": { prefill: true, structured: "schema", reasoningBack: true },
  gemini: { prefill: true, structured: "schema", reasoningBack: true },
}
const EFFORTS: [Effort, string][] = [
  ["off", "关闭"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["max", "最高"],
]
const STAGES: [Phase, string][] = [
  ["narrate", "正文叙事"],
  ["record", "状态与记录结算"],
  ["decide", "行动判定"],
  ["direct", "导演规划"],
  ["lookup", "设定检出"],
  ["check", "护栏检查"],
  ["polish", "文风润色"],
]
type Role = "system" | "user" | "assistant"
const ROLES: { value: Role; label: string }[] = [
  { value: "system", label: "System" },
  { value: "user", label: "User" },
  { value: "assistant", label: "Assistant" },
]
// an id the player never sees; not crypto.randomUUID, which a phone on plain http (no secure context) lacks
let made = 0
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${(made++).toString(36)}`
/** A model's group: its id up to the first `-`, `/` or `_` (the prototype's grouping). */
const groupOf = (id: string) => id.split(/[-/_]/)[0] || "默认"
const grouped = (ids: readonly string[]): [string, string[]][] => {
  const by = new Map<string, string[]>()
  for (const id of ids) by.set(groupOf(id), [...(by.get(groupOf(id)) ?? []), id])
  return [...by]
}
/** The URL a format's endpoint will hit, or why the input is refused (url.ts's own message). */
const preview = (format: Format, url: string, exact: boolean | undefined, model = "{model}") => {
  try {
    return { ok: true, text: plan(format, normalize(format, url, exact ? "exact-prefix" : "infer"), model).stream }
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) }
  }
}
const hide = (el: HTMLElement) => el.closest<HTMLElement>("[popover]")?.hidePopover()

// ───────── Controls ─────────
let menus = 0
interface Option<T extends string> {
  value: T
  label: string
  glyph?: string // a model id: its family glyph leads the row
}
/** A select without <select>: a trigger and a popover menu anchored under it, the pick checked. */
const Menu = <T extends string>(props: {
  value: T | undefined
  options: readonly Option<T>[]
  onPick: (v: T) => void
  placeholder?: string
  label?: string
  small?: boolean
}) => {
  const id = `menu-${menus++}`
  const current = () => props.options.find((o) => o.value === props.value)
  return (
    <>
      <button type="button" class={{ select: true, sm: !!props.small }} popovertarget={id} aria-label={props.label}>
        <Show when={current()?.glyph}>{(g) => <Family id={g()} />}</Show>
        <span class="label">{current()?.label ?? props.placeholder ?? ""}</span>
        <Caret class="caret" />
      </button>
      <div id={id} class="snippets menu scroller" popover role="menu" onKeyDown={roam}>
        <For each={props.options} keyed={(o) => o.value}>
          {(o) => (
            <button
              type="button"
              role="menuitemradio"
              class="item"
              tabindex="-1"
              aria-checked={o().value === props.value ? "true" : "false"}
              onClick={(e) => (hide(e.currentTarget), props.onPick(o().value))}
            >
              <span class="name">
                <Show when={o().glyph}>{(g) => <Family id={g()} />}</Show>
                <span class="text">{o().label}</span>
              </span>
              <Show when={o().value === props.value}>
                <Check />
              </Show>
            </button>
          )}
        </For>
      </div>
    </>
  )
}
const Switch = (props: { on: boolean; label: string; onFlip: () => void }) => (
  <button
    type="button"
    class="switch"
    role="switch"
    aria-checked={props.on ? "true" : "false"}
    aria-label={props.label}
    onClick={() => props.onFlip()}
  >
    <span class="thumb" />
  </button>
)
const Avatar = (props: { name: string }) => <span class="avatar">{props.name.slice(0, 1).toUpperCase()}</span>

// ───────── The page ─────────
export const Settings = () => {
  const list = read(providers)
  const vault = read(secrets)
  const route = read(routing)
  const hatList = read(hats)
  const people = read(personas)
  const me = read(player)
  const view = read(card)
  const [section, setSection] = createSignal<Section>("providers")
  const [pane, setPane] = createSignal<"list" | "detail">("list")
  const [picked, setPicked] = createSignal<Record<Section, string | undefined>>({
    providers: undefined,
    routing: undefined,
    templates: undefined,
    personas: undefined,
  })
  const pick = (s: Section, id: string | undefined) => {
    setPicked((p) => ({ ...p, [s]: id }))
    setPane("detail")
    resetProvider()
  }
  const switchTo = (s: Section) => {
    setSection(s)
    setPane("list")
    resetProvider()
  }
  const chosen = <T extends { id: string }>(s: Section, all: readonly T[]) =>
    all.find((x) => x.id === picked()[s]) ?? all[0]

  // a deletion asks first; one dialog for every kind
  let confirm!: HTMLDialogElement
  const [asking, setAsking] = createSignal<{ text: string; run: () => void } | null>(null)
  const ask = (text: string, run: () => void) => {
    setAsking({ text, run })
    confirm.showModal()
  }

  // ── 模型服务 ──
  const [search, setSearch] = createSignal("")
  const shownProviders = () => list().filter((p) => p.name.toLowerCase().includes(search().toLowerCase()))
  const provider = () => chosen("providers", list())
  const secretOf = (p: Provider): SecretView | undefined => vault().find((s) => s.id === p.secret)
  const save = (f: (p: Provider) => Provider) => {
    const p = provider()
    if (p) void putProvider(f(p))
  }
  const [typed, setTyped] = createSignal("") // a key being typed: never shown back once saved
  const [reveal, setReveal] = createSignal(false)
  const [keyType, setKeyType] = createSignal<SecretView["type"]>("api_key") // the next key's, while none is saved
  const [keyName, setKeyName] = createSignal("")
  const [probe, setProbe] = createSignal<{ ok: boolean; text: string } | null>(null)
  const [mq, setMq] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [folded, setFolded] = createSignal(false)
  const [drawer, setDrawer] = createSignal<"endpoint" | "sync" | null>(null)
  const resetProvider = () => {
    setTyped("")
    setReveal(false)
    setProbe(null)
    setMq("")
    setSearching(false)
    setDrawer(null)
  }
  const useSecret = (p: Provider, s: SecretView) => {
    setTyped("")
    void putProvider({ ...p, secret: s.id })
  }
  const storeKey = async (name: string) => {
    const p = provider()
    const value = typed().trim()
    if (!p || !value) return
    const s = await addSecret({ name: name.trim() || p.name, type: secretOf(p)?.type ?? keyType(), value })
    setTyped("")
    setKeyName("")
    await putProvider({ ...p, secret: s.id })
  }
  const runProbe = async () => {
    const p = provider()
    if (!p) return
    if (typed().trim()) await storeKey("")
    setProbe({ ok: true, text: "…" })
    setProbe(await testProvider(p.id, p.models[0]?.id))
  }
  const endpointCount = (p: Provider) => FORMATS.filter((f) => p.endpoints[f]?.url.trim()).length
  const setUrl = (p: Provider, f: Format, url: string): Provider["endpoints"] => {
    const { [f]: old, ...rest } = p.endpoints
    return url.trim() ? { ...rest, [f]: { ...old, url: url.trim() } } : rest
  }
  const shownModels = (p: Provider) =>
    p.models.map((m) => m.id).filter((id) => id.toLowerCase().includes(mq().toLowerCase()))
  const addModels = (p: Provider, ids: readonly string[]) =>
    void putProvider({
      ...p,
      models: [...p.models, ...ids.filter((id) => !p.models.some((m) => m.id === id)).map((id) => ({ id }))],
    })
  const removeModel = (p: Provider, id: string) =>
    void putProvider({ ...p, models: p.models.filter((m) => m.id !== id) })

  // the request drawer: a draft of the provider's request settings, written on Save
  interface Request {
    defaultFormat: Format
    endpoints: Record<Format, { url: string; exactPrefix: boolean }>
    type: SecretView["type"]
    ttl: "5m" | "1h"
    proxy: "env" | "direct" | "custom"
    proxyUrl: string
    headers: [string, string][]
  }
  const [req, setReq] = createSignal<Request | null>(null)
  const openRequest = (p: Provider) => {
    setReq({
      defaultFormat: p.defaultFormat,
      endpoints: Object.fromEntries(
        FORMATS.map((f) => [f, { url: p.endpoints[f]?.url ?? "", exactPrefix: !!p.endpoints[f]?.exactPrefix }]),
      ) as Request["endpoints"],
      type: secretOf(p)?.type ?? keyType(),
      ttl: p.cacheTtl ?? "5m",
      proxy: p.proxy === undefined ? "env" : p.proxy === false ? "direct" : "custom",
      proxyUrl: typeof p.proxy === "string" ? p.proxy : "",
      headers: Object.entries(p.headers ?? {}),
    })
    setDrawer("endpoint")
  }
  const edit = (f: (r: Request) => Request) => setReq((r) => (r ? f(r) : r))
  const flipExact = (f: Format) =>
    edit((x) => ({
      ...x,
      endpoints: { ...x.endpoints, [f]: { ...x.endpoints[f], exactPrefix: !x.endpoints[f].exactPrefix } },
    }))
  const saveRequest = async () => {
    const p = provider()
    const r = req()
    if (!p || !r) return
    const headers = Object.fromEntries(r.headers.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]))
    const { cacheTtl: _t, proxy: _p, headers: _h, ...rest } = p
    const next: Provider = {
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
    const s = secretOf(p)
    if (s && s.type !== r.type) await setSecret(s.id, { name: s.name, type: r.type })
    setKeyType(r.type)
    await putProvider(next)
    setDrawer(null)
  }

  // the sync drawer: the service's own list, toggled into the provider's
  const [remote, setRemote] = createSignal<{ ids?: string[]; error?: string } | null>(null)
  const [dq, setDq] = createSignal("")
  const openSync = (p: Provider) => {
    setRemote(null)
    setDq("")
    setDrawer("sync")
    listModels(p.id).then(
      (ids) => setRemote({ ids }),
      (e: unknown) => setRemote({ error: e instanceof Error ? e.message : String(e) }),
    )
  }
  const remoteShown = () => (remote()?.ids ?? []).filter((id) => id.toLowerCase().includes(dq().toLowerCase()))

  // the model dialog: a draft of one entry, written when the dialog closes
  let modelDialog!: HTMLDialogElement
  const [entry, setEntry] = createSignal<ModelEntry | null>(null)
  const openModel = (m: ModelEntry) => {
    setEntry(m)
    modelDialog.showModal()
  }
  const change = (f: (m: ModelEntry) => ModelEntry) => setEntry((m) => (m ? f(m) : m))
  const formatOf = (p: Provider, m: ModelEntry) => m.format ?? p.defaultFormat
  const capOf = <K extends keyof Capabilities>(p: Provider, m: ModelEntry, k: K): Capabilities[K] =>
    (m.capabilities?.[k] as Capabilities[K] | undefined) ?? DEFAULTS[formatOf(p, m)][k]
  /** An override set only where it differs from the format's default. */
  const setCap = <K extends keyof Capabilities>(p: Provider, k: K, v: Capabilities[K]) =>
    change((m) => {
      const { [k]: _, ...caps } = m.capabilities ?? {}
      const next = v === DEFAULTS[formatOf(p, m)][k] ? caps : { ...caps, [k]: v }
      const { capabilities: _c, ...rest } = m
      return Object.keys(next).length ? { ...rest, capabilities: next } : rest
    })
  const without = <K extends Exclude<keyof ModelEntry, "id">>(
    m: ModelEntry,
    k: K,
    v: ModelEntry[K] | undefined,
  ): ModelEntry => {
    const { [k]: _, ...rest } = m
    return (v === undefined ? rest : { ...rest, [k]: v }) as ModelEntry
  }
  const conflict = (p: Provider, m: ModelEntry) =>
    hatList()
      .find((h) => h.id === m.hat)
      ?.narrate?.tail?.at(-1)?.role === "assistant" && !capOf(p, m, "prefill")
  const commitModel = () => {
    const m = entry()
    const p = provider()
    setEntry(null)
    if (m && p) void putProvider({ ...p, models: p.models.map((x) => (x.id === m.id ? m : x)) })
  }

  let addModelDialog!: HTMLDialogElement
  const [newModel, setNewModel] = createSignal("")

  // the add-provider dialog
  let addDialog!: HTMLDialogElement
  const [draft, setDraft] = createSignal({
    name: "",
    key: "",
    def: "openai-compatible" as Format,
    urls: {} as Record<Format, string>,
  })
  const openAdd = () => {
    setDraft({
      name: "",
      key: "",
      def: "openai-compatible",
      urls: { "openai-compatible": "https://api.openai.com", anthropic: "", gemini: "" },
    })
    addDialog.showModal()
  }
  const submitAdd = async (e: SubmitEvent) => {
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
    addDialog.close()
    pick("providers", id)
  }

  // ── 默认模型 ──
  const key = (p: Pair) => `${p.provider}\u0000${p.model}`
  const pairs = createMemo(() =>
    list()
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.models.map((m) => ({
          value: key({ provider: p.id, model: m.id }),
          label: `${p.name} · ${m.id}`,
          glyph: m.id,
        })),
      ),
  )
  const pairOf = (k: string): Pair => {
    const [provider, model] = k.split("\u0000") as [string, string]
    return { provider, model }
  }
  const setStage = (s: Phase, k: string) => {
    const { [s]: _, ...rest } = route().stages ?? {}
    void putRouting({ ...route(), stages: k ? { ...rest, [s]: pairOf(k) } : rest })
  }
  const flipStages = () => {
    const { stages, ...rest } = route()
    void putRouting(stages ? rest : { ...rest, stages: {} })
  }

  // ── 提示词模板 ──
  type Slot = "head" | "tail" | "review"
  type Said = { role: Role; text: string }
  const slotOf = (h: Hat, s: Slot): readonly Said[] =>
    (s === "review" ? h.review?.head : s === "head" ? h.narrate?.head : h.narrate?.tail) ?? []
  const withSlot = (h: Hat, s: Slot, said: Said[]): Hat =>
    s === "review" ? { ...h, review: { ...h.review, head: said } } : { ...h, narrate: { ...h.narrate, [s]: said } }
  const hat = () => chosen("templates", hatList())
  const editSlot = (s: Slot, f: (said: Said[]) => Said[]) => {
    const h = hat()
    if (h) void putHat(withSlot(h, s, f([...slotOf(h, s)])))
  }
  const newHat = async () => {
    const id = newId("hat")
    await putHat({ id, name: "新建提示词模板", narrate: { head: [{ role: "system", text: "" }] } })
    pick("templates", id)
  }

  // ── 玩家人设 ──
  const persona = () => chosen("personas", people())
  const onCard = (id: string) => (view() && me()?.persona?.[view()!.id] === id ? view()!.title : undefined)
  const newPersona = async () => {
    const id = newId("persona")
    await putPersona({ id, name: "新建人设", text: "" })
    pick("personas", id)
  }

  onSettled(() => {
    void Promise.all([fetchProviders(), fetchSecrets(), fetchRouting(), fetchHats()])
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(":popover-open, dialog[open]")) return
      if (drawer()) setDrawer(null)
      else if (searching()) return
      else close()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })

  const title = () => SECTIONS.find(([s]) => s === section())![1]
  const DetailBack = () => (
    <button type="button" class="icon back-pane" aria-label="返回列表" onClick={() => setPane("list")}>
      <Back />
    </button>
  )
  const Name = (props: { value: string; label: string; onCommit: (v: string) => void }) => (
    <div class="input-box name">
      <input
        type="text"
        value={props.value}
        aria-label={props.label}
        onChange={(e) => e.currentTarget.value.trim() && props.onCommit(e.currentTarget.value.trim())}
      />
    </div>
  )

  return (
    <div class="settings" data-section={section()} data-pane={section() === "routing" ? "detail" : pane()}>
      <nav class="nav-card" aria-label="设置">
        <div class="nav-head">
          <button type="button" class="icon" aria-label="返回故事" onClick={close}>
            <Back />
          </button>
          <h1>设置</h1>
        </div>
        <div class="nav-list">
          <For each={SECTIONS} keyed={(s) => s[0]}>
            {(s) => (
              <button
                type="button"
                class="nav-item"
                aria-current={section() === s()[0] ? "page" : undefined}
                onClick={() => switchTo(s()[0])}
              >
                <Dynamic component={s()[2]} aria-hidden="true" />
                <span>{s()[1]}</span>
              </button>
            )}
          </For>
        </div>
      </nav>
      <header class="phone-bar">
        <button type="button" class="icon" aria-label="返回故事" onClick={close}>
          <Back />
        </button>
        <span class="title">{title()}</span>
        <div class="tabs" role="tablist" aria-label="设置">
          <For each={SECTIONS} keyed={(s) => s[0]}>
            {(s) => (
              <button
                type="button"
                role="tab"
                aria-label={s()[1]}
                aria-selected={section() === s()[0] ? "true" : "false"}
                onClick={() => switchTo(s()[0])}
              >
                <Dynamic component={s()[2]} aria-hidden="true" />
              </button>
            )}
          </For>
        </div>
      </header>

      {/* ───── 模型服务 ───── */}
      <Show when={section() === "providers"}>
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
            <For each={shownProviders()} keyed={(p) => p.id}>
              {(p) => (
                <button
                  type="button"
                  class="p-row"
                  aria-selected={p().id === provider()?.id ? "true" : "false"}
                  onClick={() => pick("providers", p().id)}
                >
                  <Avatar name={p().name} />
                  <span class="p-name">{p().name}</span>
                  <span class={{ dot: true, on: p().enabled }} />
                </button>
              )}
            </For>
          </div>
          <div class="master-foot">
            <button type="button" class="btn" onClick={openAdd}>
              <Plus /> <span>添加服务商</span>
            </button>
          </div>
        </aside>
        <section class="detail-card" aria-label="服务商详情">
          <Show when={provider()} fallback={<div class="empty">尚未添加服务商</div>}>
            {(p) => (
              <>
                <header class="detail-header">
                  <DetailBack />
                  <Name value={p().name} label="服务商名称" onCommit={(name) => save((x) => ({ ...x, name }))} />
                  <span class="spacer" />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label="删除服务商"
                    onClick={() => ask(`删除服务商「${p().name}」？`, () => void deleteProvider(p().id))}
                  >
                    <Trash />
                  </button>
                  <Switch
                    on={p().enabled}
                    label="启用服务商"
                    onFlip={() => save((x) => ({ ...x, enabled: !x.enabled }))}
                  />
                </header>
                <div class="detail-scroll scroller">
                  <div class="block">
                    <div class="block-title">
                      <h3>API 密钥</h3>
                      <div class="right">
                        <Show when={probe()}>
                          {(t) => <span class={{ tag: true, mono: true, ok: t().ok, bad: !t().ok }}>{t().text}</span>}
                        </Show>
                      </div>
                    </div>
                    <div
                      class="row keyrow"
                      onFocusOut={(e) =>
                        !e.currentTarget.contains(e.relatedTarget as Node | null) && typed().trim() && void storeKey("")
                      }
                    >
                      <div class="input-box grow">
                        <input
                          type={reveal() ? "text" : "password"}
                          class="mono"
                          autocomplete="off"
                          value={typed()}
                          placeholder={secretOf(p())?.hint ?? "输入或从密钥库选择"}
                          aria-label="API 密钥"
                          onInput={(e) => setTyped(e.currentTarget.value)}
                          onKeyDown={(e) => e.key === "Enter" && void storeKey("")}
                        />
                        <button
                          type="button"
                          class="icon sm"
                          aria-label={reveal() ? "隐藏密钥" : "显示密钥"}
                          onClick={() => setReveal(!reveal())}
                        >
                          <Show when={reveal()} fallback={<Eye />}>
                            <EyeOff />
                          </Show>
                        </button>
                      </div>
                      <button type="button" class="icon boxed" aria-label="密钥库" popovertarget="vault">
                        <Key />
                      </button>
                      <div id="vault" class="snippets vault" popover>
                        <div class="vault-head">
                          <span>密钥库</span>
                        </div>
                        <Show when={typed().trim()}>
                          <div class="row">
                            <div class="input-box grow sm">
                              <input
                                type="text"
                                placeholder="密钥名称"
                                value={keyName()}
                                onInput={(e) => setKeyName(e.currentTarget.value)}
                              />
                            </div>
                            <button
                              type="button"
                              class="btn sm"
                              onClick={(e) => (hide(e.currentTarget), void storeKey(keyName()))}
                            >
                              存入当前密钥
                            </button>
                          </div>
                        </Show>
                        <For each={vault()} keyed={(s) => s.id}>
                          {(s) => (
                            <div class="vault-row" aria-current={s().id === p().secret ? "true" : undefined}>
                              <button
                                type="button"
                                class="pick"
                                onClick={(e) => (hide(e.currentTarget), useSecret(p(), s()))}
                              >
                                <span class="name">{s().name}</span>
                                <span class="mono hint">{s().hint}</span>
                              </button>
                              <button
                                type="button"
                                class="icon sm"
                                aria-label="删除密钥"
                                onClick={() =>
                                  ask(
                                    `删除密钥「${s().name}」？用到它的服务商将没有密钥。`,
                                    () => void deleteSecret(s().id),
                                  )
                                }
                              >
                                <Trash />
                              </button>
                            </div>
                          )}
                        </For>
                        <Show when={!vault().length}>
                          <p class="none">密钥库为空</p>
                        </Show>
                      </div>
                      <button type="button" class="btn" onClick={() => void runProbe()}>
                        检测
                      </button>
                    </div>
                  </div>

                  <div class="block">
                    <div class="block-title">
                      <h3>API 地址</h3>
                      <button type="button" class="link" onClick={() => openRequest(p())}>
                        添加端点
                      </button>
                      <div class="right">
                        <span class="tag">
                          {FORMAT[p().defaultFormat]} · 默认
                          {endpointCount(p()) > 1 ? ` (+${endpointCount(p()) - 1})` : ""}
                        </span>
                      </div>
                    </div>
                    <div class="row">
                      <div class="input-box grow">
                        <input
                          type="url"
                          class="mono"
                          value={p().endpoints[p().defaultFormat]?.url ?? ""}
                          placeholder="https://api.example.com"
                          aria-label="API 地址"
                          onChange={(e) =>
                            save((x) => ({ ...x, endpoints: setUrl(x, x.defaultFormat, e.currentTarget.value) }))
                          }
                        />
                      </div>
                      <button type="button" class="icon boxed" aria-label="请求配置" onClick={() => openRequest(p())}>
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
                            setMq("")
                            e.currentTarget.blur()
                          }}
                        />
                      </label>
                      <div class="right">
                        <div class="btn-join">
                          <button type="button" class="btn sm" onClick={() => openSync(p())}>
                            <Sync /> <span>同步模型</span>
                          </button>
                          <button
                            type="button"
                            class="btn sm"
                            aria-label="手动添加模型"
                            onClick={() => (setNewModel(""), addModelDialog.showModal())}
                          >
                            <Plus />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div class="groups">
                      <For
                        each={grouped(shownModels(p()))}
                        keyed={(g) => g[0]}
                        fallback={
                          <div class="empty-card">
                            <span>{mq() ? "无匹配模型" : "尚未添加模型"}</span>
                            <Show when={!mq()}>
                              <button type="button" class="btn sm" onClick={() => openSync(p())}>
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
                            </summary>
                            <For each={g()[1]} keyed={(id) => id}>
                              {(id) => (
                                <div class="m-row">
                                  <Family id={id()} />
                                  <span class="m-name">{id()}</span>
                                  <button
                                    type="button"
                                    class="icon sm"
                                    aria-label="模型设置"
                                    onClick={() => openModel(p().models.find((m) => m.id === id())!)}
                                  >
                                    <Gear />
                                  </button>
                                  <button
                                    type="button"
                                    class="icon sm"
                                    aria-label="移除模型"
                                    onClick={() => removeModel(p(), id())}
                                  >
                                    <Minus />
                                  </button>
                                </div>
                              )}
                            </For>
                          </details>
                        )}
                      </For>
                    </div>
                  </div>
                </div>

                {/* the side drawer over the detail card: the request settings or the service's model list */}
                <div class="drawer-scrim" data-open={drawer() ? "true" : "false"} onClick={() => setDrawer(null)} />
                <aside
                  class="side-drawer"
                  data-open={drawer() ? "true" : "false"}
                  aria-label={drawer() === "sync" ? "同步模型" : "请求配置"}
                >
                  <Show when={drawer() === "endpoint" && req()}>
                    {(r) => (
                      <>
                        <div class="drawer-head">
                          <h3>请求配置</h3>
                          <span class="spacer" />
                          <button type="button" class="icon sm" aria-label="关闭" onClick={() => setDrawer(null)}>
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
                                      when={r().defaultFormat === f()}
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
                                      on={r().endpoints[f()].exactPrefix}
                                      label={`${FORMAT[f()]} 精确前缀`}
                                      onFlip={() => flipExact(f())}
                                    />
                                  </span>
                                </div>
                                <div class="input-box">
                                  <input
                                    type="url"
                                    class="mono"
                                    value={r().endpoints[f()].url}
                                    placeholder="Base URL: https://example.com"
                                    aria-label={`${FORMAT[f()]} 地址`}
                                    onInput={(e) => {
                                      const url = e.currentTarget.value
                                      edit((x) => ({
                                        ...x,
                                        endpoints: { ...x.endpoints, [f()]: { ...x.endpoints[f()], url } },
                                      }))
                                    }}
                                  />
                                </div>
                                <Show when={r().endpoints[f()].url.trim()}>
                                  {(url) => {
                                    const pv = () =>
                                      preview(f(), url(), r().endpoints[f()].exactPrefix, p().models[0]?.id)
                                    return <div class={{ resolved: true, err: !pv().ok }}>{pv().text}</div>
                                  }}
                                </Show>
                              </div>
                            )}
                          </For>
                          <div class="drawer-more">
                            <div class="pair">
                              <div class="field-group">
                                <span class="label">认证方式</span>
                                <Menu
                                  small
                                  label="认证方式"
                                  value={r().type}
                                  options={[
                                    { value: "api_key", label: "API Key Header" },
                                    { value: "auth_token", label: "Bearer Token" },
                                  ]}
                                  onPick={(type) => edit((x) => ({ ...x, type }))}
                                />
                              </div>
                              <div class="field-group">
                                <span class="label">缓存有效期</span>
                                <Menu
                                  small
                                  label="缓存有效期"
                                  value={r().ttl}
                                  options={[
                                    { value: "5m", label: "5 分钟" },
                                    { value: "1h", label: "1 小时" },
                                  ]}
                                  onPick={(ttl) => edit((x) => ({ ...x, ttl }))}
                                />
                              </div>
                            </div>
                            <div class="field-group">
                              <span class="label">网络代理</span>
                              <Menu
                                small
                                label="网络代理"
                                value={r().proxy}
                                options={[
                                  { value: "env", label: "跟随系统环境" },
                                  { value: "direct", label: "强制直连" },
                                  { value: "custom", label: "自定义代理地址" },
                                ]}
                                onPick={(proxy) => edit((x) => ({ ...x, proxy }))}
                              />
                              <Show when={r().proxy === "custom"}>
                                <div class="input-box sm">
                                  <input
                                    type="url"
                                    class="mono"
                                    placeholder="http://127.0.0.1:7890"
                                    aria-label="代理地址"
                                    value={r().proxyUrl}
                                    onInput={(e) => {
                                      const proxyUrl = e.currentTarget.value
                                      edit((x) => ({ ...x, proxyUrl }))
                                    }}
                                  />
                                </div>
                              </Show>
                            </div>
                            <div class="field-group">
                              <span class="label">自定义请求头</span>
                              <For each={r().headers} keyed={false}>
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
                                          edit((x) => ({
                                            ...x,
                                            headers: x.headers.map((y, j) => (j === i ? [k, y[1]] : y)),
                                          }))
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
                                          edit((x) => ({
                                            ...x,
                                            headers: x.headers.map((y, j) => (j === i ? [y[0], v] : y)),
                                          }))
                                        }}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      class="icon sm"
                                      aria-label="移除请求头"
                                      onClick={() =>
                                        edit((x) => ({ ...x, headers: x.headers.filter((_, j) => j !== i) }))
                                      }
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
                          <button type="button" class="btn" onClick={() => setDrawer(null)}>
                            取消
                          </button>
                          <button type="button" class="btn primary" onClick={() => void saveRequest()}>
                            保存
                          </button>
                        </div>
                      </>
                    )}
                  </Show>
                  <Show when={drawer() === "sync"}>
                    <div class="drawer-head">
                      <h3>{p().name} 模型</h3>
                      <Show when={remote()?.ids}>{(ids) => <span class="tag mono">{ids().length}</span>}</Show>
                      <span class="spacer" />
                      <button
                        type="button"
                        class="btn sm ghost"
                        disabled={!remote()?.ids?.length}
                        onClick={() => addModels(p(), remote()?.ids ?? [])}
                      >
                        <Plus /> <span>添加全部</span>
                      </button>
                      <button type="button" class="icon sm" aria-label="关闭" onClick={() => setDrawer(null)}>
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
                          value={dq()}
                          onInput={(e) => setDq(e.currentTarget.value)}
                        />
                      </div>
                    </div>
                    <div class="drawer-body scroller">
                      <Show when={remote()} fallback={<p class="none">正在获取模型列表…</p>}>
                        {(r) => (
                          <Show when={!r().error} fallback={<p class="none err">{r().error}</p>}>
                            <For
                              each={grouped(remoteShown())}
                              keyed={(g) => g[0]}
                              fallback={<p class="none">无匹配模型</p>}
                            >
                              {(g) => (
                                <details class="group" open>
                                  <summary>
                                    <Next class="chev" />
                                    <span>{g()[0]}</span>
                                    <span class="tag mono">{g()[1].length}</span>
                                  </summary>
                                  <For each={g()[1]} keyed={(id) => id}>
                                    {(id) => {
                                      const added = () => p().models.some((m) => m.id === id())
                                      return (
                                        <div class={{ "m-row": true, added: added() }}>
                                          <Family id={id()} />
                                          <span class="m-name">{id()}</span>
                                          <button
                                            type="button"
                                            class="icon sm"
                                            aria-label={added() ? "移除模型" : "添加模型"}
                                            onClick={() => (added() ? removeModel(p(), id()) : addModels(p(), [id()]))}
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
                  </Show>
                </aside>
              </>
            )}
          </Show>
        </section>
      </Show>

      {/* ───── 默认模型 ───── */}
      <Show when={section() === "routing"}>
        <section class="detail-card" aria-label="默认模型">
          <header class="detail-header">
            <h2>默认模型</h2>
          </header>
          <div class="detail-scroll scroller">
            <div class="setting-card hero">
              <h3>主默认模型</h3>
              <div class="hero-pick">
                <Menu
                  label="主默认模型"
                  placeholder="未选择"
                  value={route().default && key(route().default!)}
                  options={pairs()}
                  onPick={(k) => void putRouting({ ...route(), default: pairOf(k) })}
                />
              </div>
            </div>
            <div class="block">
              <div class="block-title">
                <h3>按阶段指定模型</h3>
                <div class="right">
                  <Switch on={!!route().stages} label="按阶段指定模型" onFlip={flipStages} />
                </div>
              </div>
              <Show when={route().stages}>
                <div class="cards-grid">
                  <For each={STAGES} keyed={(s) => s[0]}>
                    {(s) => (
                      <div class="setting-card">
                        <div class="stage-head">
                          <span>{s()[1]}</span>
                          <span class="tag mono">{s()[0]}</span>
                        </div>
                        <Menu
                          label={s()[1]}
                          value={route().stages?.[s()[0]] ? key(route().stages![s()[0]]!) : ""}
                          options={[{ value: "", label: "跟随主默认模型" }, ...pairs()]}
                          onPick={(k) => setStage(s()[0], k)}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </section>
      </Show>

      {/* ───── 提示词模板 ───── */}
      <Show when={section() === "templates"}>
        <aside class="master-card" aria-label="提示词模板">
          <div class="master-list scroller top">
            <For each={hatList()} keyed={(h) => h.id}>
              {(h) => (
                <button
                  type="button"
                  class="p-row"
                  aria-selected={h().id === hat()?.id ? "true" : "false"}
                  onClick={() => pick("templates", h().id)}
                >
                  <span class="p-name">{h().name}</span>
                  <span class="tag mono">{slotOf(h(), "head").length + slotOf(h(), "tail").length}</span>
                </button>
              )}
            </For>
          </div>
          <div class="master-foot">
            <button type="button" class="btn" onClick={() => void newHat()}>
              <Plus /> <span>新建模板</span>
            </button>
          </div>
        </aside>
        <section class="detail-card" aria-label="模板详情">
          <Show when={hat()} fallback={<div class="empty">尚未创建模板</div>}>
            {(h) => (
              <>
                <header class="detail-header">
                  <DetailBack />
                  <Name value={h().name} label="模板名称" onCommit={(name) => void putHat({ ...h(), name })} />
                  <span class="spacer" />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label="删除模板"
                    onClick={() => ask(`删除模板「${h().name}」？`, () => void deleteHat(h().id))}
                  >
                    <Trash />
                  </button>
                </header>
                <div class="detail-scroll scroller">
                  <For
                    each={
                      [
                        ["head", "前置引导消息 (Head)"],
                        ["tail", "尾部续写预填 (Tail)"],
                        ["review", "审阅阶段引导 (Review)"],
                      ] as [Slot, string][]
                    }
                    keyed={(s) => s[0]}
                  >
                    {(s) => (
                      <div class="block">
                        <div class="block-title">
                          <h3>{s()[1]}</h3>
                          <div class="right">
                            <button
                              type="button"
                              class="btn sm"
                              onClick={() =>
                                editSlot(s()[0], (l) => [
                                  ...l,
                                  { role: s()[0] === "tail" ? "assistant" : "user", text: "" },
                                ])
                              }
                            >
                              <Plus /> <span>添加消息</span>
                            </button>
                          </div>
                        </div>
                        <Show
                          when={slotOf(h(), s()[0]).length}
                          fallback={<div class="setting-card none">未配置消息</div>}
                        >
                          <div class="msgs">
                            <For each={slotOf(h(), s()[0])} keyed={false}>
                              {(m, i) => (
                                <div class="msg-card">
                                  <Menu
                                    small
                                    label="角色"
                                    value={m().role}
                                    options={ROLES}
                                    onPick={(role) =>
                                      editSlot(s()[0], (l) => l.map((x, j) => (j === i ? { ...x, role } : x)))
                                    }
                                  />
                                  <textarea
                                    class="field"
                                    rows="2"
                                    placeholder="输入消息内容..."
                                    aria-label="消息内容"
                                    value={m().text}
                                    onChange={(e) => {
                                      const text = e.currentTarget.value
                                      editSlot(s()[0], (l) => l.map((x, j) => (j === i ? { ...x, text } : x)))
                                    }}
                                  />
                                  <button
                                    type="button"
                                    class="icon sm"
                                    aria-label="移除消息"
                                    onClick={() => editSlot(s()[0], (l) => l.filter((_, j) => j !== i))}
                                  >
                                    <Close />
                                  </button>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </section>
      </Show>

      {/* ───── 玩家人设 ───── */}
      <Show when={section() === "personas"}>
        <aside class="master-card" aria-label="玩家人设">
          <div class="master-list scroller top">
            <For each={people()} keyed={(x) => x.id}>
              {(x) => (
                <button
                  type="button"
                  class="p-row"
                  aria-selected={x().id === persona()?.id ? "true" : "false"}
                  onClick={() => pick("personas", x().id)}
                >
                  <Avatar name={x().name} />
                  <span class="p-name">{x().name}</span>
                  <Show when={onCard(x().id)}>{(t) => <span class="tag">{t()}</span>}</Show>
                </button>
              )}
            </For>
          </div>
          <div class="master-foot">
            <button type="button" class="btn" onClick={() => void newPersona()}>
              <Plus /> <span>新建人设</span>
            </button>
          </div>
        </aside>
        <section class="detail-card" aria-label="人设详情">
          <Show when={persona()} fallback={<div class="empty">尚未创建人设</div>}>
            {(x) => (
              <>
                <header class="detail-header">
                  <DetailBack />
                  <Name value={x().name} label="人设名称" onCommit={(name) => void putPersona({ ...x(), name })} />
                  <Show when={onCard(x().id)}>{(t) => <span class="tag">{t()}</span>}</Show>
                  <span class="spacer" />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label="删除人设"
                    onClick={() => ask(`删除人设「${x().name}」？`, () => void deletePersona(x().id))}
                  >
                    <Trash />
                  </button>
                </header>
                <div class="detail-scroll scroller">
                  <div class="block grow">
                    <div class="block-title">
                      <h3>人设描述</h3>
                      <div class="right">
                        <span class="tag mono">{x().text.length} 字</span>
                      </div>
                    </div>
                    <textarea
                      class="field persona-text"
                      placeholder="描述玩家角色的外貌、身份与性格特征..."
                      aria-label="人设描述"
                      value={x().text}
                      onChange={(e) => void putPersona({ ...x(), text: e.currentTarget.value })}
                    />
                  </div>
                </div>
              </>
            )}
          </Show>
        </section>
      </Show>

      {/* ───── dialogs ───── */}
      <dialog class="confirm" ref={(el) => (confirm = el)} closedby="any">
        <p>{asking()?.text}</p>
        <div class="row">
          <button type="button" class="chip state" onClick={() => confirm.close()}>
            取消
          </button>
          <button type="button" class="chip danger" onClick={() => (confirm.close(), asking()?.run())}>
            删除
          </button>
        </div>
      </dialog>

      <dialog class="modal" ref={(el) => (addDialog = el)} closedby="any">
        <div class="modal-head">
          <h3>添加自定义服务商</h3>
          <button type="button" class="icon sm" aria-label="关闭" onClick={() => addDialog.close()}>
            <Close />
          </button>
        </div>
        <form onSubmit={(e) => void submitAdd(e)}>
          <div class="modal-body">
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
                      placeholder={`Base URL: ${{ "openai-compatible": "https://api.openai.com", anthropic: "https://api.anthropic.com", gemini: "https://generativelanguage.googleapis.com" }[f()]}`}
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
            <button type="button" class="btn" onClick={() => addDialog.close()}>
              取消
            </button>
            <button type="submit" class="btn primary">
              添加
            </button>
          </div>
        </form>
      </dialog>

      <dialog class="modal" ref={(el) => (modelDialog = el)} closedby="any" onClose={commitModel}>
        <Show when={entry() && provider() ? { m: entry()!, p: provider()! } : undefined}>
          {(c) => (
            <>
              <div class="modal-head">
                <h3>{c().m.id}</h3>
                <button type="button" class="icon sm" aria-label="关闭" onClick={() => modelDialog.close()}>
                  <Close />
                </button>
              </div>
              <div class="modal-body">
                <Show when={conflict(c().p, c().m)}>
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
                        { value: "", label: `默认 (${FORMAT[c().p.defaultFormat]})` },
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
                    value={capOf(c().p, c().m, "structured")}
                    options={[
                      { value: "schema", label: "JSON Schema (原生)" },
                      { value: "tool", label: "Tool Call (强制工具)" },
                      { value: "json", label: "JSON Object (提示词内嵌)" },
                    ]}
                    onPick={(v) => setCap(c().p, "structured", v)}
                  />
                </div>
                <div class="field-group">
                  <div class="label-row">
                    <span class="label">思考强度</span>
                    <span class="tag mono">{EFFORTS.find(([e]) => e === c().m.effort)?.[1] ?? "默认"}</span>
                  </div>
                  <div class="effort" role="radiogroup" aria-label="思考强度">
                    <div class="rail">
                      <div
                        class="fill"
                        style={{
                          width: `${
                            Math.max(
                              0,
                              EFFORTS.findIndex(([e]) => e === c().m.effort),
                            ) * 25
                          }%`,
                        }}
                      />
                    </div>
                    <div class="stops">
                      <For each={EFFORTS} keyed={false}>
                        {(e, i) => {
                          const at = () => EFFORTS.findIndex(([x]) => x === c().m.effort)
                          return (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={at() === i ? "true" : "false"}
                              class={{ stop: true, passed: i < at(), active: at() === i }}
                              onClick={() =>
                                change((m) => without(m, "effort", m.effort === e()[0] ? undefined : e()[0]))
                              }
                            >
                              <span class="dot" />
                              <span class="tick">{e()[1]}</span>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                </div>
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
                    on={capOf(c().p, c().m, "prefill")}
                    label="允许预填续写"
                    onFlip={() => setCap(c().p, "prefill", !capOf(c().p, c().m, "prefill"))}
                  />
                </div>
                <div class="inline-row">
                  <span>回传历史思考过程</span>
                  <Switch
                    on={capOf(c().p, c().m, "reasoningBack")}
                    label="回传历史思考过程"
                    onFlip={() => setCap(c().p, "reasoningBack", !capOf(c().p, c().m, "reasoningBack"))}
                  />
                </div>
              </div>
              <div class="modal-foot">
                <button type="button" class="btn primary" onClick={() => modelDialog.close()}>
                  完成
                </button>
              </div>
            </>
          )}
        </Show>
      </dialog>

      <dialog class="modal narrow" ref={(el) => (addModelDialog = el)} closedby="any">
        <div class="modal-head">
          <h3>添加模型</h3>
          <button type="button" class="icon sm" aria-label="关闭" onClick={() => addModelDialog.close()}>
            <Close />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const p = provider()
            if (p && newModel().trim()) addModels(p, [newModel().trim()])
            addModelDialog.close()
          }}
        >
          <div class="modal-body">
            <label class="field-group">
              <span class="label">
                模型 ID <span class="req">*</span>
              </span>
              <input
                class="field mono"
                type="text"
                required
                placeholder="例如 claude-opus-4-6"
                value={newModel()}
                onInput={(e) => setNewModel(e.currentTarget.value)}
              />
            </label>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" onClick={() => addModelDialog.close()}>
              取消
            </button>
            <button type="submit" class="btn primary">
              添加
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
