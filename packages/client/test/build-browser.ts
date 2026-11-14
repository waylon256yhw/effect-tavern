// Build the isolated acceptance fixture without starting or touching a dev server.
import { build } from "vite-plus"
import solid from "@solidjs/vite-plugin"
import Icons from "unplugin-icons/vite"
import { FileSystemIconLoader } from "unplugin-icons/loaders"
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
const outDir = await mkdtemp(join(tmpdir(), "tavern-ui-"))
await build({
  configFile: false,
  plugins: [
    solid({ observe: true }),
    Icons({
      compiler: "solid",
      customCollections: {
        lobe: FileSystemIconLoader(join(process.cwd(), "node_modules/@lobehub/icons-static-svg/icons")),
      },
    }),
  ],
  build: {
    lib: {
      entry: process.argv[2] ?? "test/browser.tsx",
      name: "Fixture",
      formats: ["iife"],
      fileName: () => "fixture.js",
    },
    outDir,
    minify: false,
  },
  logLevel: "error",
})
const css = (
  await Promise.all(
    (await readdir(outDir)).filter((f) => f.endsWith(".css")).map((f) => readFile(join(outDir, f), "utf8")),
  )
).join("\n")
const js = (await readFile(join(outDir, "fixture.js"), "utf8")).replaceAll("</script", "<\\/script")
await writeFile(
  join(outDir, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script>${js}</script>`,
)
console.log(join(outDir, "index.html"))
