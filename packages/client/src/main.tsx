import "./theme.ts" // the pinned side on :root before anything paints
import { render } from "@solidjs/web"
import { App } from "./App.tsx"
import "./app.css"

render(() => <App />, document.getElementById("root")!)
