# 阶段性全局审阅（复核收敛版）

2026-10-26。区别于 `docs/`（外部生态与竞品的事实拆解）与 `design/`（面向下一阶段的新特性提案），本目录存放项目阶段性里程碑的全局审阅（Reviews）。本文在初版审阅的基础上逐条对照当前代码与既有设计决议做了复核，剔除误判与已否方案，按「确凿需修的问题」「机制成立但属潜在/低优事项」「需产品与设计拍板的取舍」三类收敛归档，另附「初版误判订正」备查。

---

## 一、确凿需修的问题（Worth Doing Now）

### 1. 停止生成（`stop`）在重写/续写与 `polish` 阶段的时序 Bug

- **重写或续写等待期点停止 → 服务端丢弃整轮、客户端轮询假死 30 秒**：
  - `packages/server/src/serve.ts:275` 在每次收到 `e.kind === "stage" && e.phase === "narrate"` 时，都会把 `narrating` 重置为 `false`（注释写着 `even on the correction rewrite`）。
  - 但运行时 `packages/runtime/src/session.ts:763-766` 的设计契约是：当 `check` 未通过触发第二稿重写、且在第二稿吐出第一个字之前收到 `stop` 时，**保留第一稿并以 `end: "stopped"` 落盘**；客户端 `packages/client/src/store.ts:182` 的 `arrived()` 也因为 `draft.prev` 非空而返回 `true`，`packages/client/src/App.tsx:628-641` 的 `onStop` 会据此切到 `stage = "record"` 并轮询 `fetchNodes()` 最多 100 次 × 300ms（30 秒）。
  - 此外，当 `finishReason === "length"` 且连接支持 `prefill` 触发续写时（`session.ts:737`），同样会再次发出 `stage: narrate`，把 `narrating` 清回 `false`。
  - 结果：玩家在第二稿（或 `prefill` 续写）吐出第一个字前点停止，服务端看到 `narrating === false` 直接 `Fiber.interrupt(fiber)` 丢弃整轮，而客户端死等 30 秒后报错 `"The stopped turn was not recorded"`。
  - **修法**：删掉 `serve.ts:275` 对 `narrating` 的重置（一旦本轮吐过第一个字，后续停止一律走 `Deferred.succeed(stop, undefined)`），同步更新 `README.md:113` 中「纠错重写的第二稿同样从头算」的表述，并在 `packages/server/test/serve.ts` 补齐「重写阶段停止」的测试断言。
- **`polish` 阶段停止按钮未置灰**：
  - `packages/client/src/App.tsx:669` 的 `stoppable={phase() !== "check" && phase() !== "record"}` 漏掉了 `"polish"`，导致 `polish` 期间停止按钮仍可点（点下后服务端仍跑完 `polish` 和 `record` 并以 `end: "end"` 落盘，客户端则断开 SSE 走轮询读回）。
  - **修法**：客户端将 `stoppable` 收紧为 `phase() !== "check" && phase() !== "polish" && phase() !== "record"`（服务端**切勿**在 `check` / `polish` 把 `narrating` 置回 `false`，否则会在此时断连时直接中断协程丢掉整轮）。

### 2. SQLite `call` 表无界增长与文档过时

- `README.md:113` 仍写着「server 按节点在内存里留着最近两百个节点的 calls，重启从头记」，但实际实现（`packages/server/src/data.ts:37-38, 182-198`）已改为全量写入 SQLite `call` 表，且没有上限或淘汰逻辑。
- 虽然 `GET /calls` 仅在打开 Inspector 时按需拉取、且单次调用的消息体积受折叠预算约束（约为 $O(N \cdot \text{budget})$），但长局下 SQLite 文件仍会持续累積历史调用记录。
- **修法**：为 `call` 表加上按节点数量的上限淘汰，并同步更新 `README.md:113` 的描述。

### 3. 两个低成本前端 UX 痛点

- **点击当前故事直接触发内联重命名（`packages/client/src/side.tsx:182`）**：
  - `if (s().id === lib()?.current) return void setRenaming(true)` 在手机端打开 Session 抽屉后，若玩家点一下当前高亮的故事想收起抽屉回到阅读器，反而会进入 `<input>` 重命名状态并弹出手机软键盘。
- **未配模型时首次发送报错缺少引导（`packages/server/src/library.ts:98`）**：
  - 新用户没有配置默认模型时，首屏在卡页点 `Begin`（`greet` 不调模型）可顺利进入阅读器，直到写完第一段话点发送才在草稿区看到 `no model: pick a default model in settings`，报错条旁缺少一键打开「设置 → 默认模型」的跳转入口。

---

## 二、机制上成立但属潜在/低优的事项

1. **`aside`（后置附言）流式外露与客户端未渲染**：
   - `packages/runtime/src/session.ts:734` 标有 `ponytail` 注释：流式阶段 `<<aside>>` 与附言原文会随 `text-delta` 一起流出，落盘后才经 `splitAside` 切为 `{ type: "aside" }` Part；同时客户端除 `inspector.tsx:497-500` 外尚未在阅读器或 Record 中渲染 `aside` Part。
   - 鉴于目前还没有任何卡片或 harness 提示词指示模型输出 `<<aside>>`，现阶段不会触发，待实际启用附言块时一并闭环。
2. **`polish` 对白掩码漏掉 `『…』` / `‘…’`，且改写后不复检**：
   - `packages/runtime/src/polish.ts:62-63` 的 `OPEN = /[「“]/`、`CLOSE = /[」”]/` 未包含单独使用的 `『』` 与弯单引号 `‘’`（嵌在 `「」` 里的 `『』` 已按深度掩住）（`session.ts:171` 的默认快捷片段里提供了 `『』`）。
   - `polish` 在 `check` 之后运行且不复检（`session.ts:774-801`），理论上存在改写句子时抹掉 `must` 线索的可能，属于省去二次 `check` 调用的设计取舍。
3. **折叠摘要缓存键不感知 `amend`**：
   - `packages/runtime/src/history.ts:26`（`makeSummaries().compress`）以起止节点 ID `${range[0].id}-${range[range.length - 1].id}` 为键；若未来前端接通 `demand` 重新生成已被折叠节点的 `notes`（`Log.amend` 原位修改），缓存键不会自动失效。目前前端无 `demand` / `setField` 入口，暂不触发。
4. **Timeline 在流式生成期间未禁用 `checkout` 与删除**：
   - 阅读器内的故事行（`side.tsx:180`）和版本切换按钮（`App.tsx:464, 471`）在 `busy()` 时均已禁用，不会在阅读器内发生流式串台；但 Timeline 页的 `checkout` 与分支删除未受 `busy` 限制。如果在生成中途从 Timeline 删掉当前正在生成的父节点，`Log.apply`（`packages/runtime/src/log.ts:87`）会在落盘时因找不到父节点抛出 `no node N` 使该轮报错丢弃，**不会**产生孤儿节点或损坏存档。
5. **跨端样式与基础组件细节**：
   - `packages/client/src/chrome.css:725` 在 `64rem`（1024px）切入 `15rem minmax(0, 1fr) 19rem` 三栏，在 `1024px ~ 1160px` 窄桌面区间中间阅读栏约 `384px`；从 `< 64rem` 打开手机端 Record `<dialog>` 后拉宽窗口至桌面端，对话框会以桌面端居中卡片形态留在画布上。
   - `packages/client/src/controls.tsx:20` 因避免将 `ai-sdk` 打进前端 bundle 而手动复制了一份 `DEFAULTS`（代码注释已标明）。
   - `packages/server/src/dev.ts:19` 从 `@effect-tavern/runtime/test/cards/index.ts` 加载内置模板卡，待未来卡包目录独立后可解耦。

---

## 三、需产品与设计拍板的取舍（非 Bug）

1. **界面语言统一**：
   - 目前阅读器、卡页、时间轴、检查器以英文为主，设置页全中文，左栏 `packages/client/src/side.tsx` 存在英文标题（`Stories` / `Persona` / `Writing` / `Pinned`）与中文芯片（`跟随卡片` / `第二人称`）、英文弹层选项（`As the card has it`，`side.tsx:274`）混排。全面统一为中文还是保留现状，需做设计拍板。
2. **单卡进程 vs 多卡切换**：
   - 数据库 schema 与 `GET /cards` 已备有多卡结构，但 `packages/server/src/library.ts:53` 当前按单卡实例 `card: Card` 运行。是否支持在 UI 内直接切换卡片属于产品形态决定。
3. **玩家层高级配置与节点动作入口**：
   - `Player` schema 中的全局/单卡片段（`global` / `forCard`）、自定义快捷片段（`snippets`）、标点替换表（`format`）、反八股词表（`writing.lexicon`），以及 `session.ts` 的 `setField` / `demand` 动作，目前仅在协议层就绪，是否及何时暴露到前端 UI 待定。
4. **深浅色主题切换开关**：
   - `packages/client/src/tokens.css:123-128` 已预留 `:root[data-theme="light" | "dark"]`，是否提供手动切换入口待定。

---

## 四、初版审阅误判与已否方案订正（备查）

为避免后续重复踩坑，记录初版审阅中不成立或违背既有决议的条目：

1. **Anthropic 连续 `system` 消息改写（`call.ts:72-91`）无 Bug**：
   - `assistant, system, system` 经 `wire("anthropic", ...)` 会变为 `assistant, user, system`；第二条 `system` 紧跟在 `user` 之后，正是 Anthropic 允许中途 `system` 消息出现的唯一合法位置（`call.ts:72` 已实测验证，`packages/provider/test/wire.ts:16` 有专门断言）。若将后续所有 `system` 改为 `user` 反而会破坏合法指令角色。
2. **不在左栏向普通玩家暴露 `node.readable` 供钉住**：
   - 2026-10-20 已定下原则：普通玩家（包括作者视角卡的玩家）不能看到未揭示的 hook，否则构成剧透；未揭示的 `readable` 仅在开发者 Inspector 的 `Untold` 区域可见，玩家侧只能钉住已在 Record 中揭示出第 1 层且尚有后续层的线索。
3. **正文原位编辑不使用 `<textarea>`（`App.tsx:104-125`）**：
   - `Editor` 采用 `contenteditable` + `execCommand` 是为了保证点击编辑时段落与字距零位移（此前使用 `<textarea>` 会导致整轮段落重排与行距跳变，已明确否决）。
4. **`folded` 遇到超长单轮一次折叠多个 `block`（`history.ts:31-55`）**：
   - `history.ts` 的契约是单调且按 `block` 边界对齐，遇到超长单轮时一次跨多个 `block` 正是为了守住折叠预算。
5. **`serve.ts` 的 JSON 解析异常与跨包引用**：
   - `serve.ts` 所有 `JSON.parse` 均已在 `try/catch` 内返回 `400`；`runtime`（`"./*"`）与 `provider`（`"./src/*"`）的 `package.json` `exports` 均显式声明了子路径导出。
