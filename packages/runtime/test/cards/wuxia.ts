// The self-check card: a wuxia duel with layered lore, a readout and one guard line. `chat` is the same card with
// everything structured switched off: no actions, lore or director, so a turn is narrate + record only (README §2).
import type { Card } from "../../src/card.ts"
import { decodeFragments as frags, type Player } from "../../src/fragment.ts"

export const player: Player = {
  global: frags([{ id: "language", text: "使用自然、舒展的现代中文写作。" }]),
  forCard: {},
}

export const full: Card = {
  id: "wuxia",
  title: "竹林",
  summary: "暮春雨后的越州苦竹岭，你携故人遗物寻访李鹤下落，在竹林荒亭中与守坟的剑客裴青舟相对。",
  heading: "scene.place",
  // The card gives the player's role (the persona slot's default; a player overrides or yields it like any slot).
  frame: frags([
    {
      id: "persona",
      text: "你是替故人李鹤送还遗物的旧友。三年前李鹤在江南犯下大案、遭官府与师门两道追索，在关外与你结识并托付了随身短剑，只说若有朝一日听闻他的死讯，便去越州苦竹岭找他的同门师兄裴青舟。你并不知道当年江南那桩旧案的内情，只为践行诺言、寻访故人死因而来。",
    },
    {
      id: "setting",
      text: "故事发生在暮春雨后的越州苦竹岭。竹林深处有一座废弃的歇脚茶亭，你此行是为寻访故人李鹤的下落，在亭中遇上了独自守着孤坟的剑客裴青舟。",
    },
    {
      id: "style",
      text: "行文当如传统白话与新派武侠般气息绵长、句读自然，善用连词、副词与语气虚词把人物的动作、神态和周遭风物融在一口气里写出来。切忌写碎成电报式的短句或用冒号堆砌信息，不要反复描写「手指收紧又松开、指节发白、摩挲衣领、喉结滚动、像一根绷紧的弦」这类套路化的微表情，也不要每次都用动作把人物的一句话硬生生截成两半。",
    },
  ]),
  // Bands of the readout are `when` fragments: the narrator reads the band's text, never the number.
  fiction: frags([
    {
      id: "pei",
      label: "裴青舟",
      text: "裴青舟身量瘦削，穿一身洗得发白的青布旧衫，腰间悬着一柄乌木鞘长剑。他对外自称是李鹤的同门师兄，自半年前江南那场变故后便隐居在这片苦竹林里，平日寡言少语，说话直截了当，极少做多余的姿态。",
    },
    {
      id: "pei-cool",
      label: "裴青舟（戒备）",
      text: "眼下裴青舟对你满怀戒备，疑心你是顺着江南旧案摸上山来的仇家或公门耳目，因此始终与你隔着三步开外的距离，言语冷淡简短，话里话外都在逼你亮明来历、早些下山。",
      when: { path: "bond", op: "lt", value: 8 },
    },
    {
      id: "pei-warm",
      label: "裴青舟（松动）",
      text: "眼下裴青舟已看出你确是真心记挂李鹤的故人，紧绷的戒心松动了许多，不仅不再拿话试探驱赶，神色间也透出几分压抑已久的倦意与亲近，愿意与你平心静气地提起往事。",
      when: { path: "bond", op: "gte", value: 8 },
    },
  ]),
  greetings: [],
  rules: {
    fields: [
      { path: "hp", label: "体力", group: "Body", type: "int", min: 0, max: 100, initial: 40 },
      { path: "foe", label: "敌手", group: "People", type: "int", min: 0, initial: 30 },
      { path: "bond", label: "交情", group: "People", type: "int", min: -30, max: 100, initial: 0 }, // a readout: never settled before the prose
    ],
    readouts: [
      {
        id: "warmth",
        text: "这一幕里裴青舟对待你的态度",
        options: [
          { id: "cold", text: "冷硬敌视，出言驱赶或动怒拔剑", do: [{ path: "bond", add: -5 }] },
          { id: "flat", text: "审视戒备，不动声色地保持距离", do: [] },
          { id: "warm", text: "态度缓和，愿意放下戒心与你交谈", do: [{ path: "bond", add: 4 }] },
          {
            id: "close",
            text: "推心置腹，向你吐露实情或流露悲恸",
            do: [{ path: "bond", add: 8 }, { event: "warmth:close" }],
          },
        ],
      },
    ],
    actions: [
      {
        id: "strike",
        text: "拔剑向裴青舟出手试探或进攻",
        roll: 0.6,
        hit: [{ path: "foe", add: -10 }, { event: "strike:hit" }],
        miss: [{ path: "hp", add: -10 }, { event: "strike:miss" }],
      },
      { id: "talk", text: "与裴青舟交谈、追问或出示信物", do: [{ event: "talk" }] },
    ],
    over: {
      any: [
        { path: "hp", is: 0 },
        { path: "foe", is: 0 },
      ],
    },
    cap: 4,
  },
  lore: [
    {
      id: "li",
      // The lock: layer 2 is unlocked once Pei has trusted the player (bond ≥ 8, and it stays unlocked when bond falls
      // back); layer 3 only ever comes through a window. The moments: layer 2 is offered on a beat event (settled
      // before the prose); layer 3 on a readout event, emitted after the prose and so opening the window next turn.
      layers: [
        "李鹤是裴青舟昔年形影不离的同门师弟，左肩有一处青色白鹤刺青。半年前他在江南犯下大案遭各派围剿，江湖上都传他已死在裴青舟剑下。",
        "眼前这位自称「裴青舟」的剑客，左肩衣领下竟也有那处青色白鹤刺青——他根本不是裴青舟，而是当年假死脱身的李鹤本人。",
        "真正的裴青舟早在半年前江南那场围剿中替李鹤挡剑身亡，临终前逼李鹤立下重誓，要他顶替「裴青舟」的姓名活下去，绝不许再回江南寻仇送死。",
      ],
      unlock: [{ all: [] }, { path: "bond", op: "gte", value: 8 }],
      offer: { any: [{ event: "strike:hit" }, { event: "warmth:close" }] },
    },
    {
      id: "heir",
      layers: ["李鹤实为前朝旧臣遗孤，当年江南那桩大案背后牵涉宫中密档。"],
      unlock: { any: [] },
      offer: { all: [] },
    }, // hidden: never in play
  ],
  guard: ["裴青舟不会在交手中丧命"],
  director: true,
  // Record products (src/product.ts), one of each flavour: a default switched on (options, capped list), a feed record
  // with a nested table (scene: read back to the model as `Current:`), and a recall table (people: rows the lookup
  // stage can deliver later, like lore).
  products: [
    { id: "options", on: true },
    {
      id: "scene",
      text: "Where the scene stands now: the place, and who is present with their mood.",
      shape: {
        kind: "record",
        keys: [
          { key: "place", type: "text" },
          {
            key: "present",
            shape: {
              kind: "table",
              columns: [
                { key: "name", type: "text" },
                { key: "mood", type: "enum", options: ["calm", "tense"] },
              ],
            },
          },
        ],
      },
      feed: true,
    },
    {
      id: "people",
      text: "People named this scene who are not in Known, one row each.",
      shape: {
        kind: "table",
        columns: [
          { key: "name", type: "text" },
          { key: "note", type: "text" },
        ],
        max: 8,
      },
      recall: "name",
    },
  ],
}
export const chat: Card = {
  ...full,
  rules: { fields: full.rules.fields, actions: [] },
  lore: [],
  guard: [],
  director: false,
}
