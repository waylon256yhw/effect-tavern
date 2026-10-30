# 读表记录：每轮摘要怎么写，生态里的三份（#82）

2026-10-30。为 #82 读的三份材料：柏宝书（`docs/baibai-book-reading.md` 读过结构，这次只读摘要正文的措辞）、mirrorange/advanced-preset（花瓣预设，commit 当日浅克隆）、liao05/summary-collector（1.0.0，2026-10-26 首发）。问题是一个：record 阶段的默认产物 `notes` 在纯聊天卡（伴星，Opus）上退化成逐段批注，六七条一轮，正文的一半篇幅，折叠后压不住。

读法同前：先说各是什么，分三堆，再看它们在"每轮摘要"这件事上有没有收敛，最后落到协议。

## 0. 三份各是什么

**summary-collector** 是收集器，不是摘要器。每楼的摘要由玩家的预设写（正文里带 `<dream_summary>` 标签），插件提取、延后三楼写进角色的附加世界书（延后窗口就是 swipe 宽限期），满 30 条做一次大总结写进另一条世界书条目，只增不清。全部提示词只有大总结那一句：

> 每行一条，格式严格为"时间 - 事情"，保持时间顺序，合并重复与琐碎细节，保留关键剧情节点与因果关系。

每楼摘要的措辞它不管。

**advanced-preset（花瓣）** 分三层：`synopsis` 每段一张卡（time 区间、location、event 十词以内的标题、summary 一句），`recap` 整篇叙事体总结（只在玩家 `@Freesia 总结` 时写，与旧 recap 合并后整体替换，"全知第三人称、按时间顺序、只记可观察的行为与后果、不写动机、不用列表"），`memory` 标题→内容的偏好条目（只在玩家明说时 replace / delete）。synopsis 的提示词极短，约束全在形状里：一个标题，一个 summary 字符串，"brief, objective description of what happened"。它有三个用处：玩家看的卡片、最近三楼正文后附带、省 token 时替换旧楼（`[时间 · 地点] 事件: 概要`）。指南里有一句与 #82 同病："记忆与总结要谨慎，明确告诉模型只在被要求时更新，否则它可能每一轮都在改记忆"。

**柏宝书** 72 KB 的摘要提示词里，和摘要正文有关的是四节约 50 行：【摘要成文顺序】【压缩保真】【关键短语保真】【关系线保留】；其余是物品、NPC、场景、计划的准入规则，上次读表已归第二堆。这四节是三份里唯一真正写了"怎么取舍"的文字。

## 1. 三堆

**兼容补丁。** 标签提取、世界书当存储、延后楼数、正则按深度折叠、"JSON 字符串里的英文双引号必须转义"（柏宝书的输出铁律）。最后这条值得记：伴星节点 #1 那条被拆成三截（`"依瑞丝承认自己说"` / `"我懂"` / `" 时……"`），是模型在 JSON 字符串数组里遇到 `"我懂"` 的同一个病。强制 schema 挡不住它，因为 `["……说", "我懂", "时……"]` 是合法的数组；一个字符串字段里同样的错就不合法，结构上切不出多余元素。

**方向错误。** 72 KB 的台账规则、NVWA 身份段，上次已判，这次不重复。

**我们已有。** record 是回合的一个阶段，不是正文尾部的标签；折叠是代码拼接，按区间缓存；feed 产物回喂 Known。

## 2. 三份收敛在同一点

**每轮摘要是一个单位，不是一个列表。** summary-collector 一楼一行；花瓣 synopsis 一个 summary 字符串加一个标题；柏宝书 `summary` 是一个单段字符串，并明说"不加标题或列表"，recap 层也"不用列表"。我们的 `notes` 是无上限 `list`，列表本身就在说"填满它"。这和 lookup 那次是同一个教训（索引加数组读作 fill it），#82 第一条问的"是否仍应是无上限 list"，三份给的是同一个答案。

**篇幅不写数字。** 花瓣是 brief，柏宝书是"篇幅是上限而非填满任务"。写 50–100 字进提示词会被当成目标填满。上限放在形状里：一个 text 字段，措辞里说"一两句"。

**时间与地点是独立字段。** 花瓣放在 synopsis 的两个字段里，summary-collector 是单独的时间标签，柏宝书是 JSON 里的 time 与 location。都不塞进摘要那句话。柏宝书读表时已把 `time` 记为默认产物候选（text、feed、默认关），维持。

**取舍的判据。** 柏宝书的几条，每条对得上伴星那轮的症状：

- "先选事件，再写句子：以目标、阻碍、转折、结果及仍有效的约束为取舍依据，不是按原文每句各缩短一次。" 伴星的六七条就是"每句各缩短一次"。
- "留下动作不等于留下信息：对每个细节问，删除后是否改变事件结果、行动选择、有效限制或关系边界？不改变则整项删。" 一个可执行的测试。
- "同一事件只写一次关键结果"；"单段自然叙述"；"允许必要的主谓与连接词，避免'进行了/表现出/体现了'等空泛记录句；不要删虚词堆分号写成电报，不扩写成小说"。
- 【关系线保留】是给纯聊天卡的那一条：关系靠一串可观察的小互动推进，"这类具体动作与关键台词，即使不推动主线、不改变任何档案字段，也必须保留其具体语义，同类互动可以合并"；但"不得把互动改写成'感情升温'等心理结论，只记可见事实"。它的例子"她把椅子挪近，手搭在他手边"是一个小动作，要求保留。

## 3. 对 #82 的结论（已落地）

**形状。** `notes` 从 `list` 改为 `text`，每轮一段一两句。折叠本来就是字符串拼接（`Summary:` 把各轮 notes 用空格连起来，Known 用分号连），一轮一句正是它要的输入。`notesOf` 把一段包成单元素数组，读 notes 的三处（Known 行、摘要、账本）不动；#82 之前写下的库每轮是一个数组，照样读。list 产物里路径上已有条目由代码丢弃的那条守卫留给卡声明的 list 产物。

**视角与重心**（issue 第 2 条）。不按谁说得多定重心，按"下一幕站在什么上面"定。玩家独白一段、角色只是接话，就写"玩家说了 X，依瑞丝以 Y 回应"，一句两边都有；分量跟结果走，不跟字数走。闲聊幕的骨架是一轮交谈的往返（一方提起或倾诉了什么，另一方如何回应），不是"一句台词或一个动作"：让模型去找台词或动作，它会摘一句俏皮话或一个扣手机，正是节点 #2 的病。

**景物与小动作。** 雁道卡单独覆盖 `product.notes` 是因为默认问法没禁景物（`docs/provider-reading.md` §10）；伴星是把扣手机、翻滚当成了事实。默认问法把两类一并挡住，但禁的不是小动作本身，是什么都不改变的动作：伴星恰恰是纯聊天卡，关系线靠小动作推进，一刀切的禁令和"只留后面的戏站得住的东西"会打架，所以并成一条判据（扣手机不过关，手搭在手边过关）。

**措辞**（harness 默认，`session.ts` `defaultProducts`；卡与玩家按 `product.notes` 覆盖）：

> Notes are the record of this scene, one or two plain sentences in the third person: what changed or was settled (what was done, decided, promised, refused or learned), or, where the scene was talk, what was raised or confided and how the other side met it. Keep only what later scenes will stand on; merge the rest or leave it out, and never summarize the prose paragraph by paragraph. Name characters by name, and refer to an unnamed player character as 玩家 (never 你 or 我). Never repeat Known, never record scenery or a gesture nothing later turns on, never judge feelings, never comment on the writing.

旧版的 "by their names in the frame" 删掉：#83 之后人名在 `fiction` 里，而 record 的文档是 frame 加审稿帽，不读 fiction，模型只能从正文里认名字。

伴星那轮按这个写出来大致是 issue 里那一句：「玩家提起高中回忆与毕业后独处时对时间流逝的感悟，依瑞丝以自己昼夜不分的处境回应并宽慰。」

**不进协议的。** 柏宝书"先从材料复制关键短语，再压缩周边叙述"是台账字段的保真规则，对一句话的场景摘要用不上；花瓣的 recap 层是我们的折叠，由代码拼，不另开模型调用（`docs/memory-table-reading.md` 已定：LLM 写的大总结是 `compress` 的一个可选实现，不是新机制）。
