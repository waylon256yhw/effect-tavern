import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import nimbus, {
  defineConfig as defineNimbusConfig,
} from "@cloudflare/nimbus-docs";
import { tableScroll } from "@cloudflare/nimbus-docs/markdown";

const nimbusConfig = defineNimbusConfig({
  site: "https://waylon256yhw.github.io",
  title: "Effect Tavern",
  description:
    "Declarative cards, multi-stage turn harness, and deterministic state settlement on Effect v4.",
  locale: "en",
  github: "https://github.com/waylon256yhw/effect-tavern",
  editPattern: "https://github.com/waylon256yhw/effect-tavern/edit/main/site/{path}",
  socialImageAlt: "Effect Tavern documentation",
  agents: {
    discovery: false,
  },
  sidebar: {
    items: [
      { label: "English", autogenerate: { collection: "docs" } },
      { label: "简体中文", autogenerate: { collection: "zh" } },
    ],
  },
});

export default defineConfig({
  base: "/effect-tavern",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [
    nimbus(nimbusConfig, {
      rules: {
        "nimbus/frontmatter-shape": "error",
        "nimbus/internal-link": "error",
      },
      markdown: {
        hastPlugins: [tableScroll()],
        features: { headingAttributes: false },
      },
    }),
  ],
});
