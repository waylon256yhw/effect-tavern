// A provider's models (the settings page's 模型服务 section, providers.tsx): the writes to its list, and the dialogs
// about one model, which take only the provider's id and an opener: one model's settings (a draft of its entry,
// written when the dialog closes) and a model added by id. Every write goes through wire.ts and comes back as the list.
import type { Effort } from "@effect-tavern/provider/src/call.ts"
import { DEFAULTS, type Capabilities } from "@effect-tavern/provider/src/capabilities.ts"
import type { ModelEntry, Provider } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import { createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { FORMAT, FORMATS, Menu, Modal, type Opener, Switch } from "./controls.tsx"
import { hats, providers, registry } from "./store.ts"
import { putProvider, type Listed } from "./wire.ts"
import { type Key, t } from "./i18n.ts"

const EFFORTS: [Effort, Key][] = [
  ["off", "models.effortOff"],
  ["low", "models.effortLow"],
  ["medium", "models.effortMedium"],
  ["high", "models.effortHigh"],
  ["max", "models.effortMax"],
]
/** Added as listed: with the format the listing put them under when that is off the provider's default. One already
 *  there with no format of its own takes the listing's too (添加全部 fixes what 更正 would), one the player set stays. */
export const addModels = (p: Provider, models: readonly Listed[]) =>
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
export const removeModels = (p: Provider, ids: readonly string[]) =>
  void putProvider({ ...p, models: p.models.filter((m) => !ids.includes(m.id)) })

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

export const ModelDialog = (props: { id: string; opener: Opener<ModelEntry> }) => {
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
                <div class="warn">{t("models.hatNeedsPrefill")}</div>
              </Show>
              <div class="pair">
                <div class="field-group">
                  <span class="label">{t("models.hat")}</span>
                  <Menu
                    label={t("models.hat")}
                    value={c().m.hat ?? ""}
                    options={[
                      { value: "", label: t("models.noHat") },
                      ...hatList().map((h) => ({ value: h.id, label: h.name })),
                    ]}
                    onPick={(v) => change((m) => without(m, "hat", v || undefined))}
                  />
                </div>
                <div class="field-group">
                  <span class="label">{t("models.endpointFormat")}</span>
                  <Menu
                    label={t("models.endpointFormat")}
                    value={c().m.format ?? ""}
                    options={[
                      { value: "", label: t("models.defaultFormat", { format: FORMAT[c().x.defaultFormat] }) },
                      ...FORMATS.map((f) => ({ value: f, label: FORMAT[f] })),
                    ]}
                    onPick={(v) => change((m) => without(m, "format", (v || undefined) as Format | undefined))}
                  />
                </div>
              </div>
              <div class="field-group">
                <span class="label">{t("models.structured")}</span>
                <Menu
                  label={t("models.structured")}
                  value={capOf(c().x, c().m, "structured")}
                  options={[
                    { value: "schema", label: t("models.jsonSchema") },
                    { value: "tool", label: t("models.toolCall") },
                    { value: "json", label: t("models.jsonObject") },
                  ]}
                  onPick={(v) => setCap("structured", v)}
                />
              </div>
              <Effort value={c().m.effort} onPick={(v) => change((m) => without(m, "effort", v))} />
              <div class="pair">
                <label class="field-group">
                  <span class="label">{t("models.contextWindow")}</span>
                  <input
                    class="field mono"
                    type="number"
                    min="1024"
                    step="1024"
                    placeholder={t("common.default")}
                    value={c().m.contextTokens ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10)
                      change((m) => without(m, "contextTokens", n > 0 ? n : undefined))
                    }}
                  />
                </label>
                <label class="field-group">
                  <span class="label">{t("models.maxOutput")}</span>
                  <input
                    class="field mono"
                    type="number"
                    min="256"
                    step="256"
                    placeholder={t("common.default")}
                    value={c().m.maxOutputTokens ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10)
                      change((m) => without(m, "maxOutputTokens", n > 0 ? n : undefined))
                    }}
                  />
                </label>
              </div>
              <div class="inline-row">
                <span>{t("models.prefillLong")}</span>
                <Switch
                  on={capOf(c().x, c().m, "prefill")}
                  label={t("models.prefill")}
                  onFlip={() => setCap("prefill", !capOf(c().x, c().m, "prefill"))}
                />
              </div>
              <div class="inline-row">
                <span>{t("models.thinkingHistory")}</span>
                <Switch
                  on={capOf(c().x, c().m, "reasoningBack")}
                  label={t("models.thinkingHistory")}
                  onFlip={() => setCap("reasoningBack", !capOf(c().x, c().m, "reasoningBack"))}
                />
              </div>
            </div>
            <div class="modal-foot">
              <button type="button" class="btn primary" onClick={() => el.close()}>
                {t("common.done")}
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
        <span class="label">{t("models.effort")}</span>
        <span class="tag mono">{at() >= 0 ? t(EFFORTS[at()]![1]) : t("common.default")}</span>
      </div>
      <div class="effort" role="radiogroup" aria-label={t("models.effort")}>
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
                <span class="tick">{t(e()[1])}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

// ───────── Add a model by id ─────────
export const AddModelDialog = (props: { id: string; opener: Opener<undefined> }) => {
  let el!: HTMLDialogElement
  const [id, setId] = createSignal("")
  return (
    <Modal
      title={t("models.addModel")}
      narrow
      dialog={(d) => {
        el = d
        props.opener(() => (setId(""), d.showModal()))
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const p = registry.get(providers).find((x) => x.id === props.id)
          if (p && id().trim()) addModels(p, [{ id: id().trim() }])
          el.close()
        }}
      >
        <div class="modal-body scroller">
          <label class="field-group">
            <span class="label">
              {t("models.modelId")} <span class="req">*</span>
            </span>
            <input
              class="field mono"
              type="text"
              required
              placeholder={t("models.modelIdExample")}
              value={id()}
              onInput={(e) => setId(e.currentTarget.value)}
            />
          </label>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onClick={() => el.close()}>
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn primary">
            {t("common.add")}
          </button>
        </div>
      </form>
    </Modal>
  )
}
