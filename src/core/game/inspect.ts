/**
 * 探查判定 —— 你有没有本事看清一个人
 *
 * 用户原话（2026-11-14）：
 *   "探查功能的具体判定来源，是你本身有没有探查的机制或实力。
 *    在上下文的语义层，判定可能是基于你个人的发现、神识、某种功法的压迫，
 *    或者是单纯的情报打听。"
 *
 * 判定分层（本项目铁律：贵的那层永远不当裁判）：
 *   · 探查力 = 纯函数算——自身能力（神识/感知/功法）+ 情报（打过交道就是情报）；
 *   · 成败 = 掷骰定——d100 ≤ 成功率即成，AI 只演不判（与 roll-arbiter 同哲学，
 *     但探查不值得为它调一次 LLM 检定官：探查力全部来自确定性事实，无需常识翻译）；
 *   · 探到什么 = 分层解锁——大成功看穿、成功看清、失败白看、大失败被当场抓住。
 *
 * 纯函数，零 LLM，可单测。掷骰本身由调用方注入（服务端 Math.random），这里只裁结果。
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

/**
 * 探查力怎么算。
 *
 * @param abilities 玩家人物卡的 abilities（功法/神通/技能，一字一顿的中文词）
 * @param level     与目标的当前关系值（-100~+100）——打过交道就是情报，
 *                  恨一个人也会把他研究得很透（与 person-view.knowledgeOf 同口径）
 */
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

// ─── 判定结果 ────────────────────────────────────────────────

export type InspectTier = "critical" | "success" | "fail" | "blunder";

export interface InspectReveals {
  /** 看清底细（解锁「底细」栏不打码 + 得到一条洞察） */
  background: boolean;
  /** 看清随身（解锁背包清单） */
  inventory: boolean;
}

export interface InspectVerdict {
  tier: InspectTier;
  d100: number;
  rate: number;
  /** 解锁了什么 */
  reveals: InspectReveals;
  /** 被察觉时的好感变化（负数；没被察觉为 0） */
  alertDelta: number;
  /** 骰面卡上的一句话 */
  note: string;
}

/**
 * 裁骰面。
 *
 * 四档（COC 式）：
 *   · 大成功  d100 ≤ 成功率/5 —— 看穿：底细 + 随身全见，连他藏起来的那一眼也看见了
 *   · 成功    d100 ≤ 成率    —— 看清：底细 + 随身清单
 *   · 失败    其余           —— 白看：什么都没多看出来，但对方没起疑（探查本来就该无声）
 *   · 大失败  d100 ≥ 96      —— 被当场抓住：好感大损
 *
 * rate 上限 95，所以「大失败」永远可能——探查没有稳拿的。
 */
export function inspectVerdict(d100: number, rate: number): InspectVerdict {
  const roll = clamp(Math.round(d100), 1, 100);
  const r = clamp(Math.round(rate), 5, 95);
  if (roll >= 96) {
    return {
      tier: "blunder", d100: roll, rate: r,
      reveals: { background: false, inventory: false },
      alertDelta: -10,
      note: "你看得太投入，对方转过头来，正对上你的目光。",
    };
  }
  if (roll <= Math.ceil(r / 5)) {
    return {
      tier: "critical", d100: roll, rate: r,
      reveals: { background: true, inventory: true },
      alertDelta: 0,
      note: "你不只看清了他，连他不想让人看见的那一面也看见了。",
    };
  }
  if (roll <= r) {
    return {
      tier: "success", d100: roll, rate: r,
      reveals: { background: true, inventory: true },
      alertDelta: 0,
      note: "你不动声色地把他看了个大概。",
    };
  }
  return {
    tier: "fail", d100: roll, rate: r,
    reveals: { background: false, inventory: false },
    alertDelta: -3, // 没探到，但盯久了总会露形——对方起疑，不算抓住
    note: "看了半天，什么名堂都没看出来。",
  };
}

/** 骰面档位的中文（UI 用） */
export function tierLabel(tier: InspectTier): string {
  return tier === "critical" ? "看穿" : tier === "success" ? "看清" : tier === "blunder" ? "被抓住" : "白看";
}
