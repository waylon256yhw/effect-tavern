// Standalone API binary; the CLI's serve command uses this same host lifecycle.
import { start } from "./start.ts"
await start()
