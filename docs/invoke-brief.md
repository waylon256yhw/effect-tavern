# 调用 brief：三档条目、composer 的 `/`、删 pin、窗口规则（2026-11-08，#149 第一份）

#149 指出 lore / lookup 想窄了：按需条目全按"一次性揭秘"处理。核对代码后，问题是一个错位加一个缺口。

- **错位**：去重与折叠读的是"这条路径被告知过什么"（故事状态），该读的是"叙事者窗口里现在有什么"（上下文状态）。`derived.ts` `readableOn` 的 `seen = deliveredOn(path)` 按整条路径去重，读过一次终身不再可读；`history.ts` `compress` 把区间内送出的 lore 全文拼进 Summary，永久常驻。两者自洽，但只对揭秘成立，对设定、文风、few-shot 不成立。recall 行已经用对了一半（只在节点折叠后可读，理由正是"尾部原文里还有它"），lore 没用同一条规则。
- **缺口**：没有"只许玩家调用"的条目。几千到上万 token 的特化文风指南、场景描写 few-shot，平时不该进 lookup 索引、不该常驻，只在玩家点名的那一轮用一次（对照 Claude Code 里 `disable-model-invocation` 的 skill，用 slash 调出）。`Input.pin` 不是它：pin 是"这一轮必须讲出"，由 check 验收，是揭秘语义，对文风指南没有意义；而且 pin 只能在 Inspector 与读数页上点，composer 碰不到。

下面的结论已在 11-08 三轮（Claude / Gemini 对照）定下，不再重开。后两份 brief（lookup 结构化循环加 ledger；record 改操作列表）不在这里。

## 定稿

### 1. 一个概念：条目调用，三档

卡的 lore、扩展包条目、recall 行是同一种条目。每条声明谁能调用它，档位决定生命周期，与谁调用无关：

| 档位 | 谁调用 | 进 lookup 索引 | 进 `/` 菜单 | 生命周期 |
|---|---|---|---|---|
| **常驻**（`always`） | 不需调用 | 否 | 否 | 每轮进叙事请求 |
| **自取**（`auto`，默认） | 模型（lookup）或玩家（`/`） | 是 | 是（窗口里没有时） | 送达记在 `Turn.read`，留在窗口，窗口内去重，折叠时卸载，之后可再取 |
| **手动**（`manual`） | 只有玩家（`/`） | 否 | 是 | 只这一轮：像 note，记在输入上，不进 `deliveredIn`，后续回合从不渲染 |

- 玩家用 `/` 调一个**自取**条目，与 lookup 选中它完全一样：进 `Turn.read`，留在窗口。调一个**手动**条目，只进这一轮的 narrate 请求。
- 被锁的不可调用：卡 lore 的 `unlock` 还没打开的层不出现在 `/` 菜单里，`/` 不能拆剧情锁。手动条目按它当前已解锁的层送出（多层时各层正文依次）。
- 卡面的揭秘机制不动：`LoreEntry.offer` 开窗、director 的 must / may、check 对 director 的 must 验收、`fired`，原样保留。删的只是玩家的 pin。

### 2. Schema

- `LoreEntry`（`card.ts`）加 `invoke?: "auto" | "manual"`，缺省 `auto`。卡 lore 没有 `always`：常驻就是 fiction fragment，且常驻会绕过 `unlock`。
- `PackEntry`（`layer.ts`）加 `invoke?: "always" | "auto" | "manual"`，缺省 `auto`（今天的行为）。扩展包是玩家自己的资产，可编辑，档位就在扩展包编辑器里改；不另设按卡的覆盖（同一个包在两张卡上要不同档位，等真遇到再说）。`locked()` 照常放行这个字段。
- recall 行只有自取档，不加字段。
- `Input`（`journal.ts`）：删 `pin`，加 `invoke?: readonly string[]`（条目 id，`<row>/<entry>` 或卡 lore id 或 recall 的 `<product>@<node>#<i>`），swipe / reword / edit 沿用 base 的 input，自然沿用它。server 的输入 Schema（`session.ts` 末尾）同步。
- 存量节点：节点是 `JSON.parse` 出来的（`data.ts` `parse`），旧的 `input.pin` 留在 JSON 里无人读，不迁移。它当时送出的层已在 `read` / `fired` 里，重放不依赖 pin。

### 3. 窗口规则：故事状态看整条路径，上下文状态看窗口

窗口 = 未折叠的尾部，`path.slice(foldOf(path))`，与叙事者这一轮的 transcript 是同一个边界。

- **看整条路径，不变**：`unlock` 的 floor、已送出的最深层（`deepest`，决定 `current`）、`lore.<id>.since` / `.shown`、`offer` 开窗、`fired`。第 2 轮揭开的层到第 50 轮仍是揭开的，一次性事件不会因折叠重新触发。
- **改看窗口**：去重。一个层"已读"当且仅当它在窗口内某一轮的 `read` 里。lookup 索引、`/` 菜单、`deliver` 的过滤、gate 补低层时的过滤，都只减去窗口里已有的。
- 因此 `lore.ts` 的查询把今天的一个 `ds` 拆成两个参数：`told`（整条路径，算 `current` 与 `offers`）与 `held`（窗口，算 `unread` / `readable` / `read`）。`derived.ts` `gated` 的 counters 与 floor 照旧吃整条路径。
- **折叠只留 notes**：`history.ts` `compress` 的 facts 只取 `notesOf(t)`，不再拼 `deliveredIn(t)` 的文本；`makeSummaries` 的 `loreText` 参数随之删掉。条目滑出窗口就从上下文卸载，回到可读，lookup 或 `/` 可以把它（所有已解锁的层）再取回来。揭秘不丢：揭秘写在正文里，record 把它记进 notes。
- 窗口内的送达照旧由 `narratorHistory` 在那一轮的位置渲染，不变。

### 4. 两个候选集，从一个函数出

`readableOn` 今天同时是 lookup 的枚举、`Node.readable`、pin 的来源。拆成按档位过滤的同一个函数（`derived.ts`），两个出口：

- **lookup 索引**：自取档里，有已解锁且窗口里没有的层的条目，加已折叠且窗口里没有的 recall 行；减去本轮玩家已 `/` 调用的。手动档永不进入。
- **`/` 菜单（`Node.invocable`，取代 `Node.readable`）**：上面的自取集，加所有已解锁的手动条目。手动条目不留在窗口，所以上一轮刚调过，这一轮仍在菜单里。每项带 `id`、`hook`、`invoke`，客户端画钩子与档位。卡 lore 的正文不随它下发（与今天的 hook 一样）。

### 5. 送达的落点

- **玩家调用的自取条目**：与 lookup 选中的一起进 `deliver`，落进 `Turn.read`，作为 gate 的 `before`，与今天 lookup 送达的路径完全相同。
- **玩家调用的手动条目**：不进 `deliver`、不进 `read`、不进 `deliveredIn`，不计入 `since` / `shown`，不推进 `deepest`（它只送已解锁的层，本来也推不动）。只在本轮 narrate 请求里出现：`request.ts` narrate 分支在 `told` 之后，每条一个 system 消息。重放、swipe、reword 从 `input.invoke` 现取正文；条目被删了就是空，与 `text` 今天对已卸载扩展包返回 `""` 一致，不发空消息。
- **常驻扩展包条目**：每轮进 narrate 请求的头部，在 fiction 之后、hat 头之前（`request.ts` 的 `zone(...)` 内），与 fragment 同在缓存前缀里，按挂载顺序。它们不进 lookup 索引、不进 `/` 菜单、不进 `read`。
- 其他阶段（lookup、decide、direct、check、polish、record）都不读手动与常驻条目的正文。

### 6. 删 pin

runtime：`journal.ts` `Input.pin`；`session.ts` 的 `pinned` / `forced` / `mustIds` 与 "nothing to pin"（改成：`invoke` 里有不可调用的 id 就拒绝这一轮，同一个失败路径；`session.ts:411` 的空输入守卫同步认 `input.invoke?.length`）；`derived.ts` `gate` 的 `forced` 参数（`open` 只剩窗口开的）；`brief.must` 只剩 director 给的，check 照旧验收它。注释里所有提到 pin 的句子按新语义改写或删掉。

server：输入 Schema 跟随。

client：`store.ts` 的 `pin` atom、`turn.ts` 发送时附 pin、`reading.ts` 的 `Kept.pin`、`readings.tsx` 的钉住键、`inspector.tsx` 的 armed 标记、`record.ts` 账本的 `pin` 行，以及对应 locale 键。读数页与 Inspector 不再有任何调用入口；Inspector 显示一轮的 `input.invoke`，替换今天显示 pin 的那一行。

### 7. composer：`/` 菜单是同一个菜单的第三组

composer 已有一个菜单：`+` 键，或空输入框上按 `/`，打开 snippets（"故事里"与"对叙事者"两组，`composer.tsx`），"没有命令语法"。调用不另开一个菜单，也不引入 `/name` 语法：它是这个菜单的**第三组，条目**，项是 `Node.invocable`（最后一轮的投影），名字是条目的 id，钩子作提示，手动档带一枚档位标记。组间照旧一条线，chrome 不加词。

- 选中一项：输入框上方出现一枚 chip（与格式键同一行的位置规则：手在框里或框里有字时在），再点 chip 撤掉。可以选多项。菜单里已选的项不再列出。
- 发送时 chip 随这一轮的 `input.invoke` 走，然后清空；与 note 同一个生命周期（`turn.ts` 今天给 pin 的那两行就是位置）。切故事时随 `reading.ts` 的 Kept 记录保存与恢复，取代 `Kept.pin`。
- 输入框是空的、只有 chip 也能发送（`composer.tsx` `filled` 今天认 text 或 note，加上 chip）：玩家只调一份文风指南、让叙事者接着写，是合法的一轮（此时 `text` 与 `note` 皆空，`request.ts` 不可发出 `content: ""` 的空 user 消息，否则 Anthropic / Gemini 会报 400）。
- 那一轮的气泡显示它调了什么：输入块下方一行 chip，只读。
- 条目多时这一组会长。菜单本来能滚动；按名字过滤等真有一张几百条目的卡再加，与第二份 brief 的大目录问题一起看。

### 8. 写作页与扩展包编辑器

扩展包条目的编辑行加档位选择（常驻 / 自取 / 手动，三个词进 locale）。卡 lore 的档位是作者写的，玩家层只读，不在写作页上改；卡 lore 正文本来就不下发（`layer.ts` `shown`），这一条不变。

## 接缝与不变式

1. **两个参数，一个边界**：`lore.ts` 的每个查询只用 `told`（整条路径）算深度，只用 `held`（窗口）算已读。混用一处，就是 #149 的错位换个地方再出现。
2. **窗口由 `foldOf` 定**，与叙事者 transcript、recall 可读性是同一个数，不另算。
3. **手动条目不留痕**：不在 `read`、不在 counters、不在 Summary、不在后续任何请求里。它只在 `input.invoke` 上。
4. **lookup 的问题顺手修**（不等第二份 brief）：`request.ts` lookup 分支今天漏了 `noteOf(c.input)`，玩家在 note 里点名的设定 lookup 看不见；补上。lookup 加 ledger 留给第二份 brief。

## 验证

runtime 测试（`test/*.ts`，`vp run verify`）至少覆盖：

- 条目在第 k 轮送达；窗口越过第 k 轮后，它回到 lookup 索引与 `/` 菜单，`deepest` 与 `shown` 不变，`offer` 不会因此重开已揭开的层。
- 折叠后的 Summary 不含任何 lore 文本。
- 手动条目：本轮 narrate 请求里有它，`read` 里没有；下一轮的 narrate 请求里没有它；下一轮 `/` 菜单里仍有它；它从不出现在 lookup 的索引里。
- 常驻扩展包条目：每轮在 narrate 头部，不在 lookup 索引，不在 `/` 菜单。
- `input.invoke` 含一个锁住的层或不存在的 id：这一轮被拒。
- swipe / reword 沿用 `invoke`。
- 旧节点带 `input.pin` 能解码、重放。

客户端由玩家验收。

## 顺序

一个 PR：runtime（§1–§6、接缝 4）加 server Schema 加客户端（§7–§8）加 GLOSSARY（`钉住` 条删，`readable` 改为 `invocable`，加 `调用` 与三档）。第二份 brief（lookup 结构化循环加 ledger）在这个 PR 合入后写，它读的索引就是 §4 的那一个。
