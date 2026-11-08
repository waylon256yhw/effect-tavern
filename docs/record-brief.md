# record brief：稀疏操作列表、部分更新与行删除、notes 必填（2026-11-08，#149 第三份）

前两份（`docs/invoke-brief.md` #151、`docs/lookup-brief.md` #152）落定了三档调用与 lookup 结构化循环。这一份收口 #149 的第三块（同时覆盖 #150 Gap 1.2）：把 `record` 阶段对跨轮产物的全量必填改造成稀疏操作列表（`set` / `upsert` / `delete`），保留单次 `object()` 调用、`notes` 必填与读数回答。

核对合入后的代码，现在的 `record` 有三处缺陷：

- **全量必填逼出无意义重抄**。`session.ts` 的 `record` 把所有开启的产物放进同一个 `Schema.Struct`，每项都是必填顶层字段。`scene` 这类 `record` 产物哪怕地点与在场人物毫无变化，每轮也得整块重写；15 个键的 `record` 改 1 个键要重抄其余 14 个键；8 列的 `table` 改某个人物的一列要把其余 7 列重抄一遍。
- **不支持部分键/列更新，也不支持删行**。`product.ts` 的 `fold` 对 `record` 产物做整块替换（`vs.filter(v => v !== undefined).at(-1)`），对按 key 合并的 `table` 做整行替换（`map.set(k, x)`），且没有删除语义——人物退场、物品耗尽后无法从表里移除（#150 Gap 1.2）。
- **只开 `recall` 的产物在 `record` 里看不见现值**。`derived.ts` 的 `known(path)` 只把 `p.feed && p.on` 放进 `Current:`。像 `wuxia.yaml` 的 `people`（`recall: "name"`、未设 `feed: true`）在 `record` 的请求里完全不出现，模型不知道表里已有哪些 key、各列当前是什么值，无从判断该更新谁、删谁还是不动。

下面的结论在 11-08（Claude / Gemini 对照，第二轮）定下：**`record` 仍是一次 `object()` 结构化输出，不改成工具循环，provider 层不改**；**`notes` 是折叠摘要（`Summary:`）、`Known:` 与 `Ledger:` 的唯一来源，保持顶层必填，不进"偏好不写"**；**跨轮产物（状态类与其余上下文类）走稀疏操作列表 `ops`，没变化就返回 `ops: []`**。不再重开。

## 定稿

### 1. `record` 的输出形状：顶层必填 + 稀疏 `ops`

`session.ts` 的 `record` 按产物职责把 `asked` 分成两路，拼成一次 `object()` 的 schema：

```
{
  notes?: string,                 // notes 在 asked 中时必填；纯过场回合允许空串 ""
  <theaterId>?: Shape,            // asked 中的小剧场产物（!p.feed && !p.recall，如打开的 options 或 demand 索取的产物），必填
  ops?: Op[],                     // asked 中存在跨轮产物（(p.feed || p.recall) && p.id !== "notes"）时出现；无变化回 []
  answers?: Record<qid, option>,  // 有激活读数时必填，与今天相同
}
```

- **为什么小剧场产物留在顶层**：小剧场（`!p.feed && !p.recall`，见 `docs/theater-brief.md`）不跨轮累积，默认关闭；只有玩家显式打开（如 `options`）或点 `demand` 索取时才进 `asked`，问了就必须回答，不存在"沿用上一轮"。
- **为什么没有跨轮产物时不放 `ops`**：像 `chat` / `yandao` / `ri` 默认只开 `notes`，此时不生成空的 `ops` 字段（也避免空的 `Schema.Union`）。

`Op` 是对本次 `asked` 中所有跨轮产物生成的 `Schema.Union`，按产物的 `shape` 与 `fold` 分三种分支：

| 产物类型 | 允许的操作 | Schema 形状 |
|---|---|---|
| **按 key 合并的 `table`**（`fold: { key }`） | `upsert`、`delete` | `{ op: "upsert", product: Literal(id), row: Struct({ [key]: colSchema, ...其余列: Schema.optionalKey(colSchema) }) }` 与 `{ op: "delete", product: Literal(id), key: colSchema(keyCol) }` |
| **`record` 形状**（`shape.kind === "record"`） | `set` | `{ op: "set", product: Literal(id), value: PartialRecordStruct }`（顶层每个键及嵌套 `record` 的键均用 `Schema.optionalKey`） |
| **`text`、`list` 或无 key 的 `table`** | `set` | `{ op: "set", product: Literal(id), value: shapeSchema(p.shape) }` |

- `Schema.optionalKey` 在 `packages/provider` 现有的 JSON Schema 归一化下，对 Anthropic、Gemini、OpenAI-compatible 均编译为 `required` 仅含必填键（如 `row` 只要求主键列，`record` 的 `value` 不强制任何未变键），无需改动 `packages/provider`。

### 2. 问法与请求：`record` 读 `Current:` 含 `recall` 产物，新增 `record.ops`

1. **`record` 看见 `recall` 产物的当前值**：`derived.ts` 的 `known(path, recall?: boolean)` 在 `recall = true` 时把 `(p.feed || p.recall) && p.on` 的产物都折入 `Current:`（折叠后为空串的产物不输出）。`narrate` 照旧调 `here.known()`（只喂 `feed`），`record`（含 `view.ts` 的 record 预览）调 `here.known(true)`，让模型看清现有的表行与键后再决定 `upsert` / `delete` 或不写。
2. **新增 ask `record.ops`**：在 `layer.ts` 的 `words` 增加一条默认问法 `record.ops`，只在本次 `record` 含有跨轮产物（即 schema 含 `ops`）时拼进 `request.ts` `record` 分支的 `a.asks` 末尾：说明 `ops` 只写本幕发生变化或新增的产物，未变的产物、未变的键与列一律省略，本幕无状态产物变化时 `ops` 留空 `[]`。
3. **`notes` 问法微调**：`layer.ts` `notes` 的默认说明保留原有正文前缀（守住既有测试断言），末尾补一句：纯过场、无事发生或商定的回合可留空串。

### 3. 节点存储与路径折叠（`product.ts`、`derived.ts`）

节点 `Turn.products` 只存本轮实际产出的增量，未触碰的跨轮产物在 `Turn.products` 上为 `undefined`（不再存空数组 `people: []` 或重抄上一轮的 `scene`）：

1. **`record` 产物按字段深度合并**：
   - `session.ts` 把同一轮 `ops` 中针对同一 `record` 产物的 `set` 合并（忽略值为 `undefined` 的键，套用 `cap`）；若没有任何有效键则不写入 `Turn.products[id]`。
   - `product.ts` 的 `fold` 对 `record` 产物不再取最后一个节点整块替换，而是沿路径依次合并各节点的已定义键（若某键本身是嵌套 `record`，同样按键合并）。
   - `product.ts` 的 `cap` 与 `render` 对 `record` 跳过值为 `undefined` 的键，使单轮节点上的部分 `record` 补丁可以独立渲染。
2. **按 key 合并的 `table` 支持部分列 `upsert` 与 `$delete` 墓碑**：
   - 在 `Turn.products[id]` 中，本轮对该表的操作存为行数组（与既有节点的存储形状兼容，同一 key 在本轮多次出现时按顺序合并为一条）：
     - `upsert` 存为去掉 `undefined` 列后的行对象 `{ [key]: k, ...changedCols }`；
     - `delete` 存为墓碑对象 `{ [key]: k, $delete: true }`。
   - `product.ts` 的 `items(p, vs)` 在 `f = { key }` 时沿路径维护 `Map`：
     - 遇到 `row.$delete === true` 时 `map.delete(k)`；
     - 遇到普通行时，与 `map.get(k)` 已有的 `item` 合并（`prev ? { ...prev.item, ...row } : row`，保持 schema 列顺序），位置 `at` 与下标 `i` 更新为最新一次写入该行的节点与下标（首次出现的排序顺序由 `Map` 在首次插入时自然保持；删后再同名插入则排在后面）。
   - **召回行读取合并后的完整行**：`derived.ts` 的 `textIn(path, d)` 在解析 `<product>@<node>#<index>` 时，对按 key 合并的表取 `path.slice(0, nodeIdx + 1)` 折叠后的该行（即合入祖先节点已填列的完整行），避免某轮只改了一列后，后续 `lookup` 召回该行时丢失早期列。

### 4. 客户端与回退链（`record.ts`、`readings.tsx`、`inspector.tsx`）

1. **标题与场景名沿路径回退（`client/src/record.ts`、`readings.tsx`）**：
   - 现在 `scene` 只在变化时写入节点，中间回合的 `node.turn.products.scene` 可能是 `undefined`，或者只更新了 `present` 没写 `place`。
   - `client/src/record.ts` 的 `heading(ref, node, log?)`（以及 `readings.tsx` 的 `sceneOf`）在读取 `scene.place` 时，若传入 `log` 则沿 `L.chain(log, node.id)` 从近到远找最后一个非空的 `place`；单节点无 `log` 时退回读本节点并回退到 `notes` / 输入 / 正文首行。
2. **本轮账本抽屉与读数页（`readings.tsx`）**：
   - `Shaped` 渲染 `record` 时只画值不为 `undefined` 的键：读数页（`World`）传的是 `fold` 后的完整对象，所有已设键都在；单轮的记录药丸（`TurnRecord`）传的是 `turn.products[p.id]`，自然只展示本轮改动的键。
   - `Shaped` 渲染 `table` 时，若某行带 `$delete: true`（只会出现在单轮 `TurnRecord` 或 Inspector 的本轮产物里；`World` 的折叠结果里已被移除），以删除样式（如删除线或 `−` 标记主键）显示该行在本轮被移除。
3. **Inspector 的 `record` 摘要（`inspector.tsx`）**：
   - `record` 调用行的摘要从 `out()` 里汇总非空的顶层产物与 `ops` 触及的产物（`ops: []` 时不显示多余的 `ops (0)`）。

### 5. 测试脚手架（`test/script.ts`、`server/src/dev.ts`）

`test/script.ts` 的 `readStage` 与 `defaultAnswer` 适配新 schema：

- `readStage` 从 `o.responseFormat.schema`（或请求行）区分哪些 `asked` 产物在顶层、哪些走 `ops`。
- `defaultAnswer(doc, canned)` 为顶层产物填 `canned[id]`，并把 `canned` 中属于 `ops` 的产物自动转成 `ops` 数组（keyed `table` 的行数组转为 `upsert` 操作，其余非空值转为 `set` 操作，空数组不发操作）。`test/loop.ts` 与 `dev.ts` 的 fake 模型继续用同一套 `canned` 驱动。

## 接缝与不变式

1. **单次调用不变**：`record` 始终是一次 `object()` 调用，不引入多跳循环，不改 `packages/provider`。
2. **`notes` 永不进 `ops`**：`notes` 只要开启就是顶层必填字符串；折叠摘要、`Known:` 与 `Ledger:` 不受"偏好不写"影响。
3. **未改即 `undefined`**：本轮 `ops` 未触碰的跨轮产物不在 `Turn.products` 留空壳（不写 `[]` 或 `{}`），单轮账本药丸只反映本轮真正发生的变化。
4. **旧节点零迁移**：已有存档节点上的 `t.products.scene`（完整对象）与 `t.products.people`（完整行数组）本来就是新折叠规则的合法输入（全量是部分更新的特例），无需迁移数据库。

## 验证

runtime 测试（`vp run verify`）至少覆盖：

- **`ops: []` 空操作回合**：当 `ops` 返回 `[]` 时，`Turn.products` 只含 `notes`（及打开的顶层小剧场），上一轮的 `scene` 与 `people` 在 ` fold ` 和 `Current:` 中原样保留。
- **`record` 产物部分键更新**：第 1 轮设置 `scene: { place: "茶亭", present: [...] }`，第 2 轮只发 `{ op: "set", product: "scene", value: { place: "竹林" } }`，折叠后 `place` 为 `"竹林"` 且 `present` 保留第 1 轮的值；第 2 轮节点自身的 `products.scene` 只有 `{ place: "竹林" }`。
- **按 key 合并的 `table` 部分列 `upsert` 与 `delete`**：
  - 第 1 轮插入 `{ name: "Li", note: "N1" }`；
  - 第 2 轮部分更新 `{ op: "upsert", product: "people", row: { name: "Li", note: "N2" } }`（或多列中只改一列），折叠后保留其余列并更新改动的列；后续回合折叠进入索引后，`lookup` 召回该行时拿到合并后的完整行文本；
  - 删除操作 `{ op: "delete", product: "people", key: "Li" }` 后，折叠结果与 `recallEntries` 中不再有 `"Li"`。
- **`record` 请求的 `Current:` 含 `recall` 产物**：`people`（仅 `recall: "name"`）在第 1 轮写入后，第 2 轮 `record` 请求的 `Current:` 含有 `people=...`，而 `narrate` 请求的 `Current:` 仍只含 `feed: true` 的 `scene`。
- **只有 `notes` 开启时不生成 `ops`**：关掉 `scene` / `people`（或纯 `chat` 卡只开 `notes`）时，`record` 的 schema 不含 `ops` 字段。

客户端由玩家验收。

## 顺序

一个 PR：runtime（`product.ts`、`derived.ts`、`session.ts`、`request.ts`、`layer.ts`、`view.ts`）、客户端（`record.ts`、`readings.tsx`、`inspector.tsx`）、测试脚手架与回归测试（`test/script.ts`、`test/product.ts`、`test/loop.ts`、`test/view.ts`）、GLOSSARY（`record` 与 `product` 条：稀疏操作 `set` / `upsert` / `delete`、部分合并与删除）。
