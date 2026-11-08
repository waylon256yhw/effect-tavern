import type { JSX } from "@solidjs/web"
import { Errored, Loading } from "solid-js"
import { t } from "./i18n.ts"

/** A failed on-demand read stays in its panel; retry remounts only that read. */
export const AsyncView = (props: { children: JSX.Element }) => (
  <Errored
    fallback={(error, reset) => (
      <div role="alert" class="error">
        <p>{String(error())}</p>
        <button type="button" onClick={reset}>
          {t("common.retry")}
        </button>
      </div>
    )}
  >
    <Loading fallback={<p class="dim">{t("common.loading")}</p>}>{props.children}</Loading>
  </Errored>
)
