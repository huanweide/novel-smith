/**
 * 好感度账 —— 让"关系"真的会变
 *
 * 之前的状况（实测）：`GameSaga.relations` 这个字段只在 `saga-map.ts` 被读去给地图上色，
 * 全仓没有任何一处写入。于是地图上的关系线永远是空的，好感是个死字段。
 *
 * 这里补的就是那个"写入者"。三条原则：
 *   1. **纯确定性**：不问模型，四动词 × 三结果查表即得，可单测、可回放。
 *   2. **好感只改难度，不删选项**：跟仇人搭话的权利永远在，只是更难、更难看。
 *   3. **没做成不扣分**：因为"人不在/没这东西"而落空，不是他的错，一分不扣。
 *
 * 数值口径（与鬼谷八荒的"关系连锁"对齐）：
 *   · 送礼  +3   聊天 +2   偷窃 -6（他察觉了）  杀人 -40
 *   · 目击者按 0.3 折算——不是他的事，但他看见了
 *   · 上下限 ±100，到顶不再涨
 */

import { BASE_VERBS, type BaseVerb } from "./verbs";

export interface RelationEntry {
  /** -100 ~ +100，负数=敌意 */
  level: number;
  /** 最近一次变化的原因，进提示词与回执 */
  reason: string;
}

export type RelationMap = Record<string, RelationEntry>;

/** 判定结果的三种，没有第四种（没有"失败"这个状态） */
export type Outcome = "success" | "cost" | "fail";

export interface RelationInput {
  verb: BaseVerb;
  outcome: Outcome;
  /** 变化的当事人；空则不计 */
  target?: string;
  /** 在场目击者，按 0.3 折算 */
  witnesses?: string[];
  /** 模型给的一句话原因；空则用默认文案 */
  reason?: string;
}

export interface RelationChange {
  name: string;
  before: number;
  after: number;
  delta: number;
  reason: string;
}

const MIN_LEVEL = -100;
const MAX_LEVEL = 100;
const WITNESS_RATIO = 0.3;

/** 默认原因（不依赖模型，保证回执永远有话说） */
const DEFAULT_REASON: Record<string, string> = {
  "gift:success": "你把东西给了他",
  "gift:cost": "他收下了，但没打算还",
  "gift:fail": "他没接",
  "talk:success": "你把话说到了他心坎上",
  "talk:cost": "话说开了，也留下了刺",
  "talk:fail": "你把话说拧了",
  "steal:success": "他发觉东西少了，疑心到你",
  "steal:cost": "他起了疑，还没抓到实证",
  "steal:fail": "他当场抓住你的手",
  "kill:success": "他倒在你面前",
  "kill:cost": "你收了手，他记下了这一下",
  "kill:fail": "你没能收住场面",
  "describe:success": "他看在眼里",
  "describe:cost": "他看在眼里，没说什么",
  "describe:fail": "他看在眼里",
};

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.trunc(n)));
}

/** 动词 × 结果 → 基础变化值 */
export function baseDelta(verb: BaseVerb, outcome: Outcome): number {
  const spec = BASE_VERBS[verb] || BASE_VERBS.describe;
  if (outcome === "success") return spec.relationSuccess;
  if (outcome === "cost") return spec.relationCost;
  return spec.relationFail;
}

/** 取当前等级（没有这个人就当 0） */
export function levelOf(map: RelationMap | null | undefined, name: string): number {
  const e = map?.[name];
  return typeof e?.level === "number" ? e.level : 0;
}

/**
 * 好感 → 判定修正。
 * 这是"好感有重量"的唯一出口：**不删选项，只改这一下有多难。**
 */
export function relationAdjustment(level: number): number {
  if (level <= -40) return -30;
  if (level <= -20) return -15;
  if (level >= 50) return 20;
  if (level >= 20) return 10;
  return 0;
}

/** 档位词（界面显示用） */
export function relationTier(level: number): string {
  if (level <= -40) return "仇视";
  if (level <= -1) return "冷淡";
  if (level < 20) return "平常";
  if (level < 50) return "亲近";
  return "生死之交";
}

/** 把一条输入算成若干条变化（当事人 + 目击者） */
export function deltasFor(input: RelationInput): Array<{ name: string; delta: number; reason: string }> {
  const target = (input.target || "").trim();
  if (!target || input.verb === "describe") return [];
  const base = baseDelta(input.verb, input.outcome);
  const reason =
    (input.reason || "").trim() || DEFAULT_REASON[`${input.verb}:${input.outcome}`] || "情形变了";

  const out: Array<{ name: string; delta: number; reason: string }> = [];
  if (base !== 0) out.push({ name: target, delta: base, reason });

  // 目击者：折算后为 0 就跳过，避免"看了一眼就记一笔"
  for (const w of input.witnesses || []) {
    const name = (w || "").trim();
    if (!name || name === target) continue;
    const d = Math.trunc(base * WITNESS_RATIO);
    if (d === 0) continue;
    out.push({ name, delta: d, reason: "他看见了" });
  }
  return out;
}

/** 应用一批变化，返回新表与逐条变更（变更里带 before/after，回执直接用） */
export function applyRelations(
  prev: RelationMap | null | undefined,
  inputs: RelationInput[]
): { next: RelationMap; changes: RelationChange[] } {
  const next: RelationMap = { ...(prev || {}) };
  const changes: RelationChange[] = [];

  for (const input of inputs) {
    for (const d of deltasFor(input)) {
      const before = levelOf(next, d.name);
      const after = clamp(before + d.delta);
      if (after === before) continue;
      next[d.name] = { level: after, reason: d.reason };
      changes.push({ name: d.name, before, after, delta: after - before, reason: d.reason });
    }
  }
  return { next, changes };
}

/**
 * 从一次回合的结果反推 outcome。
 * 口径：有预掷骰就按骰；对抗类默认"有代价"；其余按顺利完成。
 * 这不是判定，只是把已有信息翻译成好感的口径。
 */
export function outcomeFromTurn(opts: {
  actionType: string;
  preRolledSuccess?: boolean;
  rollSuccess?: boolean;
}): Outcome {
  if (typeof opts.preRolledSuccess === "boolean") return opts.preRolledSuccess ? "success" : "fail";
  if (typeof opts.rollSuccess === "boolean") return opts.rollSuccess ? "success" : "cost";
  if (opts.actionType === "combat") return "cost";
  return "success";
}

/** 一行字的变更描述（回执"你"行直接用） */
export function describeChange(c: RelationChange): string {
  const sign = c.delta > 0 ? "+" : "";
  return `${c.name} · ${relationTier(c.after)} ${sign}${c.delta}　${c.reason}`;
}
