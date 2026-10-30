import solidV2 from "eslint-plugin-solid/configs/v2"
import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    printWidth: 120,
    semi: false,
    ignorePatterns: ["docs/**", "review/**", "packages/server/src/names.json"], // archived research and reviews and the generated name table stay verbatim
  },
  lint: {
    ignorePatterns: ["**/dist/**"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "solid", specifier: "eslint-plugin-solid" }, // the 2.0 rules: removed-api, no-single-arg-create-effect, no-accessor-as-prop …
    ],
    settings: solidV2.settings,
    rules: { "vite-plus/prefer-vite-plus-imports": "error", ...solidV2.rules },
    options: { typeAware: true, typeCheck: true },
  },
})
