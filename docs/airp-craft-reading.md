# 读表记录：英文社区的 AIRP 语文，提示词技巧里"表达力"是什么

2026-10-19。前几份记录读的都是代码侧：卡的格式、预设的装配、记忆插件的结构。这一份读的是语文侧：英文社区关于怎么写卡、怎么写一轮、怎么让模型写得好的经验谈。目的不是找机制，是把"表达力"这个词从抽象里拉出来，看它在真正玩的人手里是什么东西。

读了这些（按时代）：Ali:Chat v1.5（AliCat，2023）、MinimALIstic / Ali:Chat Lite（kingbri，2023）、BONER'S BOT BUILDING TIPS（2023-12）、NG 的 Pointers for Creating Character Cards（2023 起，持续更新）、How 2 Claude（2024-07 起，2026-06 仍在改）、NicholasCS's Big-Ass Botmaking Guide（JanitorAI，2024）、Statuo's Guide（2024 起，2026-06-19 加了"语气"一节）、pixi's practical modern botmaking、Advanced card writing tricks、Sukino's Findings 与 Sukino's Guides（2025 到 2026）、Geechan 的 Anti-Impersonation Guide（2025-03，2026-04 改）、LoreWeaver 的三篇指南（2026-10-03）、Arcanum RPGs 的评测方法与 2026 H2 基准，以及 NovelAI 的 Special Symbols 页。另读了 Sukino 那份示范对局的截图（Lucille x Marisha，Mistral Small 2501）。

## 0. 站高一点

### 0.1 参照：这个品类的语文往哪走了

把指南按年份排开，看到的是和 memU 同一条轨迹，只是对象从记忆系统换成了提示词本身。

| 时期 | 格式 | 指令 | 范例与开场 |
|---|---|---|---|
| 2023，Pygmalion 6B / 13B、Turbo 4K | W++ 加引号、PList 方括号、`<START>` 分隔符、dinkus、"大写字母多花 token"、把 PList 搬进 Author's Note 省 token | 要正向、要短、放在底部 | Ali:Chat：用对话范例承载性格 |
| 2024，Claude 3 / GPT-4、8k 到 200k | pixi："plaintext，格式的意义是省 token，对现在的模型不再相关"；NG："不要用 W++，直接写模型需要知道的" | Nicholas："生成型系统提示词，建议放零条"；How2Claude："模板是 one-shot，比指令稳得多" | How2Claude 整章讲 in-context learning：开场和前几条消息决定整局 |
| 2025 到 2026，Sukino、Geechan、LoreWeaver | 格式问题消失，Sukino 说 W++"没有可取之处"，PList 加 Ali:Chat 是"大上下文之前的产物" | Geechan 的通用预设约 950 token，"尽量少的负向提示"；Statuo 2026-06：指令的语气本身会漂进输出 | LoreWeaver：开场"长度就是回复长度"，角色"一个欲望、一个矛盾、一种声音" |

三年里死掉的是格式和微优化，缩小的是指令，长大的是两样东西：**范例**（对话、开场、玩家自己的一轮）和**对上下文如何被模型读的理解**。社区自己把这件事说清楚了：Sukino 的"每一个词都是角色本身，上下文就是角色"，How2Claude 的"ICL 像重力，足够强的模式会压过任何指令、任何预填、甚至大部分训练"。语文从"怎么排版"走到了"怎么写"。

Arcanum 2026 H2 的基准给了另一面的参照：28 个平台，七个轴，Player Agency 这一轴的定义有一半是"叙事者不替你的角色开口"；Memory & Continuity 与 Longevity 两轴至今没有满分（最高 4.25 和 4）。社区把"替玩家说话"当头号问题，评测方把"长程"当未解问题，与我们这几个月的判断一致。

### 0.2 第一堆：对宿主与时代的兼容补丁

这些建议的存在理由是 ST 的结构和当年模型的弱，去掉那两样就不需要：

- **位置学。** "底部权重最高"、"Author's Note 深度 4"、"把 PList 放进 Character's Note 做 double reinforcement"、"越狱放最后所以最强"、Boner 的"最重要的放最后"。全是在手工做装配，因为请求形状不可编程。我们的 Fragment 装配和阶段绑定把位置变成了 harness 的事，作者不需要知道深度。
- **省 token。** kingbri 把 1300 token 压到 599，"showing a disgusted face"改"looking disgusted"，动作用小写；Ali:Chat 的"永久 token 与临时 token"记账表（1600 上下文减 1000 角色减 180 生成等于 420 聊天记忆）。1M 上下文之后这些是博物馆。但其中一条原则活下来了，见 0.5。
- **格式作为分隔。** `<START>`、dinkus、XML 标签"因为 ST 把字段拼成一个字串，你无法控制边界，lorebook 条目会贴在你角色后面把她变成 catholic and pure of heart"。消息是字串、字段无边界的后果。typed parts 之后不存在。
- **正则与扩展。** 用正则把旧消息里的 stat box 剥掉只留最新一条、NoAss 用停止串截断替玩家说话的生成、`{{idle_duration}}`、`[](#'invisible')` 藏秘密、CoT 藏进 HTML 注释。全是在正文里塞结构再用正则抠出来。
- **弱模型专用。** "7B 到 13B 分不清 user 和 char 时先检查引号和星号"、"13B 以下需要在每个范例里每两三句提一次角色名"、"把回复长度压到 180 到 250 token 能减少替玩家说话"。

### 0.3 第二堆：不着调的

- **越狱 cosplay。** 填表的提示词里都有，这里也一样：Statuo 拒绝写（"写下来公司就知道怎么堵"），Nicholas 说"JLLM 不需要被允许写性与暴力"，How2Claude 把 prefill 的原理讲清楚之后说它"会被 3.5 的 system prompt 压过"。这一堆社区自己在退。
- **怪物提示词。** Nicholas 那张缩到 50% 才截得下的系统提示词截图；"描述 char 闻到什么时看到什么"、"永远记住所有对话"、"上下文满了之后也要记得一切"，他的分类是"什么都不做或者让 bot 更差"。How2Claude 直接有一节叫 Placebo。
- **负向指令。** 每一份指南都讲，每一份卡都还在写"Don't speak for {{user}}"。Nicholas 坦白他留着那句只是为了评论区不骂他。
- **把标点当语义。** W++ 的每个词加引号，Nicholas："已经证明引号几乎不帮模型分辨信息"。
- **让模型算。** Statuo："模型小学数学不及格"；How2Claude："时间按分钟推进对 stat tracker 来说非常难，需要 CoT 而且也不可靠"；Nicholas："8.2 英寸和 8.7 英寸模型分不清，旁边写个'平均'"。

### 0.4 第三堆：我们已经有形态的

| 社区的做法 | 我们 |
|---|---|
| Author's Note / Chat Memory：手写的当前事实，注入到深度 N | 阶段的 asks 与玩家层 fragment；当前事实是 record 的 `Current:` 行 |
| Director's Notes `[[...]]`、OOC `((OOC: ...))`、"continue" | aside 通道；"继续"是 aside 的一条 snippet |
| 永久 token 对临时 token：不变的进定义，会变的进开场和聊天 | 头区对转录稿；开场是节点，自带效果 |
| stat tracker：回复末尾的 `<stats>` 模板，只留最新一份，正则剥旧的 | 产物与读数：record 阶段按形状提取，挂在节点上，折叠按路径 |
| 分块摘要、"什么时候按 summarize"、手工改摘要 | 折叠作为派生视图，按块缓存 |
| CoT 先规划再写、"CoT 把聊天记录挤出注意力区" | decide 是独立阶段，不占叙事者的上下文 |
| 隐形文字藏凶手、`{{random}}` 在开场掷一次、`{{pick}}` 定终生、lorebook 概率触发事件 | 隐藏层的 lore、种子与代码掌握的随机、Cond 门 |
| 多开场 | greetings |
| LoreWeaver 的"方向放哪"表：OOC 一次性、session notes 每轮、style rules 全局、lore card 按名、Loom thread 按条件 | aside、玩家层 asks、卡 fragment、lore、Cond 门的事件，一一对应 |
| LoreWeaver 的输入模式：Do（第一人称动作转叙述）、Say（加引号）、Custom（原样）、OOC（叙事者以自己的声音答、故事等着） | act 的文字、心声标记、aside。2026-10 的产品独立走到了"范围作为输入模式"这一形，是昨天那个问题的一张外部参照 |

### 0.5 分堆之后剩下什么：语文本身

拿掉三堆，剩下的东西没有一件是机制。它们是写法，也就是这次要找的"表达力"。我把它们收成四条。

**一、上下文就是角色，模式强于指令。** 这是整个材料的地基，三年里从各处独立说出来：Sukino 把做卡比作"一面镜子，照出你放在它前面的东西，而不是给演员一份剧本去研究"；How2Claude 说 ICL "足够强就不可能抗拒"，开场里有一个 claudeism 模型就乐意复读，开场里替玩家做了一个动作模型就乐意一直替你做；Boner 说"写一个满嘴脏话的 weeb，就别用临床的口吻写他"；NG 发现"用你想要的声音写定义，角色就会用那个声音说话"，一张全大写写的卡角色就全大写回话。表达力在这里的意思很具体：**你写下的文字，能多大程度决定接下来被续写出来的文字。** 它的杠杆是用词、省略和重复，不是命令。

**二、玩家的一轮是什么。** 这是材料里最丰的一块，也是最接近"感性"的一块。Statuo 的"Trash in, Trash out"对照：

> The Dragon moves a few feet. I raise my shield.

对

> Blood dripped from the dragons open maw... "Get behind my shield!" Statuo shouts, desperation fueling his magic as he pours everything he has into weaving mana around him. Gods, it may not be enough.

Sukino 的示范对局更能说明问题。她的玩家 Marisha 每一轮写法都很朴素："My writing here was completely utilitarian. My only focus is on making each line amount to something."第一轮没做什么动作，只是暗示了几件事：不喜欢仆人在旁边看、独处时态度不一样、对 Lucille 耐心、尊重她的失明但不把她当易碎品，结尾留一个动作钩子。然后看模型怎么接：模型写了"书堆在窗边的架子上"，下一轮 Lucille 自己说"裙子可能在窗边那堆书下面，我本来想读书，然后裙子吸引了我"；模型写了"她的手指在长凳上不安地敲"，之后变成"今天我想去音乐室练琴，我在练一首新曲子"。玩家给的是材料，模型把材料长成了细节，细节又回头成了玩家下一轮的材料。她管这叫 snowball。

LoreWeaver 把一轮的写法收成七个模式，每个"只写尝试，不写结果"：attempt（我把撬棍塞进舱门底下用力压，听着守卫的动静）、a line with a purpose（"你认识他。"我把照片放在我们之间。我想看她退缩）、the pointed question、the time skip、the scene cut、the slow-down、the handoff（我坐在窗边看广场慢慢挤满人）。两条习惯：用名字（"I ask Marta"而不是"I ask her"，名字是 lore 和记忆找到场景的钥匙）；把意图写进场景。Statuo 的"结尾给 bot 一件事做"、"打断用破折号然后指名谁打断"、"**THE NEXT DAY** 加粗换场"、"把话塞进模型嘴里再按继续"，是同一件事的更多手法。

Statuo 2026 年的长文把这一条往下挖到了根：好的角色扮演者的四条（角色属于这个世界、有不立刻离开的理由、既反应也主动、给别人接入的入口），然后说"你的 persona 不是那个输入框里的东西，是你自己对这个角色是谁、他在世界里什么位置的理解"，roleplay 停滞的原因是"你没有问够自己角色的问题，在依赖别的角色替你抬"。他举的例子：Vellere 要进 Nightriver 档案库，新手会"当然给，我想让她喜欢我"，他的做法是直接拒绝，然后要筹码，于是两个人有了冲突，无论选哪条路故事都在继续。这是表达力的另一面：**不是写得长，是写出来的东西里有多少可以被接着长的东西。**

**三、作者写的是什么。** LoreWeaver 的"一个欲望、一个矛盾、一种声音"；"写行为不写形容词"的对照表（"Brave and loyal"对"先进门，事后从不提；哪怕留下是蠢的也不丢下任何人"，"Mysterious"对"用问你的过去来回答关于她过去的问题"）；pixi 的"每个性格特征都想一想为什么，解释来源给模型判断情境的依据"；Nicholas 的"要么大胆要么别写"（"{{char}} likes dancing"对"{{char}} is the goddamn dancing queen"）和"Personality Trait: Elaborate"格式（"Anxious: 胸口几乎一直发紧"）；Boner 和 Sukino 的选词毒性（"dominant"一出现角色就变成五十度灰，"assertive"没有这个效果；提到"不感兴趣性"也把性放进了上下文）；NG 的"不要信息倾倒，Harry Potter 的卡定义只有一句 `{{char}}`"；pixi 的"关系状态写成开放的，'对 {{user}} 有好感'在每个阶段都成立，'昨天刚开始约会'很快就过期"；开场"不是角色故事的开头，是一场早在你之前就开始的、没有尽头的 roleplay 里的某一条消息"（Nicholas），"长度就是回复的长度，视角就是回复的视角，留下的空白就是玩家的位置"（LoreWeaver）。

这一条和昨天的担心直接相关。Blushly 那篇 W++ 回顾里有一句："过度工程：标签加得太多，角色变成清单而不是人。"LoreWeaver 同样说"紧凑格式省 token，但丢掉了把一个人连在一起的那些关联"。作者的表达力在散文里，在"为什么"、在选词、在省略，这些东西任何字段都装不下，字段只会让作者去填空。

**四、替玩家说话，是感知范围的问题，社区已经知道指令治不了它。** 这是全部材料里出现最多的一个主题。每份指南都讲，结论一致：开场里不写玩家的动作和话（连"你坐在椅子上"这种被动动作也算，Nicholas）；范例里不写玩家的话；玩家自己写得够多、结尾留事给对方做；出现了立刻编辑掉，否则"每一条后续回复都建立在它的影响上"；"Don't"没用。Geechan 把它分成两种：narrative impersonation（叙述者描述玩家走进走廊看见什么，很多人接受）和 user impersonation（替玩家说话、做决定，没人接受）。How2Claude 补了反面：不要强迫症式地禁绝，"完全禁止模型碰你的角色，回复会变 2D"，而且"失败与收回机制（动作越界时纠正你）本来就要碰 {{user}}"，真正惹人烦的只是"替你做大的决定"。

用我们的词说：叙事者对玩家这个角色的感知范围是"看得见、不能替他说、不能替他决定"。这不是一条指令，是矩阵里叙事者那一行的内容，也是今天上午那张矩阵应该能写出来的一行。

## 1. 对"表达力"的回答

上午说过：全包靠穷举做不到，能全包的办法是底层是散文。读完这些材料，这句话可以说得更硬一点。

**表达力就是散文被原样读到的程度。** 社区三年的经验浓缩起来是：模型续写的是它看到的文字的模式；你想要什么，就让它看到那种文字。于是表达力有三个来源，全在散文里：玩家一轮里的材料密度和钩子，作者定义里的声音和省略，开场里的范例。没有一个来源是字段。ST 的表达力不足也不是缺字段，是字段在和散文打架：怪物提示词把注意力区填满，负向指令把概念引进来，格式把人拆成清单。

所以 schema 要"全包"的真正含义，是**它对散文透明**：玩家写的一段到叙事者那里一个字不改；作者的 fragment 是散文；harness 自己插进去的每一句话，都按同一套语文规矩写。最后这条是这份材料给我们的唯一新要求，而且是对我们自己的：asks 的文字是模型看到的范例，正向、短、没有 claudeism、不出现"roleplay"这种词（那条 539 赞的 reddit 教程说这个词本身会降质量）、能用模板就不用指令（结构化输出就是 one-shot 模板，这是它比提示词稳的原因，How2Claude 说得很清楚）。README 里"不给模型压力提示"已经是这一条的一半。

玩家输入那一侧，材料给了一份完整的"玩家的动作有哪些"清单：尝试、有目的的一句话、追问、时间跳、切场、放慢、交棒、导演注、OOC、继续、打断、塞话再续。逐个归：导演注和 OOC 是 aside，继续是 aside 的 snippet，塞话再续是 edit，其余全是正文。没有一种需要新的范围。LoreWeaver 做成产品的四个模式（Do / Say / Custom / OOC）也落在同一套里。昨天那个"全包"的担心，至少在玩家动作这一维，材料给了答案：清单是闭的，底是散文。

## 2. 对协议的要求

没有新增字段或阶段。三件事：

1. **harness 自己的文字要过语文审。** `asks` 的默认 fragment（decide.first、decide.again、narrate.correction、record.notes、input.thought 等）按 0.5 第一条的规矩重读一遍：正向、范例式、不带 claudeism、不出现"roleplay"。这是检查，不是改协议。
2. **叙事者对玩家的感知范围，作为矩阵的一行写出来。** "看得见玩家，不替他说，不替他决定"。它的机械后果落在 check：验证正文里没有玩家的台词和决定（Geechan 的 user impersonation），描述玩家所见所感不算（narrative impersonation），纠错重写处理命中。这是今天上午矩阵的检验之一，先写进矩阵，是否进 check 再定。
3. **LoreWeaver 的输入模式记为外部参照。** Do / Say / Custom / OOC 与我们的正文 / 心声 / aside 同构，2026-10 的产品独立走到了这里。它把 Say 单独做成一个模式只是为了加引号，是便利不是范围，和我们"标记只是客户端便利"的倾向一致。

## 3. 零散的句子

留几句原话，它们是这份材料的质感：

- "What's creativity to us is hallucination to them."（Sukino）
- "Your character is a lie too! There is no character!"（Sukino）
- "It's like gravity - subtle at first, but eventually overpowers all other forces."（How2Claude，说 ICL）
- "Think of the First Message not as the beginning of a character's story, but as a single message in an endless roleplay that started before you even used the bot."（Nicholas）
- "Write the attempt, and let the story decide."（LoreWeaver）
- "The storyteller can only answer what it is shown. Show it the scene you want, and it will meet you there."（LoreWeaver）
- "Your persona is as much a character as the bot is."（Statuo）
- "A platform that holds together beautifully as long as you follow the story it wanted to tell has not solved longevity; it has solved obedience."（Arcanum）
