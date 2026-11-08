# lookup brief：结构化循环、ledger、大目录检索（2026-11-08，#149 第二份）

第一份（`docs/invoke-brief.md`，#151，f7cc454）定了三档条目与窗口规则，lookup 读的索引就是那份 brief §4 的自取集。这一份只改 lookup 怎么从这个索引里挑。第三份（record 改操作列表）不在这里。

核对合入后的代码，lookup 有三处缺陷：

- **看不到前文**。请求里只有框架、`Index:` 一行、note 与玩家这一句（`request.ts` lookup 分支）。"去那里看看""问他那件事"这类指代，它没有任何依据去判断。
- **只能挑一次**。一次 `{ read: id[] }` 就结束（`session.ts` `Lookup`）。读完"西栅街面"、发现里面提到"福记面馆"、再去读它，这种多跳做不到。
- **大目录撑爆枚举**。所有可读条目的 `id=hook` 每轮全量列出，id 全进 `Schema.Literals`。诡秘这种几百条目的卡，既费 token、稀释注意力，也会撞上各家 structured output 的枚举上限。

下面的结论在 11-08（Claude / Gemini 对照，第二轮）定下：**lookup 仍是 narrate 之前的独立阶段，不给 narrate 挂工具**（gate 与 direct 吃 lookup 的送达，reword 复用 `base.read`，hat 尾区引导正文）；**不用 provider 的 tool calling**，lookup 改成与 decide 同构的结构化循环，每家 provider 照常可用，provider 层一行不改。不再重开。

## 定稿

### 1. 循环：每一步一次 `object()`，第一步能短路

每一步模型回答一个结构化对象：

```
{ read: id[], more: boolean, search?: string }
```

- `read`：这一步要读的条目，`Schema.Literals` 只含这一步剩余未读的可读 id（第一步的 `Index:` 消息保持不变以守住前缀缓存，后续步只缩减 schema 的枚举）。
- `more`：要不要看到刚读到的正文、再挑一次。意思是"我挑的这些可能指向别的条目"。
- `search`：只在目录模式下（§3）出现在 schema 里；一个检索词，空串表示不检索。

循环规则，与 decide 的 `again` 同一个形状：

1. 第一步问 `lookup`（现有 ask id，不改名，玩家已有的覆盖照常生效）。
2. 没有新进展（`!(more && 本步新读了条目) && !search?.trim()`），循环结束。大多数回合在这里停，一次调用，与今天的成本相同；若模型返回 `read: [], more: true` 且无检索，也直接结束，避免空转。
3. 否则进下一步，问新的 ask `lookup.again`：给出这一轮已读条目的正文和检索结果，问还要读什么。下一步的回答规则相同。
4. 剩余未读 id 空了，或到上限 `lookupCap = 3` 步，循环结束。`ponytail:` 注释写明这个常数与升级路径（按卡配置，等真有卡需要）。
5. 各步的 `read` 合并去重，作为这一轮的送达，走 `deliver`，落进 `Turn.read`，与今天完全相同。gate 的 `before`、direct、narrate、reword 都不感知循环。

`lookup.again` 的英文措辞写进 `layer.ts` 的 `words`，与 `decide.again` 同一个口吻：给定已读内容，挑还缺的，或什么都不挑；没有把握宁可不挑。

### 2. 请求：先 ledger，再索引，后续步骤只在末尾追加

`request.ts` 的 lookup 分支改成：

```
frame
ledger                       ← 新增：与 decide / direct 同一个 here.ledger()
sys(question + Index: …)     ← 第一步的问题与索引
note、thought、said           ← 与今天相同（note 已在 #151 补上）
── 第二步起追加 ──
sys(Read: <本轮已读条目的正文，尚无已读时写 ->)
sys(Found: <检索命中 id=hook，无命中时写 ->)   ← 只在上一跳有非空 search 时
sys(lookup.again 的问题)
```

后续步骤只在末尾追加，第一步的整个请求是它们的前缀，同一轮内多步共享缓存。`Read:` 在第二步起始终发出（哪怕第一步只做了检索、`read: []`，也发 `Read: -`，保证 `test/script.ts` 稳定识别后续步；同理有检索但零命中时发 `Found: -`，让模型知道检索落空）。

**ledger 补一列 `read`**：`history.ts` `ledger` 的每一行今天只有 `fired`，补上那一轮 `read` 去重后的 id（`[...new Set(t.read.map((d) => d.id))]`，多层条目同轮送达会有多条 `Disclosure`；格式 `read a,b; fired c`）。lookup 由此知道窗口里已经有什么、最近几轮在谈什么；director 读同一份 ledger，也受益。ledger 尾部本来每轮重写，不影响缓存。`view.ts` 的工作台预览请求同步补 `ledger: []`。

### 3. 大目录：超过预算，索引只列名字，靠检索取钩子

索引有两种模式，由这一轮自取集的大小决定：

| 模式 | 条件 | `Index:` 列什么 | schema |
|---|---|---|---|
| **列表** | 全部 `id=hook` 的 token 估算（`tokens.ts`）≤ `indexBudget` | `id=hook`，与今天相同 | `{ read, more }` |
| **目录** | 超过 | 只列 id | `{ read, more, search }` |

- 这是 Claude Code 处理延迟加载工具的同一个做法：先只列名字，用检索取回完整说明，再按名字选用。
- `indexBudget` 先定 2000 token，`ponytail:` 注释写明。两种模式下 `read` 的枚举都是全部可读 id。各家 structured output 的枚举上限按"几百"量级算，id 本身短；真撞到上限时，第一步只放检索、不放 `read`，这条留作升级路径写在注释里。
- **检索在代码里做，不调模型**：`derived.ts` 的 `at(path)` 加 `search(q, k)`，在自取集里按检索词匹配每个条目的钩子与已解锁、窗口里没有的正文，取前 `k = 8` 个，返回 `id=hook`。匹配先用最简单的：检索词按空白切开，每个词做子串匹配，按命中词数排序，同分按索引顺序。中文条目名一般是整词子串，可以直接命中。`ponytail:` 注释写明没有分词与向量，升级路径是 BM25 或 embedding 插件（`memory-table-reading.md` §6 第 5 条已有这个位置）。那一条写的是"无多跳"，针对的是模型写的记忆；作者写的 lore 会互相指涉（总纲指向子条目），多跳是为它加的，两者不矛盾。
- 检索结果只进下一步的请求，不进 `Turn`。节点只存 `read`，与今天相同。

### 4. 不变的

- 没有输入的回合（只有 chip，或开场）照旧跳过 lookup（`hasInput`）。
- 玩家这一轮 `/` 调用的条目照旧从索引里减掉。手动档照旧不进索引。
- swipe（从 lookup 重跑）重跑整个循环；reword、edit 复用 `base.read`，不跑循环。
- lookup 照旧走 `modelFor("lookup")`，可以路由到轻模型；各步都走同一个。

### 5. 客户端：Inspector

一轮可能有多个 lookup 调用，与 decide 一样按序号显示（`inspector.tsx` 已有 `nth`）。每个调用的药丸显示这一步的 `read`，有检索时加一枚 `search: <词>`。没有新词进 locale：`read:` / `search:` 与今天的 `read:` 同一个写法。

### 6. 测试脚手架

`test/script.ts` 的 `readStage` 解析 lookup 请求，`defaultAnswer` 回 `{ read: [] }`，`server/src/dev.ts` 的 fake 模型用它。补上 `more: false`，目录模式下补 `search: ""`；`readStage` 认出第二步（有 `Read:` 行）与目录模式（索引里没有 `=`）。

## 接缝与不变式

1. **前缀不变**：第 k 步的请求以第 1 步的请求为前缀。顺序写错，同一轮内多步的缓存就失效。
2. **一个落点**：循环怎么跑，送达都只有 `Turn.read` 一个落点。下游阶段不知道循环存在。
3. **短路是默认**：第一步 `more: false` 且没有检索，就只有一次调用。测试里断言这一点，防止以后改措辞时把每轮变成两次调用。
4. **检索只在自取集里**：手动档、被锁的层、窗口里已有的，都不会被检索命中。它与 lookup 索引是同一个集合，不另算。

## 验证

runtime 测试（`vp run verify`）至少覆盖：

- 第一步 `more: false`：一次 lookup 调用，`read` 与今天相同。
- 第一步 `more: true`：第二步的请求含第一步所读条目的正文，并以第一步的请求为前缀；第二步读到的条目也进 `Turn.read`。
- 到 `lookupCap` 步时结束；索引读空时提前结束。
- lookup 请求里有 ledger，ledger 行带 `read`。
- 目录模式：`Index:` 只有 id，schema 里有 `search`；检索命中的条目以 `id=hook` 出现在下一步，被锁的层、手动档、窗口里已有的不会命中。
- 列表模式下 schema 里没有 `search`。
- swipe 重跑循环；reword 不调 lookup。

客户端由玩家验收。

## 顺序

一个 PR：runtime（§1–§4、ledger 列）、测试脚手架（§6）、Inspector（§5）、GLOSSARY（lookup 条：循环、目录模式、检索）。合入后写第三份 brief（record 改操作列表：`set` / `upsert` / `delete`，notes 必填）。
