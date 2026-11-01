# 全局代码审阅报告（2026-11-01）

2026-11-01。本文从 **前后端架构、逻辑准确性、性能、复杂度与可维护性、安全性、交互流畅度、美观度与样式体系** 七个维度对当前四包仓库（`runtime`、`provider`、`server`、`client`）进行全量审阅，并结合既有设计决议（见 [`review/milestone-review.md`](./milestone-review.md)）过滤掉已明确取舍的设计项，聚焦于真实存在的缺陷、隐患与高性价比优化点。

---

## 一、 前后端架构 (Architecture)

### 1. 生产入口与开发态耦合，打包混入测试桩且硬编码 `inspect: true`
- **位置**：
  - `packages/server/src/main.ts:6`
  - `packages/server/src/dev.ts:20-21, 97, 113`
  - `packages/provider/src/index.ts:3, 6`
- **现状与问题**：
  1. 生产入口 `main.ts` 直接 `import { dist, handler } from "./dev.ts"`。而 `server/src/dev.ts` 顶层引用了 `@effect-tavern/runtime/test/cards/index.ts` 与 `@effect-tavern/runtime/test/script.ts`；同时 `provider/src/index.ts` 无条件导出了 `./fake.ts`（依赖 `ai/test` 的 `MockLanguageModelV4`）和 `./dev.ts`（读取本机 `~/.deckled/credentials.json`）。这导致执行 `bun run compile` / `compile:android` 构建生产二进制时，测试专用代码与本机开发凭证探测逻辑被一并打入生产包。
  2. `server/src/dev.ts:113` 硬编码了 `handle(lib, { inspect: true })`。根据 `serve.ts:71-74` 的边界契约，卡片的 `frame`、`fiction`、`guard` 与 `lore` 属于服务端秘密，非 `inspect` 模式下 `shown()` 会剥离 `call.msgs`；但因 `main.ts` 直接复用 `dev.ts` 的 `handler`，生产环境下所有 SSE 流与 `GET /api/calls` 均向客户端完整暴露了包含卡片底层设定的 `msgs`。
- **建议**：将内置模板卡移出 `runtime/test/` 至正式资源目录；将 `fake.ts` 与 `dev.ts` 从 `provider/src/index.ts` 主入口剥离为独立子路径；在 `main.ts` 中按环境变量（如 `INSPECT=1`）显式控制 `inspect` 开关。

### 2. 前端网络层 `got()` 未校验 HTTP 状态码，错误响应会直接污染全局 Atom
- **位置**：`packages/client/src/wire.ts:52-177`
- **现状与问题**：
  - `const got = async (res: Promise<Response>) => (await res).json()` 未检查 `r.ok`（全文件仅 `checked()` 检查了状态码）。
  - 当服务端返回 `400` / `404` / `409` / `500` 的 `{ error: "..." }` JSON 时，`fetchCard`、`fetchNodes`、`fetchStories`、`fetchPersonas`、`putPlayer` 等函数会将 `{ error }` 对象当作正常业务数据直接 `registry.set(...)` 写入 `card`、`log`、`stories`、`player` 等全局 Atom，导致下游组件读取数组或字段时抛出运行时 `TypeError`。
  - 同时，设置页、写作页、供应商页大量调用采用 `void put*(...)` 形式且无 `.catch()`，网络失败或校验拒绝时静默丢弃用户修改。
- **建议**：在 `got()` 中统一校验 `if (!r.ok)` 并抛出带状态码与服务端 `error` 字段的异常；在 `wire.ts` 写操作失败时提供统一的错误反馈或状态回滚。

### 3. 全局 `x-tavern-story` 请求头在串联异步调用中的竞态与空故事 `404`
- **位置**：
  - `packages/client/src/wire.ts:45-51` (`call`)
  - `packages/client/src/writing.tsx:566-569` (`put`)
- **现状与问题**：
  - `call()` 在发起 `fetch` 的瞬间读取全局单例 `registry.get(stories)?.current` 注入 `x-tavern-story`。
  - 在 `writing.tsx:566-569` 中：
    ```ts
    const put = async (p: Player) => {
      await putPlayer(p)
      await fetchCard()
    }
    ```
    若用户在书架点击某张卡片进入详情页、再打开「写作」页（此时尚未创建故事，`stories().current === null`，但 `card()` 持有通过 `fetchCardOf(id)` 拉取的卡片视图），修改标点或快捷短语触发 `put()` 时，第二步 `await fetchCard()` 请求 `GET /api/card` 会因缺少 `x-tavern-story` 直接收到 `404`，并把 `{ error: "no story" }` 塞进 `card` Atom 导致页面崩溃。
  - 同理，在 `await putPlayer(p)` 挂起期间若用户切换了标签页（`tabs.ts` 立即改写 `stories.current`），后续的 `fetchCard()` 会落到新标签页的故事上。
- **建议**：像 `tabs.ts:45-46` 一样，当 `stories().current !== null` 时调 `fetchCard()`，否则调 `fetchCardOf(view()!.id)`；并在发起多步异步操作前捕获发起时的 `storyId` 显式传入请求。

---

## 二、 逻辑准确性与边界条件 (Logical Accuracy)

### 1. 状态路径包含 `.` 时，`card.ts`（扁平键）与 `cond.ts`（嵌套对象）自相矛盾
- **位置**：
  - `packages/runtime/src/card.ts:123, 138, 148`
  - `packages/runtime/src/cond.ts:22-26`
  - `packages/runtime/src/lint.ts:116-122`
- **现状与问题**：
  - `card.ts` 将所有状态字段作为**扁平属性名**存储在 `State` 对象上：`Object.fromEntries(r.fields.map((f) => [f.path, f.initial]))`、`s[path]`、`out[e.path] = e.set`。
  - 但 `cond.ts:23` 的 `at(s, path)` 为了兼容 `derived.ts:141` 注入的嵌套结构 `s.lore[id].since`，使用了 `path.split(".").reduce((o, k) => o?.[k], s)`。
  - **后果**：
    1. 卡片作者若定义带点的字段路径（如 `npc.trust` 或 `body.hp`），能通过 `makeCard` 和 `lint()`，也能正常执行 `set` / `add` 变更，但只要任何 `when` / `unlock` / `offer` / `over` 条件引用该路径，`cond.ts` 就会去查找 `s["npc"]["trust"]` 并抛出 `Error: unknown state path: npc.trust`。
    2. `cond.ts:23` 未检查 `Object.hasOwn`，若路径含原型链属性名（如 `toString`）不会报错。
    3. `makeCard` 与 `lint.ts` 未禁止定义名为 `"lore"` 的状态字段，若定义则会被 `derived.ts:141` 的 `lore` 计数器静默覆盖。
- **建议**：在 `cond.ts` 的 `at(s, path)` 中优先检查 `if (Object.hasOwn(s, path)) return s[path]`，再回退到嵌套路径解析；同时在 `lint.ts` 中禁止字段路径命名为 `"lore"` 或 `"lore.*"`。

### 2. 对有后代的历史节点执行 `setField` 可能永久损坏整个故事存档
- **位置**：
  - `packages/runtime/src/session.ts:815-820`
  - `packages/runtime/src/card.ts:165-166`
- **现状与问题**：
  - `setField(nodeId, effects)` 仅校验了 `nodeId` 本身的结算（`derived.at(chain(t.parent)).settle({ ...t, adjust })`），随后通过 `Log.amend` 原位修改该节点并写入 SQLite。
  - 若 `nodeId` 下方已有后代节点，当后续调用 `GET /nodes`（`s.snapshot()`）或继续推进后续回合时，所有后代节点的 `beats` 都会基于新的状态重放（`rpg.fold` → `rpg.settle`）。
  - 一旦 `nodeId` 的字段修改使得某个后代节点当年记录的 beat action 的 `when` 条件不再满足，`rpg.settle`（`card.ts:166`）就会直接抛出 `Error: <action>: not an available action`——导致 `GET /nodes` 永远报错，该故事存档彻底无法打开。
- **建议**：
  - 方案 A（重放宽容）：重放已落盘的历史 beat 时跳过 `when` 可用性报错（只校验动作存在性，因为历史已经发生）；
  - 方案 B（写入前全树校验）：在 `setField` 提交前对 `nodeId` 子树的所有后代节点试跑一遍 `derived.at` 校验，若破坏后代合法性则拒绝修改。

### 3. 折叠摘要缓存未感知 `demand` / `setField` 的原位修改 (`Log.amend`)
- **位置**：
  - `packages/runtime/src/history.ts:28-35` (`makeSummaries`)
  - `packages/runtime/src/session.ts:824-836` (`demand`)
  - `packages/client/src/readings.tsx:526, 663`
- **现状与问题**：
  - 在 `milestone-review.md` 撰写时，前端尚未暴露 `demand` 入口；但目前前端已在 `readings.tsx:526, 663` 正式接入了 `turn.demand(node, id)`。
  - `history.ts:28` 的 `makeSummaries().compress` 仍仅以起止节点 ID `${range[0].id}-${range[range.length - 1].id}` 作为缓存键。当玩家或后续逻辑通过 `demand` 重新生成了已折叠区间内某节点的 `notes`（通过 `Log.amend` 原位更新 `products`）时，缓存键不变，`compress` 仍返回旧摘要。
  - 此外，`session.ts:825` 的 `demand` 在返回 `Stream` 之前就捕获了 `const t = turnOf(nodeId)`，待异步 LLM 调用结束后用 `{ ...t.products, ...rec.products }` 写回，若期间节点有任何变动会使用过期快照。
- **建议**：在 `Log.amend` 时为节点维护修订号（或将区间内 `notes` 的内容哈希纳入 `compress` 缓存键），并在 `demand` 内部 `yield* record(...)` 完成后再读取最新的 `turnOf(nodeId)`。

### 4. 模型在 Judged Action 中漏填可选字段 `chance` 时直接崩溃
- **位置**：`packages/runtime/src/card.ts:161, 190-195`、`packages/runtime/src/session.ts:499-524`
- **现状与问题**：
  - `decideSchema`（`card.ts:190-195`）中 `chance` 声明为 `Schema.optionalKey`（因为同轮候选里可能有 `"end"` 或非检定动作）。
  - 如果模型选中了带 `roll.judge` 的动作却未返回 `chance`，JSON Schema 校验仍会通过，紧接着在 `rpg.fold` → `chanceOf`（`card.ts:161`）抛出未捕获异常 `Error("${a.id}: judge chance missing on the beat")` 导致整轮失败。
  - 另外，当动作使用 `roll: { path: "some_field" }`（`card.ts:160`）时，`chanceOf` 直接返回字段值，未做 `[0, 1]` 范围钳制或 lint 检查。
- **建议**：在 `decideSchema` 中使用 `Schema.Union` 将「需 `chance` 的动作」与「无需 `chance` 的动作 / `"end"`」拆成判别联合 Schema，从结构化输出层强制模型在选中检定动作时必传 `chance`。

### 5. 检定随机数种子 `seeds` 每次新建 Session 或重启进程均从 `0` 重置
- **位置**：`packages/runtime/src/session.ts:310, 517`、`packages/runtime/src/card.ts:119`
- **现状与问题**：
  - `makeSession` 内部使用局部变量 `let seeds = 0`（`session.ts:310`），每次产生 beat 时赋给 `seed: ++seeds`。
  - 因为 `seeds` 未持久化，每次服务重启后重新打开已有故事，或者新建任何故事，前 $k$ 次检定的 `rollOf(seed)` 随机数序列完全一致（第 1 次检定永远是 `rollOf(1)`）。
- **建议**：根据当前故事已有的总 beat 数量加上故事 ID（或 `held.log.next`）派生初始 `seeds`，既保持确定性可测，又避免重启后重复相同的随机序列。

### 6. `demand` 完成时误清空底部输入框的 `revising`（改写台词）状态
- **位置**：`packages/client/src/store.ts:314-322, 360-368`
- **现状与问题**：
  - `settle()` 会无条件执行 `registry.set(revising, null)`，且每当收到带 `e.node` 的 `change` 事件时都会调用 `settle()`。
  - 当玩家点击某轮气泡下的「改写」使底部输入框处于 `revising` 状态时，如果顺手点开某轮 Record 触发了小剧场（`demand`），`demand` 返回 `change` 事件时会调用 `settle()` 把 `revising` 抹成 `null`，导致玩家随后发送的改写台词变成在文末追加新回合。
- **建议**：仅在当前结束的动作是推进或改写主线的回合（而非 `demand` / `setField` 原位修订）时清空 `revising`。

### 7. 卡片详情页切卡时未重置开场白索引 `at()`，且 `begin()` 缺少防重入
- **位置**：`packages/client/src/card.tsx:57, 68-74`
- **现状与问题**：
  1. `CardPage` 内 `const [at, setAt] = createSignal(0)` 在组件挂载期间保持不变。当用户已经在卡片页（`page() === "card"`）并从左侧栏点击切换到另一张卡片时，`CardPage` 不会卸载重建；若前一张卡选了第 4 个开场白（`at() === 3`），而新卡只有 1 个开场白，`openings()[at()]` 为 `undefined`，页面错误显示“无开场白”，点击开始还会向服务端发送越界的 `greet(3)`。
  2. `begin()` 中 `await newStory(view()!.id)` 期间 `working` 仍为 `false`，快速双击「开始」按钮会创建两个空白故事并触发两次 `greet`。
- **建议**：监听 `view()?.id` 变化将 `at` 重置为 `0`（或在 `createSignal(() => (view()?.id, 0))` 可写派生信号上维护），并为 `begin()` 增加本地 `starting` 防重入状态。

### 8. `data.ts` 进程文件锁在并发启动与 `SIGINT` 下的边界问题
- **位置**：`packages/server/src/data.ts:101-143`
- **现状与问题**：
  1. `writeFileSync(path, String(process.pid), { flag: "wx" })` 先创建空文件再写入字节。若另一进程恰好在文件刚创建但尚未写入完成（或刚被删除）的微秒窗口内触发 `EEXIST` 并执行 `Number(readFileSync(path, "utf8"))`，空字符串会转为 `0`。而 `alive(0)` 调用 `process.kill(0, 0)` 在 POSIX 下代表检查**当前进程组**，恒返回 `true`！结果第二个进程误以为 PID `0` 持有锁，将库分流到 `<dir>/0/tavern.db`。
  2. `data.ts:138-141` 注册了 `process.once("SIGINT", ...)`，仅当 `!process.listenerCount(sig)` 时才重新发送信号终止进程。若宿主进程（如 Vite 或其他插件）也注册了 `SIGINT` 监听器，`listenerCount` 大于 0，可能导致进程清理锁文件后不退出。
- **建议**：在 `alive(pid)` 中增加 `if (!Number.isInteger(pid) || pid <= 0) return false`，并对 `readFileSync` 捕获 `ENOENT`。

---

## 三、 性能与可扩展性 (Performance)

### 1. `GET /nodes` (`s.snapshot()`) 存在 $O(N)$ 次重复 SQLite 查询与 $O(N^2)$ 路径重算
- **位置**：
  - `packages/server/src/library.ts:115-125` (`policy`)
  - `packages/runtime/src/derived.ts:136-177` (`gated`, `readableOn`)
  - `packages/runtime/src/session.ts:740-744` (`snapshot`)
- **现状与问题**：
  1. `s.snapshot()` 对故事中的每个节点调用 `project(t)` → `readableOn(path)` → `foldOf(path)` → `policy()`。而 `library.ts:115-125` 的 `policy()` 每次调用都会同步执行 `data.routing.read()`（查询 `routing` 表 + `JSON.parse`）和 `data.providers.list()`（查询 `provider` 全表 + 逐行 `JSON.parse`）。一个 100 节点的故事在一次 `GET /nodes` 请求中会重复执行 **200 次完全相同的 SQLite 查询与 JSON 反序列化**。
  2. `derived.ts` 中仅 `settledFrom` 做了按节点 ID 的缓存，`gated(path)` 与 `readableOn(path)` 均未缓存。在 `snapshot()` 遍历 $N$ 个节点时，每个节点都从根节点重新跑一遍 `L.counters`、`floorAt`（对路径上每个历史状态评估 `holds()`）以及 `recallEntries`，复杂度达 $O(N \cdot \text{depth} \cdot |\text{lore}|)$。
- **建议**：对 `gated` 按节点 ID 增设与 `settledFrom` 相同的增量缓存；在 `library.ts` 中缓存 `routing` / `providers` 的内存解析结果（在 `put`/`del`/`write` 时失效）。

### 2. `lib.exists(id)` 与 `lib.cardOf(id)` 每次调用都执行递归 CTE 扫描整条故事节点链
- **位置**：
  - `packages/server/src/library.ts:216-217, 247`
  - `packages/server/src/data.ts:250-276`
  - `packages/server/src/serve.ts:158, 184, 261, 265`
- **现状与问题**：
  - `library.ts:216` 定义了 `const row = (id: Id) => data.stories.list(undefined, id)[0]`，并将其用于 `exists(id)` 和 `cardOf(id)`。
  - 而 `data.stories.list` 会执行递归 CTE 从 `story.head` 一路向上回溯到根节点，并对沿途每个节点做三次 `json_extract`。
  - 这意味着每一个携带 `x-tavern-story` 的请求（`GET /card`、`GET /nodes`、`GET /turn`、`POST /`、`POST /stop`、`GET /stories`）在入口做 `lib.exists(asked)` 检查时，都在数据库里把整条故事树扫描了一遍；同时 `data.ts:171` 的 `const q = (sql: string) => db.prepare(sql)` 每次调用都重新编译 SQL。
- **建议**：在 `data.stories` 上提供轻量的 `get(id)`（`SELECT id, card, title, starred, updated FROM story WHERE id = ?`）供 `exists` 与 `cardOf` 使用；并对高频固定 SQL 语句缓存 `StatementSync`。

### 3. 阅读流中所有已关闭的 `<RecordSheet>` 均全量挂载 DOM 并随 `log` 更新重复执行 `JSON.stringify`
- **位置**：
  - `packages/client/src/App.tsx:453`
  - `packages/client/src/readings.tsx:394, 516-532`
- **现状与问题**：
  - 阅读器每一轮 `<Section>` 都渲染了 `<RecordSheet node={props.node} n={props.n} />`。尽管其内部 `<dialog>` 处于关闭状态，`<TurnRecord>` 与 `<Demand>` 仍然立即挂载并求值。
  - 更关键的是，`RecordSheet` 中的 `const prev = () => parentOf(all(), props.node)`（`readings.tsx:520`）读取了全局 `all = read(log)`，而 `TurnRecord` 内的 `rec` memo 使用了 `{ equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) }`（`readings.tsx:394`）。
  - 结果：当故事进行到 100 轮时，每当新回合落盘或 `log` 更新，**全部 100 个从未打开过的历史回合弹窗**都会同时重跑 `parentOf`、`record()` 投影以及整树 `JSON.stringify` 对比。
- **建议**：在 `Sheet`（或 `RecordSheet`）中维护 `open` 信号，仅当弹窗打开时（`<Show when={open()}>`）才渲染 `<TurnRecord>` 与 `<Demand>`。

### 4. `dust.ts` 粒子吹散特效的百万级顶点分配、闪烁与超长文本纹理越界
- **位置**：`packages/client/src/dust.ts:57-61, 114-150`
- **现状与问题**：
  1. `dust.ts:131` 按 CSS 像素 1:1 生成粒子：`const n = w * h`，并用 `Float32Array.from({ length: n }, (_, i) => i)` 初始化。一段 672×1500px 的正文会产生 **1,008,000 个顶点**，主线程初始化数组耗时明显，且每帧绘制百万个 `gl.POINTS`。
  2. `canvas.height = ch * dpr` 在 2x/3x 视网膜屏上，当单轮文本超过 ~1400–2000px 高时会突破常见移动 GPU 的 `MAX_TEXTURE_SIZE`（4096px）。
  3. `el.style.visibility = "hidden"` 在 `await new Promise(requestAnimationFrame)` 和 `await snapshot(el, dpr)` 之后才执行（`dust.ts:124-126`），而 `.drafts > * { grid-area: 1 / 1 }` 将 `.prev` 与 `.now` 叠在同一格，导致二稿开写的前 1～2 帧新旧文字重叠闪烁。
- **建议**：将粒子采样步长设为 2px（粒子数直接降为 1/4，视觉几乎无差），用 `for` 循环填充 `Float32Array`，对 `canvas` 尺寸按 `gl.getParameter(gl.MAX_TEXTURE_SIZE)` 封顶，并在进入 `dissolve` 时优化新旧层显隐切换时机。

### 5. Inspector `Digest` 中 `sent()` 未做 Memo 化导致重复正则扫描
- **位置**：`packages/client/src/inspector.tsx:89-95, 159`
- **现状与问题**：`const sent = () => new Map(props.call.msgs.flatMap((m) => [...m.content.matchAll(SENT_BLOCK)])...)` 是普通函数而非 `createMemo`。在 `changed` memo 中每个输出 key 都会调用两次 `sent()`（`sent().has(k)` 与 `sent().get(k)`），外加 JSX 中的 `sent().size`，导致每次打开或切换节点时对完整 Prompt 消息体重复执行 `2K + 1` 次全文正则扫描与 `Map` 构建。
- **建议**：将 `sent` 改为 `createMemo`。

---

## 四、 复杂度与可维护性 (Complexity & Maintainability)

### 1. 核心大文件职责过载
- **`packages/runtime/src/session.ts`（893 行）**：同时承载了默认 Prompt 词条（`asks`）、中文快捷输入（`snippets`）、标点符号模板（`format`）、默认 `products`、动态 JSON Schema 生成、客户端卡片摘要投影（`cardView`）、7 阶段主循环以及 Wire Action 解码与分发。将默认配置数据（`asks` / `snippets` / `format` / `defaultProducts`）与 `cardView` 拆出后，`session.ts` 可聚焦于纯回合状态机。
- **`packages/client/src/providers.tsx`（1073 行）与 `writing.tsx`（811 行）**：单文件内聚合了列表、详情抽屉、连通性探测、模型同步抽屉、表单编辑等多个独立视图。

### 2. 前端多处混用 `node.id` 与 `node.turn.id`
- **位置**：
  - `packages/client/src/App.tsx:425, 440, 444, 469, 481`
  - `packages/client/src/inspector.tsx:41, 321-322`
  - `packages/client/src/timeline.tsx:75, 91`
  - `packages/client/src/composer.tsx:55`
- **现状与问题**：虽然运行期 `node.id === node.turn.id`，但代码中一半位置取 `node.turn.id`（例如 `App.tsx:440` 挂载 `<section id={\`node-${props.node.turn.id}\`}>`），另一半位置取 `node.id`（例如 `composer.tsx:55` 和 `timeline.tsx:75` 查找 `document.getElementById(\`node-${node.id}\`)`）；`inspector.tsx:321-322` 甚至在相邻两行分别用 `all().nodes.get(props.id)`（按 `Node.id`）和 `line().findIndex((x) => x.turn.id === props.id)`（按 `Turn.id`）。
- **建议**：统一使用 `node.id`（或在 `Node` 投影结构中消除重复层级）。

### 3. Recall Product 借道 `Disclosure` 的字符串拼接协议脆弱
- **位置**：`packages/runtime/src/product.ts:163-171`、`packages/runtime/src/derived.ts:58-64, 174`、`packages/runtime/src/session.ts:382`
- **现状与问题**：为了将 `recall: true` 的产物条目塞进 Lore 的 `Disclosure`（`{ id: string, layer: number }`），代码将引用编码为 `${p.id}@${node}#${i}` 并固定 `layer: 1`，再经 `lore.ts` 的 `key(d)` 拼成 `people@3#0#1`。而在 `session.ts:382` 的 `deliver()` 中，遇到符合 `entryRef(id)` 正则的 `input.pin` 时未检查其是否存在于 `here.readable()` 中便直接放行，若索引越界会在 `derived.ts:63` 产出 `"undefined"` 拼入 Prompt。
- **建议**：在 `session.ts:456` 校验 `input.pin` 时，统一要求被钉住的条目必须属于当前可揭示集合（或有效未读层）。

---

## 五、 安全性 (Security)

### 1. 默认绑定 `0.0.0.0` + 无鉴权读取明文密钥 + 缺少跨站请求 (Origin/CSRF) 保护
- **位置**：
  - `packages/server/src/main.ts:14`
  - `packages/server/src/serve.ts:133-316`（特别是 `219-223`）
- **现状与问题**：
  1. `main.ts` 调用 `.listen(port)` 未指定 host，在 Node/Bun 下默认监听 `0.0.0.0`，使局域网内其他设备可直接访问 `/api`。
  2. `GET /api/secrets` 列出所有密钥 ID，`GET /api/secrets/:id/value`（`serve.ts:219-223`）无需鉴权即可直接返回明文 API Key（包括启动时 `dev.ts:97` 自动从环境变量或 `~/.deckled/credentials.json` 导入的 Anthropic Key）。
  3. `serve.ts` 未检查 `Origin`、`Sec-Fetch-Site` 或 `Content-Type: application/json`。即使服务只监听 `127.0.0.1`，用户在浏览器中打开的任意第三方网页也可通过简单跨站请求（如 `<form>` 或 `fetch("http://localhost:.../api/...", { method: "POST", mode: "no-cors", body: JSON.stringify(...) })`）静默修改配置、删除故事或触发模型调用。
- **建议**：
  - `main.ts` 默认绑定 `127.0.0.1`（需局域网访问时通过环境变量如 `HOST=0.0.0.0` 显式开启）；
  - 在 `serve.ts` 中对所有写请求（`POST` / `PUT` / `DELETE`）强制要求 `Content-Type: application/json`（浏览器跨域简单请求无法伪造该 Header 而不触发 CORS 预检）并校验 `Origin` / `Sec-Fetch-Site`。

### 2. 畸形 URL 百分号编码触发未捕获 `URIError`
- **位置**：`packages/server/src/serve.ts:199, 209, 221, 226, 236, 259, 340`
- **现状与问题**：`handle()` 与 `app()` 直接对正则匹配的 URL 片段调用 `decodeURIComponent(...)`，且位于 `reply()` 的 `try/catch` 之外。一旦收到非法百分号编码（如 `GET /%E0%A4%A` 或 `GET /api/cards/%FF`），会直接抛出未捕获的 `URIError: URI malformed`。
- **建议**：封装安全的解码辅助函数或在请求入口顶层捕获 `URIError` 返回 `400`。

### 3. 请求体超限时对已销毁流写入响应
- **位置**：`packages/server/src/serve.ts:86-99, 145-151`
- **现状与问题**：当请求体超过 `1 MB` 时，`body()` 调用 `reject(new Error("body too large"))` 并立即 `req.destroy()`；随后 `reply()` 捕获异常并调用 `res.writeHead(400)` 向已销毁的连接写响应。应在超限时返回 `413` 后再关闭连接，或跳过对已销毁 socket 的写入。

---

## 六、 交互流畅度与 UX 细节 (Interaction Smoothness)

### 1. 正文原位编辑器 (`Editor`) 粘贴多段文本丢失段落分隔，且清空后换行退化
- **位置**：`packages/client/src/App.tsx:68-110`
- **现状与问题**：
  - 为保持点击编辑时零排版位移，`Editor` 采用了 `contenteditable` + `<p>` 块（见 `milestone-review.md` 第四节第 3 条）。
  - 但 `onPaste`（`App.tsx:102-106`）把剪贴板文本中的 `\r?\n{2,}` 替换成了**单个** `\n` 后交给 `document.execCommand("insertText", false, text)`，而在保存时 `submit()` 却用 `paragraphs(box.innerText)` 按 `/\n{2,}/` 切分段落。
  - 同时，若用户在编辑器内全选并按 Backspace 删空所有文字，浏览器会移除最后一个 `<p>` 标签，此后输入的换行仅生成 `<br>`（`innerText` 中为单个 `\n`），提交时多段文字会被合并成单个段落。
- **建议**：在 `onPaste` 中按段落切分插入 `<p>` 节点（或保留双换行），并在编辑器内容被删空时确保保底保留一个空 `<p>`。

### 2. Inspector 的 `[` / `]` 快捷键拦截了浏览器原生的前进/后退 (`⌘[` / `⌘]`)
- **位置**：`packages/client/src/inspector.tsx:384-393`
- **现状与问题**：`onKey` 监听 `[` 与 `]` 时未检查修饰键 `if (e.metaKey || e.ctrlKey || e.altKey) return`，导致在 macOS 下打开 Inspector 时按 `⌘[`（浏览器后退）或 `⌘]`（前进）被 `e.preventDefault()` 拦截并变成了切换 Inspector 节点。

### 3. 触屏设备上无法操作 Story Manager 卡片的收藏、重命名与导出按钮
- **位置**：`packages/client/src/chrome.css:801-813`
- **现状与问题**：`.manager .card .acts` 默认 `opacity: 0; pointer-events: none;`，仅在 `:hover` 或 `:focus-within` 下展示，缺少像 `reader.css:432-437` 那样的 `@media (hover: none)` 触屏适配规则。在手机或平板上点击故事卡片会直接触发 `pick(s.id)` 打开故事，无法操作右上角的按钮组。

### 4. Composer 空框按 `/` 被强制拦截，无法输入以 `/` 开头的文本
- **位置**：`packages/client/src/composer.tsx:274-279`
- **现状与问题**：当输入框为空时按下 `/`，即使当前没有任何启用的快捷短语（`usable().length === 0`），也会执行 `e.preventDefault()` 并弹出空菜单，且阻碍了用户直接输入 `/` 字符。建议仅在 `usable().length > 0` 时触发，或在菜单已打开时再次按 `/` 允许输入字面量 `/`。

### 5. 组件卸载时的定时器与订阅清理遗漏
- **位置**：
  - `packages/client/src/timeline.tsx:81-90`：`openInReader` 在调用 `turn.checkout(id)` 前注册了 `registry.subscribe(path, ...)`，若此时故事处于 `busy` 状态或请求失败，`unsub()` 永远不会执行，泄漏顶层响应式 Root。
  - `packages/client/src/controls.tsx:229-254`：`<Confirm />` 仅挂载在 `<Settings />` 内部，但模块级单例 `let asker` 在组件卸载时未重置为 `undefined`。
  - `packages/client/src/side.tsx:110`、`manager.tsx:46, 87`、`providers.tsx:230`、`shell.tsx:83, 105`：组件内的防抖/动画 `setTimeout` 未在卸载时清理。

---

## 七、 美观度与样式体系 (Aesthetics & CSS)

### 1. CSS Anchor Positioning (`position-anchor`) 缺少非 Chromium 引擎回退
- **位置**：
  - `packages/client/src/reader.css:174-177` (`.latest`)
  - `packages/client/src/chrome.css:414-417, 475-484` (`.pop.menu`, `.snippets`)
  - `packages/client/src/settings.css:431-440` (`.pop.listbox`, `.combobox-pop`)
- **现状与问题**：`.latest`（回到底部按钮）完全依赖 `position: fixed; position-anchor: --composer; position-area: top;`，未提供 `bottom` / `right` 回退值。在不支持 CSS Anchor Positioning 的浏览器（如 Firefox 或部分移动端 WebView）中，该按钮会直接掉落在视口左上角 `(0, 0)` 处。
- **建议**：为 `.latest` 补齐常规 `bottom` / `left` / `right` 定位基准，或使用 `@supports (position-anchor: --composer)` 渐进增强。

### 2. 窄屏 + 大字号下阅读器顶部渐隐遮罩 (`mask-image`) 计算出负起点
- **位置**：`packages/client/src/reader.css:35-42, 91-93`
- **现状与问题**：在 `< 72rem` 窄屏下，`--head` 被设为 `var(--fade)`（`24px`），而遮罩渐变的透明起点为 `calc(var(--head) - var(--gap-turn))`（其中 `--gap-turn` 为 `calc(var(--step) * 0.75)`）。当用户在写作页调大字号使 `--gap-turn > 24px` 时，`calc(var(--head) - var(--gap-turn))` 变成负数，导致滚动容器顶边无法完全透明。
- **建议**：改为 `max(0px, calc(var(--head) - var(--gap-turn)))`。

### 3. 少量硬编码色值偏离 `@layer tokens` 设计令牌规范
- **位置**：
  - `packages/client/src/inspector.css:520`：`.inspect mark` 使用了硬编码的 `light-dark(#fde047, #a16207)`，而 `shell.css:275` 和 `chrome.css:858` 的 `<mark>` 均使用 `var(--warn-soft)`。
  - `packages/client/src/reader.css:733`：`.composer .attach` 硬编码 `light-dark(rgb(20 20 20 / 0.03), rgb(255 255 255 / 0.035))`。
  - `packages/client/src/settings.css:494`：`.switch .thumb` 硬编码 `background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 0.3)`。

### 4. 窗口缩放时 `shrinkwrap.ts` 存在读写交替的强制同步布局 (Layout Thrashing)
- **位置**：`packages/client/src/shrinkwrap.ts:55-68, 76`
- **现状与问题**：`ResizeObserver` 回调执行 `blocks.forEach(fit)`，而 `fit` 对每个气泡先读取 `getComputedStyle(bubble)`，紧接着写入 `bubble.style.width = ...`。在多轮对话中，写第 $i$ 个气泡的 `style.width` 会使样式失效，导致读取第 $i+1$ 个气泡时触发强制同步重排。
- **建议**：在 `ResizeObserver` 中分两阶段处理——第一阶段批量读取所有气泡的尺寸与字体测量结果，第二阶段统一写入 `style.width`。

---

## 八、 推荐修复优先级清单

| 优先级 | 类别 | 核心改动项 | 涉及文件 |
| :--- | :--- | :--- | :--- |
| **P0** | 逻辑 / 存档安全 | 修复 `cond.ts` 扁平状态键查找与 `setField` 破坏后代节点导致存档无法加载的问题 | `runtime/src/cond.ts`, `runtime/src/session.ts`, `runtime/src/card.ts` |
| **P0** | 前端稳定性 | `wire.ts` 的 `got()` 增加 `!r.ok` 校验；修复空故事下 `writing.tsx` 调用 `fetchCard()` 404 污染状态 | `client/src/wire.ts`, `client/src/writing.tsx` |
| **P0** | 安全与构建边界 | 解耦 `main.ts` 与 `dev.ts`，生产环境关闭 `inspect: true`，默认监听 `127.0.0.1`，写接口校验 `Content-Type` / `Origin`，捕获 `decodeURIComponent` 异常 | `server/src/main.ts`, `server/src/dev.ts`, `server/src/serve.ts` |
| **P1** | 性能 (Backend) | `exists`/`cardOf` 改用轻量单行查询；缓存 `derived.ts` 的 `gated` 与 `library.ts` 的 `policy` 查询 | `server/src/library.ts`, `server/src/data.ts`, `runtime/src/derived.ts` |
| **P1** | 性能 (Frontend) | `<RecordSheet>` 内部 `<TurnRecord>` 改为打开时惰性挂载；`inspector.tsx` 的 `sent()` 改为 `createMemo` | `client/src/readings.tsx`, `client/src/inspector.tsx` |
| **P1** | 交互细节 | 修复 `card.tsx` 切卡重置 `at(0)`、`store.ts` 中 `demand` 误清 `revising`、`inspector.tsx` 的 `⌘[` 冲突、`chrome.css` 触屏操作按钮可见性 | `client/src/card.tsx`, `client/src/store.ts`, `client/src/inspector.tsx`, `client/src/chrome.css` |
| **P2** | 体验与打磨 | 优化 `dust.ts` 采样步长与首帧闪烁、修复 `Editor` 多段粘贴、`shrinkwrap.ts` 读写分离与 `.latest` 锚点定位回退 | `client/src/dust.ts`, `client/src/App.tsx`, `client/src/shrinkwrap.ts`, `client/src/reader.css` |
