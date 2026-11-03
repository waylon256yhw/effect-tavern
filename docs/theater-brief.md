# 小剧场 brief：产物三分（状态 / 上下文 / 小剧场）、先减后加（2026-11-03，立在 #76 之上；#62 并入）

两张截图暴露的是一个错位：一轮正文下的记录药丸打开的"第 N 轮"弹层，和读数页右半边的"记录"，像素级相同；弹层里先一条数值变化，再一段 📖 的摘要，读的人说不清这段摘要是给谁的。查过代码：两处画的是同一个投影（`record.ts` `record()`）在最后一个节点上，差别只是药丸对任一轮有效、读数页只对最后一轮；📖 那段是默认产物 `notes`，折叠的来源，模型的上下文，不是玩家的记录。"记录"一个词下面压着三种东西。

#76（10-25）对过 runtime 的两条路（`<<aside>>` 附言与 `demand` 索取是一个东西）：它的 **§二（runtime）一字未过时**，附言仍由 `journal.ts` `splitAside` 只按第一个 `<<aside>>` 行切、`session.ts` 流式原样滚出（`ponytail:`）、`history.ts` 丢弃、`Product` 没有 `stage`，§二 的每一条照旧是工单。它的 **§三与客户端各条已过期**：写它时还没有回合下的药丸（#101）、读数页（shell brief 2）、Writing 页的产物开关与 `notes` 的 text 形状（#82）。**#62**（aside part 流式露出、落地后消失）是 §二 落地后自然消失的子问题，关到 #76 里。

这份 brief 定四件事与两处接缝，第二步"减法"只按它做，不开新议题。下面的结论都已定（11-03 三轮对齐），不再重开。

## 定稿

### 1. 三分：一个产物属于哪一类，由它已有的声明决定

`Product` 已经带着答案：`feed` / `recall` 说模型读不读它，`fold` 说它沿路径怎么累积。三类按这两根轴切出来，代码里一个纯函数，不按 id 列举，不加新字段：

| 类（代码词） | 判据 | 是什么 | 画在哪 |
|---|---|---|---|
| **world**（状态） | `feed \|\| recall`，且 fold 是 `latest` 或 `{ key }` | 一个"现在是什么"的值，被替换或按 key 合并；与 `rules.fields` 同类 | 折叠值进**读数页**（与 Status 并列）；本轮的新值 / 新行进**药丸** |
| **context**（上下文） | `feed \|\| recall`，且 fold 是 `append` | 只增不减的编年，模型记着的东西 | 只在 **Inspector** |
| **theater**（小剧场） | `!feed && !recall` | 模型从不回读，只为玩家存在 | **内联在那一轮正文下**，入口在那一轮的动作行 |

`notes`（context 的唯一现成实例）与 `options`（有自己的容器）是 harness 自己的两个，`options` 单独豁免，`notes` 不豁免：它靠 `fold: "append"` 落进 context（见接缝 1）。一句话版本：**读数页画世界现在是什么，药丸画这一轮改了什么，Inspector 画模型记得什么，小剧场画只给玩家看的。**

theater 有意取"否定"判据：卡作者声明了一张表却不回喂，他声明的就是一个给玩家看的视图，得到的也是。#76 §二 的 `stage: "narrate" | "record"` 与此正交，它说谁写这块，不说谁读；未来的 `view` 提示（日记、帖子、对话）只决定一块小剧场怎么画，从不决定它是不是小剧场。

**账本（ledger）** 从此是一个视图的名字，不是产物的类：这一轮改了什么，即字段变化、检定、送出的线索、钉住，加 world 产物本轮的新值或新行。药丸打开的就是它。

### 2. 空回合：不画药丸，不画圆点

药丸打开账本；账本里没有东西，就没有可打开的，药丸不画。出现本身即"有结算"，右上角的圆点随之删除。`marked()` 去掉 notes 与产物里非 world 的项之后，是画不画药丸的唯一判据。伴星这样没有规则的卡一枚也不出现，竹林里只聊天的一轮也不出现。

### 3. 读数页只剩"现在"

右半边"记录"整列删除（`.moved`、`TurnRecord` 与它脚上的 `Demand`）。左半边保留钉住与 Status，再加 world 产物的折叠值（竹林的 `scene` 当前场景与在场人物、`people` 累积的人物表），同一个 `Shaped` 画。页上没有东西（没有字段、没有 lore、没有 world 产物）时，右上角与手机顶条的读数键**不画**，不是 disabled：disabled 说"有这页，只是现在不行"，而这张卡没有这页。

### 4. 小剧场的入口与落点

按钮离开两个弹层的脚部，进每一轮正文下的动作行（App.tsx `Section` 的 footer），在药丸的位置旁，仍是它今天这个带名字的菜单（`Menu`，项是产物的 label）；不进 Swipe / Reword / Edit 那组，那三个重跑叙事者，这个不开回合。菜单项 = 该轮还没有答案的 theater 产物（`demandable` 加一层 theater 过滤）；没有项，按钮不画。

每一块小剧场落在**那一轮正文与动作行之间**，不论是随回合来的（`on: true`）还是索取来的（`demand`）；§二 落地后 narrate 阶段的块流式长在同一个位置。块上一枚键：骰子，意思是这一块再来一次，即对同一 id 再 `demand` 一次，按 `history.ts` 现有的"同 id 原位替换"落下。显隐随动作行的规则（桌面上过去的轮次悬停才出，最后一轮常显，触屏常显）。`options` 的容器不动，仍只在最后一轮。

### 5. 关系与 Writing 页

Writing 页"开关与记录"的产物列表按三类分组，组名用界面词（状态 / 摘要 / 小剧场），开关逻辑不变。GLOSSARY 同步：产物条加三类与 `stage`，`notes / inner / options` 条改写，附言条退役为定界符的名字，§三关系与 §四"不采用"各改一行。

## 接缝

1. **`notes` 明写 `fold: "append"`**（`session.ts` `defaultProducts`）。#82 把它从 list 改成 text 后没写 fold，而 `product.ts` `items` 的默认是"list 追加、其余最新"：今天的 notes 按 latest 折叠是错的（Known 行在 `derived.ts` 走 `notesOf` 直接拼，没过产物折叠，所以没出事），明写之后它按 §1 的判据自然落进 context，前端不出现 `id === "notes"` 的特例。
2. **`GET /card` 透传 `fold` / `feed` / `recall`**：`session.ts` `cardView` 的 `products` 今天只留 `{ id, label, shape, on }`；补这三个字段，`store.ts` `CardView["products"]` 同步。三类的判定（`kindOf(p)`）放 `record.ts`，`record()`、`marked()`、`readings.tsx`、`writing.tsx` 都读它。读数页的折叠值直接调 runtime `product.ts` 的 `fold` 过阅读线上各节点的 `turn.products`，它只读 `id` / `shape.kind` / `fold`，参数类型收窄成 `Pick<Product, ...>` 即可，不另写一份折叠。
3. **空的 list / table 不是变化**：`record()` 今天对 `value !== undefined` 就画一行，竹林的 `people` 默认开着、没新人物的一轮答 `[]`，会画出"新人物：无"并点亮药丸。`[]`（table 同）按"本轮无此项"处理，不进账本、不触发药丸。`latest` 类的 record 形状照旧按有无值算。
4. **`demandable` 过滤 theater**；索取回来的 world 产物（理论上可索取，今天菜单里也列着）不再出现在小剧场菜单里，要就从账本看。
5. **Inspector 不动**：它已按节点画每次 record 调用的产物，notes 在那里本来就可读。`export.ts` 的附言斜体照旧，等第三步改成按产物导出。
6. **检查**：`packages/client/test/record.ts` 加 `kindOf` 的三类断言与"空表不进账本"一条；`vp check`、`vp run verify`、`x18n check`（Writing 页三个组名是新 key）。

## 顺序

1. **本文与 GLOSSARY**（本轮）。
2. **减法 PR**（纯客户端加接缝 1–2 两行 runtime，一个 PR）：药丸按 `marked` 出现、圆点删；`notes` 离开账本；读数页删右列、加 world 折叠值、无内容时键不画；小剧场按钮进动作行、索取回来的 theater 产物内联画在正文下（今天只有 record 阶段的，整块落地）；Writing 页分组。runtime 的流式切分一个字不碰。
3. **#76 §二**：`Product.stage`，narrate 阶段的产物按 `<<aside>> <id>` 切块、多块、流式落进 §4 的位置，附言 part 删除，#62 随之关闭。
4. **#76 §三**：先读两三张带小剧场玩法的角色卡定 `view` 词表，再做玩家自己声明的 theater 表与按 `view` 的画法；#69 里 demand 的入口并进来。
