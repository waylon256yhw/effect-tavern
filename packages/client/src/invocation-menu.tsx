import { matchingInvocations } from "./composition.ts"
import type { InvocationToken } from "@effect-tavern/runtime/src/projection.ts"
import type { JSX } from "@solidjs/web"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { card, composition, log, path, stories } from "./store.ts"
import { fetchContext } from "./wire.ts"
import { t } from "./i18n.ts"

/** The only source is the authorized player catalog. Model lore and memory indexes never reach this menu. */
export const InvocationMenu = (props: {
  quick: JSX.Element
  keyboard?: boolean
  choose: (item: InvocationToken) => void
}) => {
  const context = createMemo(() => {
    log()
    card()
    stories()
    return fetchContext(path().at(-1)?.id ?? null)
  })
  const [source, setSource] = createSignal<"pack" | "card" | null>(null)
  const [category, setCategory] = createSignal<string | null>(null)
  const [query, setQuery] = createSignal("")
  const available = createMemo(() => matchingInvocations(context().playerCatalog, composition().invocations, query()))
  const scoped = () =>
    available().filter((i) => i.source === source() && (category() === null || i.category === category()))
  const groups = () => [...new Set(scoped().map((i) => i.category))]
  const label = (name: string) =>
    card()?.mounts.find((m) => m.id === name)?.name ??
    (name === "local" ? t("composer.localTools") : t("composer.playerTools"))
  const focusFirst = () =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>("#snippets [role=menuitem]")?.focus())
  createEffect(
    () => ({ keyboard: props.keyboard, ready: context().playerCatalog }),
    ({ keyboard }) => {
      if (keyboard) focusFirst()
    },
  )
  const back = () => {
    if (category() !== null) setCategory(null)
    else setSource(null)
    setQuery("")
    focusFirst()
  }
  return (
    <div
      class="invocation-menu"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" && source() && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault()
          e.stopPropagation()
          back()
        }
        if (e.key === "ArrowRight" && (e.target as HTMLElement).getAttribute("aria-haspopup") === "menu") {
          e.preventDefault()
          ;(e.target as HTMLButtonElement).click()
        }
        if (e.key === "Escape" && source()) {
          e.preventDefault()
          e.stopPropagation()
          back()
        }
      }}
    >
      <Show
        when={source()}
        fallback={
          <>
            {props.quick}
            <hr />
            <For each={["pack", "card"] as const}>
              {(s) => (
                <Show when={available().some((i) => i.source === s)}>
                  <button
                    type="button"
                    class="item"
                    role="menuitem"
                    aria-haspopup="menu"
                    onClick={() => {
                      setSource(s)
                      focusFirst()
                    }}
                  >
                    <span class="name">{s === "pack" ? t("composer.playerTools") : t("composer.cardTools")}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                </Show>
              )}
            </For>
          </>
        }
      >
        <div class="menu-heading">
          <button type="button" role="menuitem" aria-label={t("common.back")} onClick={back}>
            ‹
          </button>
          <strong>
            {category()
              ? label(category()!)
              : source() === "pack"
                ? t("composer.playerTools")
                : t("composer.cardTools")}
          </strong>
        </div>
        <input
          type="search"
          value={query()}
          aria-label={t("writing.searchEntriesLabel")}
          placeholder={t("writing.searchEntries")}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget
                .closest(".invocation-menu")
                ?.querySelector<HTMLElement>(".menu-results [role=menuitem]")
                ?.focus()
            }
          }}
        />
        <div class="menu-results">
          <Show
            when={source() === "pack" && category() === null && !query()}
            fallback={
              <For each={scoped()} keyed={(i) => i.resourceId} fallback={<p class="dim">{t("composer.noMatches")}</p>}>
                {(item) => (
                  <button type="button" role="menuitem" class="item asset" onClick={() => props.choose(item())}>
                    <span class="name">{item().title}</span>
                    <Show when={item().summary !== item().title}>
                      <span class="hint">{item().summary}</span>
                    </Show>
                  </button>
                )}
              </For>
            }
          >
            <For each={groups()}>
              {(g) => (
                <button
                  type="button"
                  role="menuitem"
                  class="item"
                  aria-haspopup="menu"
                  onClick={() => {
                    setCategory(g)
                    focusFirst()
                  }}
                >
                  <span class="name">{label(g)}</span>
                  <span aria-hidden="true">›</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
