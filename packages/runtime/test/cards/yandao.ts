// 盐道: the world-card template, hand-written. No protagonist and no player in the fiction: the frame has no `persona`,
// the card fills `pov` itself (so the player's global pov slot yields), and `input` defaults to the aside channel: what
// the player types is direction to the narrator, never a line of anyone in the story. Nothing else is special: the
// fiction is a town instead of a person, one world-state field moved by a readout, one layered lore entry whose second
// layer opens on an event the readout emits, the director on so MUST/MAY plays.
import { decodeCard, type Card } from "../../src/card.ts"

export const load = (): Card =>
  decodeCard({
    id: "yandao",
    input: "aside",
    frame: [
      {
        id: "pov",
        text: "全知第三人称叙述，镜头可以在任何人物之间切换。故事里没有玩家角色；输入是作者给叙述者的指示，不是任何人物的话，不要把它写进故事。",
      },
      { id: "style", text: "白描，少用形容词；对白短，带方言味；每一幕有一个具体的物件或动作收尾。" },
    ],
    fiction: [
      {
        id: "town",
        text: "盐津镇：川南山里的盐运码头。一条石板街沿河，北头是县衙，南头是盐帮的货栈。镇上三百户，靠盐吃饭。",
      },
      {
        id: "sides",
        text: "官府：县令周秉文，五十出头，外省人，到任两年，想在盐税上做出政绩。差役头子叫老柯，本地人，两边都认识。\n盐帮：帮主沈大娘，六十岁，丈夫死后掌舵十五年，驼队和船都是她的。她的侄子沈二是跑外的，脾气急。",
      },
      {
        id: "now",
        text: "眼下：县衙新立了盐道的查验卡，驼队进镇要开包验货。盐帮认为这是要抽第二道税，已经两趟驼队绕道不进镇。",
      },
      {
        id: "tense",
        text: "街面上已经见过血，店铺半数关门，镇民晚上不出门。",
        when: { path: "局势", op: "gte", value: 6 },
      },
    ],
    greetings: [],
    rules: {
      fields: [{ path: "局势", type: "int", min: 0, max: 10, initial: 2 }],
      actions: [],
      readouts: [
        {
          id: "tension",
          text: "这一幕之后，官府与盐帮之间的局势",
          options: [
            { id: "eased", text: "缓和了", do: [{ path: "局势", add: -2 }] },
            { id: "same", text: "没有变化", do: [] },
            { id: "worse", text: "更紧张了", do: [{ path: "局势", add: 2 }] },
            { id: "broke", text: "动了手或见了血", do: [{ path: "局势", add: 4 }, { event: "冲突:升级" }] },
          ],
        },
      ],
    },
    lore: [
      {
        id: "yandao",
        layers: [
          "盐道之争已经半年，镇上人都说县令是外省人不懂盐。",
          "周秉文私下收过沈大娘的银子，查验卡是做给省里巡按看的戏；沈大娘知道，沈二不知道。",
        ],
        unlock: { all: [] },
        offer: { event: "冲突:升级" },
      },
    ],
    guard: [],
    director: true,
  })

// Direction, not dialogue: each line is what a novelist tells the narrator to write next.
export const turns = [
  "开场。黄昏，沈二带的驼队进镇，街上的人在看。先写镇子的样子，不要急着出事。",
  "老柯带两个差役上来查驼队，沈二不让开包。写到动手为止，写两三个旁观者的反应。",
  "切到县衙里。周秉文听到消息，写他和老柯的对话。",
  "第二天早上，镇上的传言。收尾时留一个悬念。",
]
