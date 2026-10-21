/// <reference types="vite/client" />
declare module "*.css" {}
// unplugin-icons' own Solid typings predate Solid 2 (they take JSX from solid-js); the same shape against @solidjs/web.
declare module "~icons/*" {
  import type { JSX } from "@solidjs/web"
  const Icon: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element
  export default Icon
}
