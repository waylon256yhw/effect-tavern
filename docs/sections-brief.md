# sections brief：条目内的按需下钻（2026-11-10，#160 §二）

#160 §一（检索排序）是另一份 PR，先合；这一份建立在它之上。

## 是什么

一条 lore 今天只有 `layers` 一个维度，它是**剧情授权轴**：`unlock` / `offer` 决定走到第几层，已解锁的层是累积的事实（第二层可能改写第一层），所以必须一起送达，`loreResource` 把它们拼成一份。

百科型大卡暴露出第二个维度，**阅读经济轴**：同一实体有两档公开信息，出场就要的当下面貌（几百字）与只在追问往事时才要的档案（几千字）。两者都没有剧情锁，体积与使用频率悬殊。把档案写成 `layers[1]` 没有效果（两层同时解锁，每次读全量送达：NIKKE 样本 168 条两层条目，35 万字里 15.4 万是这种"第二层"）；让作者横向拆成两条顶层条目，丢了实体内聚，也占检索的 8 个名额。

**节（section）**：条目下的附加正文，不改写主面貌，只补充；可以留在后面不读。层是纵向的揭示，节是横向的附录。两者正交。

不从层正文里的 Markdown 标题隐式推导节：那会悄悄改变已有卡的行为。

## 定稿

### 1. Schema（`card.ts` `LoreEntry`）

```ts
sections: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })))
```

- 首句即 hook，与层同一条规矩（`lore.ts` `hook`）。
- 节没有 `unlock` / `offer` / policy 字段。要靠剧情才知道的过去是层，不是节。
- 条目可见（当前层 ≥ 1）节才存在；条目的 `unlock` 条件（如样本的 `era`）自然管住它的节。
- 代称展开与层同一条规矩：任一节有未填的洞，整条条目不发。
- 包的词条不带节（单层、无条件，照旧）。

### 2. 资源（`context.ts`）

- 一节是一个 `Resource`，`resourceId = card:<条目>#<节>`，自己的 `revision`、自己的送达快照。`title` 是节的 hook，`text` 是节的正文。
- policy 继承条目的 `access.model` 与 `residency`；`activation` 恒为 `on_demand`（`always` 只送主面貌）；`access.player` 恒为 `false`（不进玩家目录，不可 `/` 调用，玩家调用条目只送主面貌）。
- `disclosures: []`：读节不产生揭示，不动 `lore.<id>.since / shown`。
- 主面貌的资源与今天逐字节相同：**`DeliverySnapshot.text` 里不写节的目录**。快照冻结进日志、同时发给 lookup 与 narrate；narrate 没有工具，目录对它是噪声，而且会让 `revision` 依赖当时的驻留状态。节的目录只出现在 lookup 一侧（§3）。
- `loreResource` 仍返回主面貌；节由旁边的一个函数从同一条目产出，`resourcesOn`（`derived.ts`）与 `view.ts` 一起调用。`session.ts` gate 那一处只冻结主面貌，不变。

### 3. lookup 怎么看到节

三个入口，都只在 lookup 这一侧，文字格式由代码定：

1. **`read_context` 的返回值**：读主面貌时，结果附带该条目尚未驻留的节 `sections: [{ resourceId, title }]`。
2. **lookup 请求里已驻留条目的附注**：`session.ts` 给 lookup 的 `context`（`latest([...resident, ...deliveries]).map(deliveryText)`）里，条目还有未驻留的节时，在那一条后面追加一行列出它们的 `resourceId` 与 hook。只改 lookup 的 `ask`，narrate 读到的 `deliveryText` 不变。于是第 2 回合玩家问起往事时，lookup 不用检索就能直接读 `card:x#bio`。
3. **`search_context`**：检索单元仍是条目，8 个名额是 8 个实体。
   - 条目的正文分 = 主面貌 + 它未驻留的节的正文一起算（§一的三级排序不变，锚点仍是条目的 `resourceId` + `title`）。
   - **可检索的条件改为：主面貌未驻留，或还有未驻留的节**。今天的 `readable()` 按主面貌的 revision 过滤，主面貌驻留后整条条目搜不到，节就成了死路。
   - 结果带 `sections: [{ resourceId, title }]`（未驻留的节，命中检索词的排前）；主面貌已驻留时带 `resident: true`，模型只需读节。

`read_context(["card:x#bio"])`：条目可见即可读。主面貌既未驻留、本次也没点名时，一并送达主面貌（节是主面貌的补充，不单独上场）；它算在每次 8 个的上限里。

`lookup.readable().length` 是这一轮要不要跑 lookup 的开关，按上面的新条件算。

### 4. lint、view、技能

- lint（error）：节 id 在条目内唯一；节 id 与条目 id 不含 `#`（它是条目与节之间的连字，与 `/` 之于包同理）；节正文非空。一条最多 8 节（有界，超过是该拆实体了）。现有按层扫正文的规则（`lint.ts` 里遍历 `e.layers` 的两处）把节的正文一并扫。
- `card view`：lore 列表的条目行写出节数与各节 hook；`card view` 预览的 lookup 文档与会话同形。
- `skills/card-author/SKILL.md`：加一段何时用层、何时用节、何时拆条目。层 = 要靠剧情才知道；节 = 一直公开、但只在追问时才需要的纵深；另起条目 = 另一个实体。
- GLOSSARY 的 lore 词条已补"节"。

### 5. 不做

- 节上的条件、节的嵌套、节的 `always`。等真有卡需要。
- 客户端：卡过线时节随条目走（只是可选字段），工坊的编辑界面不在这一份里。
- `ponytail:` 写明：检索结果列出条目全部未驻留的节，上限由 lint 的 8 节保证；节多到要分页时再改。

## 测试

`test/lookup.ts`（或 `contextLookup` 现有的测试文件）用合成 fixture：

- 读主面貌：快照正文不含节的任何文字；工具返回值列出节。
- 读节：只送达节；主面貌未驻留时一并送达。
- 主面貌已驻留、节未驻留：条目仍可检索，结果 `resident: true` 且列出节；节也驻留后条目不再出现，`readable()` 为空。
- 只在节正文里出现的词能搜到条目，排在锚点命中之后。
- 条目被 `unlock` 锁住时，它的节不可读、不可搜。
- 会话级：第 1 轮读主面貌，第 2 轮的 lookup 请求里有节的附注，narrate 请求里没有。

实现后在本地 `wip/nikke-sample` 分支把 `build-nikke.ts` 的 `-背景` 从假的第二层改成节，量一次 `拉毗` 的首次送达字数（那个分支不进 main）。
