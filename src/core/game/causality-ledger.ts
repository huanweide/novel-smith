/**
 * 因果链账本（R9 自由度扩展）—— 纯函数，零运行时依赖
 *
 * 设计意图（对标《鬼谷八荒》因果链）：
 *   玩家/AI 在某轮种下"因"（一句尚未兑现的因果），它可能在更后面的轮次"结果"。
 *   这样每个选择都会长出后果网——"帮九尾妖狐渡劫→危战来挡刀""挖陨落者墓→亲人派杀手寻仇"。
 *   自由度高于跑团之处：AI 自动追踪并兑现玩家行为播下的种子，无需 GM 手写剧情。
 *
 * 所有函数都为可单测而写：入参明确、无副作用、无 prisma / llm 依赖。
 */

import type { CausalitySeed, CausalityType } from "./types";

export const CAUSALITY_TYPES: CausalityType[] = [
  "善缘",
  "仇怨",
  "羁绊",
  "因果",
  "誓言",
];

/** 原始因果种子（来自 AI 输出解析） */
export interface RawCausalitySeed {
  type?: string;
  subject?: string;
  description?: string;
}

/**
 * 从 AI 解析出的原始种子列表，生成带 id / 轮次 / 触发状态的种子数组。
 * 非法行（缺 subject 或 description）会被跳过，保证入库数据干净。
 */
export function extractCausalitySeeds(
  rawSeeds: Array<RawCausalitySeed | null | undefined>,
  round: number
): CausalitySeed[] {
  if (!Array.isArray(rawSeeds)) return [];
  const out: CausalitySeed[] = [];
  rawSeeds.forEach((s, idx) => {
    if (!s || !s.subject || !s.description) return;
    const type = (CAUSALITY_TYPES as string[]).includes(s.type || "")
      ? (s.type as CausalityType)
      : "因果";
    out.push({
      id: `cs_${round}_${idx}_${Date.now().toString(36)}`,
      type,
      subject: String(s.subject).slice(0, 120),
      description: String(s.description).slice(0, 300),
      plantedRound: round,
      triggered: false,
    });
  });
  return out;
}

/**
 * 把"因果兑现"声明列表作用到已有种子上，标记命中者为已触发。
 * 匹配优先级：先按 (subject 且 type 一致 且 未触发) 精确匹配，否则按 subject 兜底匹配。
 * 返回新数组，不修改入参（纯函数）。
 */
export function markSeedTriggered(
  seeds: CausalitySeed[],
  doneList: Array<{ subject?: string; type?: string } | null | undefined>,
  round: number
): CausalitySeed[] {
  if (!Array.isArray(seeds) || !Array.isArray(doneList)) return seeds;
  const next = seeds.map((s) => ({ ...s }));

  for (const d of doneList) {
    const subj = d?.subject?.trim();
    if (!subj) continue;
    const match =
      next.find(
        (s) =>
          !s.triggered &&
          s.subject === subj &&
          (!d?.type || !s.type || d?.type === s.type)
      ) ??
      next.find((s) => !s.triggered && s.subject === subj);
    if (match) {
      match.triggered = true;
      match.triggeredRound = round;
    }
  }
  return next;
}

/** 合并新种下的种子到已有列表（用于每轮持久化前合并） */
export function mergeSeeds(
  existing: CausalitySeed[],
  newlyPlanted: CausalitySeed[]
): CausalitySeed[] {
  if (!Array.isArray(existing)) return newlyPlanted;
  if (!Array.isArray(newlyPlanted) || newlyPlanted.length === 0) return existing;
  // 以 id 去重；同一颗种子两边都有时，**已兑现状态取并集**（true 优先）。
  // 不能简单 {...prev, ...s}：新来的那条 triggered 是 false，会把已兑现覆盖回未兑现，
  // 结果同一件"因"被重复回响一次（跨章继承场景下就会发生）。
  const map = new Map<string, CausalitySeed>();
  for (const s of existing) map.set(s.id, s);
  for (const s of newlyPlanted) {
    const prev = map.get(s.id);
    if (!prev) {
      map.set(s.id, s);
      continue;
    }
    const triggered = prev.triggered || s.triggered;
    const merged: CausalitySeed = { ...prev, ...s, triggered };
    if (triggered) merged.triggeredRound = prev.triggeredRound ?? s.triggeredRound;
    else delete merged.triggeredRound;
    map.set(s.id, merged);
  }
  return Array.from(map.values());
}

/**
 * 把因果上下文渲染为注入提示词的文本块。
 * 区分"未兑现"（提示 AI 在合适时机让其结果）与"已兑现"（已收束，仅供连贯）。
 */
export function buildCausalityContext(seeds: CausalitySeed[]): string {
  if (!seeds || seeds.length === 0) return "";
  const active = seeds.filter((s) => !s.triggered);
  const done = seeds.filter((s) => s.triggered);
  if (active.length === 0 && done.length === 0) return "";

  const lines: string[] = ["## 因果脉络（种下的因，终会结果）"];
  if (active.length > 0) {
    lines.push(
      "以下「因」尚未兑现，请在合适的剧情时机让其自然「结果」（不必本轮，可延后）："
    );
    for (const s of active) {
      lines.push(
        `- 【${s.type}】关于「${s.subject}」：${s.description}（第${s.plantedRound}轮种下）`
      );
    }
  }
  if (done.length > 0) {
    lines.push("已经兑现的因果（已收束，仅供情节连贯参考）：");
    for (const s of done) {
      lines.push(`- 【${s.type}✓】关于「${s.subject}」：${s.description}`);
    }
  }
  return lines.join("\n");
}
