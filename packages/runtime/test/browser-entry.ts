// Bundle entry for the platform-free authoring smoke test.
import { checkValue, validateCard } from "../src/author.ts"
import { applyCompile, applySort } from "../src/workshop.ts"
import { revision } from "../src/context.ts"

const authoring = { checkValue, validateCard, applyCompile, applySort, revision }
Object.assign(globalThis, { authoring })
export type Authoring = typeof authoring
