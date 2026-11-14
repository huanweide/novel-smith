/**
 * 人物面板的「看得到多少」与「能做什么」
 *
 * 抄自鬼谷八荒的人物界面（2026-11-14 调研）：
 *   1. 信息与动作同屏——看他的同时就能对他动手，不必回正文区再找按钮；
 *   2. 物品栏按「念力」判定看不看得清——境界差太远就只看得到一个轮廓；
 *   3. 交互行为十几项，好感越高解锁越多（结义/结缘/双修都要门槛）。
 *
 * 我们抄第 1 条与第 2 条的**精神**，不抄第 3 条的「锁」：
 *   本项目已定铁律——好感只改难度，永远不删选项（relation-ledger.ts 头注释）。
 *   所以这里「看不清」只作用于**信息**，不作用于**动作**。你可以对陌生人动手，
 *   只是你不知道他怀里揣着什么，也不知道他有没有靠山。
 *
 * 纯函数，零 LLM，可单测。
 */

import type { BaseVerb } from "./verbs";

/** 对一个人的了解程度：决定面板上哪些字是清楚的、哪些是模糊的 */
export type Knowledge = "stranger" | "acquainted" | "close";

/**
 * 了解程度怎么算。
 *
 * 只用一个数：关系值的绝对值。理由——
 *   · 恨到 -40 的人，你一定打听过他（仇人比路人更值得研究）；
 *   · 亲近到 +25 的人，你当然知道他的底。
 *   · 中间那段（-19 ~ +19）就是「点头之交」：见过，但说不清。
 *
 * 不用「见过几轮」这类计数：轮次是引擎的单位，不是人的感受。
 */
export function knowledgeOf(level: number): Knowledge {
  const abs = Math.abs(level);
  if (abs >= 40) return "close";
  if (abs >= 15) return "acquainted";
  return "stranger";
}

/** 面板顶部那一行小字：让玩家知道「我现在对他算什么」 */
export function knowledgeLabel(k: Knowledge): string {
  return k === "close" ? "知根知底" : k === "acquainted" ? "打过交道" : "只是见过";
}

/**
 * 该不该把这段字打码。
 *
 * 判据不是「有没有内容」，而是「以你俩现在的关系，他会不会让你知道」。
 * 空内容一律不算「看不清」——那是「本来就没有」，用另一种写法（空态句），不混为一谈。
 */
export function shouldMask(text: string | undefined | null, k: Knowledge): boolean {
  if (!text || !text.trim()) return false;
  return k === "stranger";
}

/** 打码后的显示：不写「未知」，写一排砖——看得见「这里有东西」，但读不出来 */
export const MASK_TEXT = "▨▨▨▨";

// ─── 动作分组 ────────────────────────────────────────────────

export type ActionTone = "soft" | "probe" | "hard" | "deal";

export interface PersonAction {
  /** 按钮上的字，短 */
  label: string;
  /** 真发出去的那句话；接人名 */
  text: string;
  /** 代价（与 intent-deck 同口径：一刻 / 半日 / 一夜 / 两天） */
  cost?: string;
  /** 风险标记：有险 / 必险 / 稳妥 */
  risk?: "safe" | "risky" | "deadly";
  /** 对应哪个基础动词（用于好感结算，不由界面算） */
  verb?: BaseVerb;
}

export interface ActionGroup {
  tone: ActionTone;
  /** 组名，两个字：温和 / 试探 / 强硬 / 事务 */
  label: string;
  actions: PersonAction[];
}

/**
 * 对一个人能做什么。
 *
 * 四组按「他会不会翻脸」排，不按功能排：
 *   温和（不翻脸）→ 试探（可能翻脸）→ 强硬（一定翻脸）→ 事务（看交情）
 * 这个顺序本身就是信息：越往下越难收场。
 *
 * 不给「观察」单独一组——观察是看，不是做，它属于面板本身（信息区）。
 */
export function actionGroupsFor(name: string): ActionGroup[] {
  const n = name;
  return [
    {
      tone: "soft",
      label: "温和",
      actions: [
        { label: "说句话", text: `与${n}交谈`, cost: "一刻", risk: "safe", verb: "talk" },
        { label: "闲聊", text: `和${n}闲聊几句，问问近况`, cost: "一刻", risk: "safe", verb: "talk" },
        { label: "问他怎么看", text: `问${n}对眼下这件事怎么看`, cost: "一刻", risk: "safe", verb: "talk" },
      ],
    },
    {
      tone: "probe",
      label: "试探",
      actions: [
        { label: "套他的话", text: `绕着弯子套${n}的话，看能不能问出点什么`, cost: "半日", risk: "risky", verb: "talk" },
        { label: "盯着他看", text: `不动声色地打量${n}，看他身上有没有不对劲的地方`, cost: "一刻", risk: "safe" },
        { label: "提那件事", text: `向${n}提起那件他一直回避的事`, cost: "半日", risk: "risky", verb: "talk" },
      ],
    },
    {
      tone: "hard",
      label: "强硬",
      actions: [
        { label: "威胁", text: `压着嗓子威胁${n}，让他知道不配合的后果`, cost: "一刻", risk: "risky" },
        { label: "辱骂", text: `当众辱骂${n}，一点情面都不留`, cost: "一刻", risk: "deadly" },
        { label: "偷他东西", text: `趁${n}不注意，摸走他身上的一样东西`, cost: "半日", risk: "risky", verb: "steal" },
        { label: "动手", text: `对${n}动手`, cost: "半日", risk: "deadly", verb: "kill" },
      ],
    },
    {
      tone: "deal",
      label: "事务",
      actions: [
        { label: "交易", text: `与${n}做一笔交易`, cost: "半日", risk: "safe" },
        { label: "讨要", text: `向${n}讨要一件东西`, cost: "一刻", risk: "risky" },
        { label: "请他帮忙", text: `请${n}帮一个忙`, cost: "半日", risk: "risky" },
      ],
    },
  ];
}

/**
 * 把「他 / 她 / TA」换成真名。
 *
 * 为什么要这个函数：扩展格的默认文案是通用句式（"指着他骂一顿"），
 * 在正文输入框里对着空气说没问题；但进了人物面板，必须说清"指着谁"，
 * 否则玩家点完会怀疑自己刚才到底骂了谁。
 *
 * 「其他」这种词里的"他"不是代词，不能换——所以前面不能紧挨着"其"。
 */
export function personify(text: string, name: string): string {
  return text.replace(/(?<!其)(他|她|TA|ta)/g, name);
}

/**
 * 对自己的动作。
 *
 * 为什么需要：正文里的名字热点也会命中主角，点开若是同一套「辱骂 / 偷他东西」，
 * 玩家会看到「辱骂林舟」——而林舟就是他自己。这不是幽默，是设计漏了。
 *
 * 对自己的动作只有四件：看、歇、整、想。没有「社交」，因为社交需要第二个人。
 */
export function selfActionsFor(): ActionGroup[] {
  return [
    {
      tone: "soft",
      label: "自身",
      actions: [
        { label: "看看自己", text: "低头看了看自己此刻的样子", cost: "一刻", risk: "safe" },
        { label: "歇一会儿", text: "找个地方坐下来，歇一会儿", cost: "半日", risk: "safe" },
        { label: "整理行装", text: "把身上的东西摊开，重新理一遍", cost: "一刻", risk: "safe" },
        { label: "回想这些天", text: "把这些天发生的事在脑子里过一遍", cost: "一刻", risk: "safe" },
      ],
    },
  ];
}

/** 代价徽标的中文（与 intent-deck 的 costPeriods 同口径，展示用） */
export function riskLabel(r?: PersonAction["risk"]): string {
  return r === "deadly" ? "必翻脸" : r === "risky" ? "有险" : "稳妥";
}
