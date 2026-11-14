/**
 * 探查判定 —— 「看一眼」不等于「全知道」
 *
 * 用户终审（2026-11-15，逐条落为规则）：
 *   "探查本身，可能只是打听一下这个人是谁、他是干啥的……或者只是去观察一下。
 *    大部分时候可能就是观察一下，看他的外貌是不是美女啊，长得啥样、腿如何呀，这种个人的评价。
 *    它可能只是打探一下对方的背景，或者通过跟他聊天来获取一些信息。
 *    如果是修仙效果……我能知道对方的大致修为。如果我的修为比他高，这个是能探查出来的；
 *    但其他的你就肯定不知道，就是不知道啊，没有什么可能性能够知道。
 *    除非……有一个'人物背景探查'的题，但这个是极小概率的。
 *    信息是根据上下文来断定的，是根据聊天进度去慢慢聊才知道的，而不是我探查了一下，就啥都知道了。
 *    气质如何呀，只是一个观察。"
 *
 * 判据（本轮定调，跨会话有效）：
 *   ① **观察是默认通道**：只产出主观印象（外貌/衣着/举止/气质），明确标注「这是印象，不是事实」。
 *      不产出姓名来历、身份背景、修为、随身物品、心思——看不出就写不知道，不许补全。
 *   ② **修为是确定性判定**：只有「世界有修为体系」且「档案里能比出自己更高」才可写一句
 *      相对判断（比你弱/相仿）；比不出就是看不出，绝不交给模型猜。这条不掷骰、不调 LLM。
 *   ③ **背景靠聊天进度**：深背景只在极小概率（d100 ≤ 2）且此前已积累 ≥2 条碎片时才可能给一条；
 *      每次最多一条新信息。打码由好感层级控制——聊得多了才慢慢看得清。
 *   ④ **过程进正文**：探查不再是一个「卡内一键吐清单」的黑箱接口，改为走普通正文回合，
 *      由引擎把下面这些规则注入提示词，让 AI 在正文里演「怎么看的 / 看到什么 / 还有什么不知道」。
 *      结算照尝试律（RESULT|），探查一般停在未定档。
 *
 * 贵的那层永远不当裁判：探查力 = 确定性事实；能看见什么 = 确定性规则；
 * LLM 只负责把「看这一眼的过程」写好看，无权决定信息的种类与真伪。
 */

import { knowledgeOf } from "./person-view";

/** 探查力的一个来源（回执透明：让玩家看见「这一把为什么是这个数」） */
export interface PowerPart {
  label: string;
  value: number;
}

export interface InspectPower {
  /** 最终成功率（5-95，永不 100——探查没有稳拿的） */
  rate: number;
  /** 明细：基础 + 各来源 */
  parts: PowerPart[];
}

/** 探查类能力的关键词：神识、感知、观察、情报——按词加分，最多认 3 个 */
const INSPECT_ABILITY_WORDS =
  /(神识|灵识|识海|感知|洞察|观察|望气|相面|观人|听风|辨微|暗探|密探|谍|斥候|情报|眼线|消息|卦|卜|算|推演|阅人)/;

export function inspectPower(abilities: string[] | undefined, level: number): InspectPower {
  const parts: PowerPart[] = [{ label: "基础眼力", value: 35 }];

  const matched = (abilities || [])
    .map((a) => (a || "").trim())
    .filter((a) => a && INSPECT_ABILITY_WORDS.test(a))
    .slice(0, 3); // 最多认 3 个：探查不是堆功法数量，三个足以证明「有机制」
  for (const a of matched) {
    parts.push({ label: `功法神通 · ${a}`, value: 12 });
  }

  const k = knowledgeOf(level);
  if (k === "close") parts.push({ label: "知根知底（情报）", value: 20 });
  else if (k === "acquainted") parts.push({ label: "打过交道（情报）", value: 10 });

  const total = parts.reduce((s, p) => s + p.value, 0);
  return { rate: clamp(total, 5, 95), parts };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ─── 四通道 ────────────────────────────────────────────────────

/** observe 是默认，也是绝大多数时候该发生的事 */
export type InspectChannel = "observe" | "inquire" | "sense" | "background";

export interface ChannelRule {
  label: string;
  /** 玩家点下去时发出的动作文本（尝试语气，不是既成结果） */
  action: (name: string) => string;
  /** 这一眼**能**看到什么 */
  canSee: string;
  /** 这一眼**绝对不许**写出什么（写进提示词的硬约束） */
  cannotSee: string;
}

export const INSPECT_CHANNELS: Record<InspectChannel, ChannelRule> = {
  observe: {
    label: "打量",
    action: (n) => `借着说话的空当，抬眼打量了一下${n}，想看清楚这是个什么样的人`,
    canSee: "只用眼睛能看到的表象：衣着、体态、眉眼、举止、气色、气质，以及**你个人主观的评价**（好不好看、像什么人、顺不顺眼）。这些是印象，不是事实。",
    cannotSee: "不许写出姓名来历、身份背景、修为高低、随身物品、心里在想什么、过去发生过什么；也不许替玩家下结论说「已看透此人」。",
  },
  inquire: {
    label: "打听",
    action: (n) => `向旁边的人随口打听了一下${n}，想知道他是谁、平日做什么`,
    canSee: "只写从旁人嘴里能问到的公开信息：怎么称呼、做什么营生、最近有没有人见过他；**必须写出信息来源**（问了店家、听邻座闲话、伙计随口一句）。",
    cannotSee: "不许写出私密的过往、心思、随身物品、修为；不许凭空出现一个「知情者」把底细全抖出来；没打听到就写没打听到。",
  },
  sense: {
    label: "感知",
    action: (n) => `暗自凝神，想探一探${n}的气息深浅`,
    canSee: "（由下方确定性判定决定，看规则里给的那句）",
    cannotSee: "不许给出具体境界名称、数值、功法来历；不许写「大约筑基后期」这类精确推断；不许写对方的心思、背景、随身物品。",
  },
  background: {
    label: "追底细",
    action: (n) => `顺着手里那点线索，想再往深处查一查${n}的来历`,
    canSee: "（由下方极小概率判定决定，看规则里给的那句）",
    cannotSee: "绝大多数时候什么也查不到——查不到就明白写「没查出什么」，不许硬凑一条身世、不许把传闻写成事实。",
  },
};

export function isInspectChannel(v: unknown): v is InspectChannel {
  return v === "observe" || v === "inquire" || v === "sense" || v === "background";
}

// ─── 修为：确定性，不许 LLM 猜 ────────────────────────────────

const CULTIVATION_WORLD = /(修士|修为|灵力|灵气|境界|筑基|金丹|元婴|化神|炼气|渡劫|仙|道基|内丹|真元|神识)/;

/** 境界词 → 档位（只做相对比较，不产出精确境界名） */
const RANKS: Array<[RegExp, number]> = [
  [/渡劫|大乘/, 8], [/化神|炼虚|合体/, 7], [/元婴/, 6], [/金丹/, 5],
  [/筑基/, 4], [/炼气|引气|凝气/, 3], [/后天|先天/, 2], [/凡人|普通人|不会武/, 1],
];

/** 世界是不是修仙世界（取自梗概/世界书，确定性关键词） */
export function isCultivationWorld(text: string): boolean {
  return CULTIVATION_WORLD.test(text || "");
}

/**
 * 比修为：只能从两张人物卡的确定性文本（身份/本事/状态/简介）里抽档位。
 * 比不出来就返回 null——「我不知道」是一个合法且必须被尊重的结果。
 */
export function compareCultivation(selfText: string, targetText: string): "higher" | "lower" | "even" | null {
  const rankOf = (s: string): number | null => {
    for (const [re, r] of RANKS) if (re.test(s || "")) return r;
    return null;
  };
  const a = rankOf(selfText);
  const b = rankOf(targetText);
  if (a === null || b === null) return null;
  return a > b ? "higher" : a < b ? "lower" : "even";
}

/** 深背景：极小概率，且要有此前聊天积累的碎片。用户原话「极小概率」。 */
export function deepBackgroundPossible(d100: number, knownFragments: number): boolean {
  return d100 <= 2 && knownFragments >= 2;
}

// ─── 骰面（只裁「这一眼清不清」，不裁「知道多少」）─────────────

export type InspectTier = "critical" | "success" | "fail" | "blunder";

export interface InspectReveals {
  /** 看清的是不是「表象」——永远不代表解锁底细 / 随身（用户口径 2026-11-15） */
  surface: boolean;
  /** 清晰度只影响描写详略，**不影响信息种类** */
  clarity: "sharp" | "normal" | "none";
}

export interface InspectVerdict {
  tier: InspectTier;
  d100: number;
  rate: number;
  reveals: InspectReveals;
  /** 被当场察觉才扣（盯久了不必一律起疑——大部分时候只是看一眼） */
  alertDelta: number;
  /** 骰面卡上的一句话：写「这一眼怎么样」，不写「你全知道了」 */
  note: string;
}

export function inspectVerdict(d100: number, rate: number): InspectVerdict {
  const roll = clamp(Math.round(d100), 1, 100);
  const r = clamp(Math.round(rate), 5, 95);
  if (roll >= 96) {
    return {
      tier: "blunder", d100: roll, rate: r,
      reveals: { surface: false, clarity: "none" },
      alertDelta: -10,
      note: "你看得太久，对方转过头来，正对上你的目光。这一眼算是白看了。",
    };
  }
  if (roll <= Math.ceil(r / 5)) {
    return {
      tier: "critical", d100: roll, rate: r,
      reveals: { surface: true, clarity: "sharp" },
      alertDelta: 0,
      note: "这一眼看得格外真切——但也只是眼前这个人，不是他的一生。",
    };
  }
  if (roll <= r) {
    return {
      tier: "success", d100: roll, rate: r,
      reveals: { surface: true, clarity: "normal" },
      alertDelta: 0,
      note: "你不动声色地看了个大概，剩下的还是不知道。",
    };
  }
  return {
    tier: "fail", d100: roll, rate: r,
    reveals: { surface: false, clarity: "none" },
    alertDelta: 0,
    note: "看了半天，什么名堂也没看出来——不知道就是不知道。",
  };
}

/** 骰面档位的中文（不再用「看穿」这种全知口吻） */
export function tierLabel(tier: InspectTier): string {
  return tier === "critical" ? "看真切"
    : tier === "success" ? "看个大概"
    : tier === "blunder" ? "被察觉"
    : "没看出名堂";
}

// ─── 注入正文回合的硬规则 ──────────────────────────────────────

export interface InspectDirectiveOpts {
  channel: InspectChannel;
  targetName: string;
  power: InspectPower;
  verdict: InspectVerdict;
  /** 修为世界？ */
  cultivationWorld: boolean;
  /** 自己修为相对对方（比不出为 null） */
  selfRank: "higher" | "lower" | "even" | null;
  /** 此前已积累的信息碎片数（聊天进度） */
  knownFragments: number;
}

/**
 * 把「这一眼能看到什么、绝对不能写什么」写成提示词硬约束。
 * 引擎把它接在 userPrompt 后面，AI 在**正文里**演这个过程。
 */
export function buildInspectDirective(o: InspectDirectiveOpts): string {
  const rule = INSPECT_CHANNELS[o.channel];
  const powerLine = o.power.parts.map((p) => `${p.label} +${p.value}`).join("、");
  const diceLine = `探查力 ${o.power.rate}%（${powerLine}）；本步 d100=${o.verdict.d100} → ${tierLabel(o.verdict.tier)}，${o.verdict.note}`;

  let channelLine = `${rule.canSee}\n   绝对不许：${rule.cannotSee}`;

  if (o.channel === "sense") {
    // 修为是确定性事实，不交给掷骰，也不交给模型猜
    if (!o.cultivationWorld) {
      channelLine = "这里不是能感知修为的世界——你什么气息也探不出来。如实写「探不出所以然」，不许编出境界、灵力或气势。\n   绝对不许：" + rule.cannotSee;
    } else if (o.selfRank === null) {
      channelLine = "你无法比较彼此的深浅（档案里没有可比的事实）——**只知道不知道**，不许猜、不许给档位。\n   绝对不许：" + rule.cannotSee;
    } else if (o.selfRank === "higher") {
      channelLine = "你的修为确实高过对方，因此**只能**得出一句相对判断：对方气息比你弱（或与你相仿），深浅大致有数。除此之外一概不知。\n   绝对不许：" + rule.cannotSee;
    } else {
      channelLine = "你的修为不比对方高，探不出对方的深浅——这是硬事实，不许靠运气猜、不许写成「隐约察觉」。\n   绝对不许：" + rule.cannotSee;
    }
  }

  if (o.channel === "background") {
    const possible = deepBackgroundPossible(o.verdict.d100, o.knownFragments);
    channelLine = possible
      ? `这一回极难得地顺着旧线索摸到了一点点边角：**最多给出一条**背景碎片，且必须写成「听来的 / 不确定的」，不许写成定论。\n   绝对不许：${rule.cannotSee}`
      : `没查出来。此前攒下的线索还不够，这回就是**什么也没打听到**——明写没查到，不许硬凑一条身世、不许把传闻写成事实。\n   绝对不许：${rule.cannotSee}`;
  }

  return [
    `\n\n【探查 · ${rule.label}（本步只裁看清与否，不裁知道多少）】`,
    `对象：${o.targetName}。${diceLine}`,
    `${channelLine}`,
    `共同铁律：`,
    `  · 先写**尝试的过程**：你怎么看的、对方有没有注意、看到了什么、还有什么看不出来；再收束，不许一句话宣布「探查完成 / 你全知道了」。`,
    `  · 气质、好不好看、顺不顺眼，都是**你的主观印象**，用「像是 / 看着 / 你觉得」这类口气，不要写成世界事实。`,
    `  · 看不出来的就写「不知道」；不知道就是不知道，没有「也许其实知道」这回事。`,
    `  · 背景与底细要靠往后一轮一轮聊天慢慢攒，这回不许一次性给全。`,
    `  · 本轮通常停在半路：按输出规矩写 RESULT|未定|… 即可（不结算好感/物品/生死），把余地留给下一轮。`,
  ].join("\n");
}

/** 给正文下方的一行透明回执（人话，不宣判） */
export function inspectBrief(o: Pick<InspectDirectiveOpts, "channel" | "power" | "verdict">): string {
  const parts = o.power.parts.map((p) => `${p.label} +${p.value}`).join("、");
  return `${INSPECT_CHANNELS[o.channel].label} · 探查力 ${o.power.rate}%（${parts}）｜ d100=${o.verdict.d100} → ${tierLabel(o.verdict.tier)} · 只看表象，底细要慢慢聊`;
}
