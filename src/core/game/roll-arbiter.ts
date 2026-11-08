/**
 * Roll 检定官（跑团化 P0-4 进阶，2026-11-08）
 *
 * 核心理念：
 * 1. 纯随机不对——成功率必须随能力/情境动态变化（COC 式 d100≤成功率）
 * 2. 力量体系全类型适配——修仙境界/都市技能/西幻等级的「翻译」交给 LLM 常识，
 *    检定官只输出相对成功率，不造任何书-specific 数值系统
 * 3. AI 只裁难度不裁结果——骰子掷出后结果既定，叙事 AI 必须如实演绎（AI 只演不判不变）
 * 4. 防退化三件套：连胜骄敌（防无敌）/ 命运保底（防全败劝退）/ 重复惩罚（防卡 bug）
 *
 * 检定官 = 一次轻量 LLM 调用（disableThinking，~200 token，1-2s），
 * 输入角色能力要点+最近剧情+行动，输出基础成功率与透明理由。
 */

import { completeText } from "@/core/llm/client";
import { safeParseAIJson } from "@/lib/json-parser";

export interface RollContextInput {
  /** 行动文本 */
  actionText: string;
  /** 行动类型 */
  actionType: string;
  /** 行动目标（可空） */
  target?: string;
  /** 玩家角色能力要点（角色卡 background/abilities 节选） */
  personaBrief: string;
  /** 最近叙事节选（最后 1-2 轮） */
  recentNarrative: string;
  /** 背包/装备要点（武器神兵等影响判定） */
  itemsBrief: string;
  /** 动态调整（连胜/连败/重复） */
  adjustments: Array<{ reason: string; value: number }>;
}

export interface RollVerdict {
  /** AI 裁定基础成功率 20-95 */
  baseRate: number;
  /** 情境修正明细（透明可读，增强代入感） */
  reasons: string[];
  /** 应用动态调整后的最终成功率（1-99 收口） */
  finalRate: number;
  /** 裁定一句话（注入 prompt 与骰面卡） */
  note: string;
}

const ARBITER_SYSTEM = `你是跑团检定官。基于角色的能力设定与当前剧情处境，裁定玩家行动的基础成功率（0-100 的整数）。

裁定原则：
1. 能力对比决定基调：角色明显强于对手/障碍→成功率高（75-95）；旗鼓相当→中等（45-65）；明显弱于或实力悬殊→低（15-35）。
2. 情境在能力基础上微调：地利/装备/预谋→上调；仓促/受伤/被监视/环境恶劣→下调。任何书的力量体系（修仙境界/现代技能/异能等级）都按其内在逻辑相对比较。
3. 普通难度的日常行动落在 60-75；「几乎不可能但非绝对不可能」不低于 8；「手到擒来」不高于 96。
4. 你只裁难度，不裁结果——结果由骰子决定。

只输出 JSON：{"successRate": 整数, "reasons": ["理由±修正", ...], "note": "一句话裁定理由"}`;

/**
 * 检定官：轻量 LLM 调用裁定基础成功率。
 * 任何异常（配置缺失/解析失败）→ 兜底 55%，不阻断游戏。
 */
export async function arbitrateRoll(input: RollContextInput): Promise<RollVerdict> {
  let baseRate = 55;
  let reasons: string[] = [];
  let note = "按一般难度裁定";

  try {
    const prompt = `【角色能力要点】${input.personaBrief || "（普通人的水准）"}

【随身物品】${input.itemsBrief || "（无特殊装备）"}

【最近剧情】${input.recentNarrative.slice(-600)}

【本次行动】${input.actionText}${input.target ? `（目标：${input.target}）` : ""}
${input.adjustments.length > 0 ? `\n【已应用的动态调整】${input.adjustments.map((a) => `${a.reason}${a.value > 0 ? "+" : ""}${a.value}`).join("、")}` : ""}

请裁定本次行动的基础成功率。`;

    const raw = await completeText(ARBITER_SYSTEM, prompt, {
      maxTokens: 800,
      temperature: 0.2,
      json: true,
    });

    // 复用章纲同款提取（json:true 下模型可能包 JSON 信封）
    const parsed = safeParseAIJson(extractJson(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rate = (parsed as any).successRate;
      if (typeof rate === "number" && rate > 0 && rate < 100) baseRate = Math.round(rate);
      if (Array.isArray((parsed as any).reasons)) {
        reasons = (parsed as any).reasons.filter((r: any) => typeof r === "string").slice(0, 4);
      }
      if (typeof (parsed as any).note === "string" && (parsed as any).note) {
        note = (parsed as any).note.slice(0, 80);
      }
    }
  } catch {
    // 检定官不可用 → 兜底 55%，游戏不中断
    reasons = ["（检定官离线，按一般难度）"];
  }

  // 动态调整叠加 + 收口 1-99（永远不出现绝对成败——骰子必须有意义）
  const adjustTotal = input.adjustments.reduce((s, a) => s + a.value, 0);
  const finalRate = Math.max(1, Math.min(99, baseRate + adjustTotal));

  return { baseRate, reasons, finalRate, note };
}

/** json:true 输出可能包信封，剥出 JSON 主体（章纲 extractOutlineText 的姐妹逻辑） */
function extractJson(raw: string): string {
  const trimmed = (raw || "").trim();
  const m = trimmed.match(/\{[\s\S]*\}/);
  return m ? m[0] : trimmed;
}

// ─── 动态调整计算（纯函数，可单测）─────────────────────────────

export interface RollStats {
  winStreak: number;
  loseStreak: number;
  /** 上次行动指纹（actionType+actionText 前 40 字+target），用于重复检测 */
  lastKey: string;
  repeatCount: number;
  /** 本章剩余重骰次数（null=未初始化；-1=无限；每次开新章重置） */
  rerollsLeft?: number;
}

/**
 * 防退化三件套：连胜骄敌 / 命运保底 / 重复惩罚。
 * - 连胜每 +1 → 成功率 -10（封顶 -30）：一直赢，世界提高警惕
 * - 连败 ≥2 → 成功率 +15：命运保底，不全败劝退
 * - 同一行动重复 → 每次重复 -15（如反复撬同一把锁，锁已变形）；≥3 次固定低值
 */
export function computeAdjustments(stats: RollStats, actionKey: string): Array<{ reason: string; value: number }> {
  const adj: Array<{ reason: string; value: number }> = [];
  const isRepeat = stats.lastKey === actionKey;

  if (isRepeat) {
    const rep = stats.repeatCount + 1;
    if (rep >= 3) {
      adj.push({ reason: `同一方式已尝试${rep}次，此路渐被堵死`, value: -25 });
    } else {
      adj.push({ reason: `同一方式重复尝试（第${rep}次）`, value: -15 });
    }
  } else if (stats.winStreak >= 2) {
    adj.push({ reason: `连胜${stats.winStreak}轮，对手与局势已警惕`, value: -Math.min(30, stats.winStreak * 10) });
  } else if (stats.loseStreak >= 2) {
    adj.push({ reason: `连败${stats.loseStreak}轮，命运保底`, value: 15 });
  }
  return adj;
}

/** 掷骰后更新动态状态（纯函数） */
export function nextRollStats(prev: RollStats, actionKey: string, success: boolean): RollStats {
  const isRepeat = prev.lastKey === actionKey;
  return {
    winStreak: success ? prev.winStreak + 1 : 0,
    loseStreak: success ? 0 : prev.loseStreak + 1,
    lastKey: actionKey,
    repeatCount: isRepeat ? prev.repeatCount + 1 : 0,
  };
}

/** d100 + 最终成功率 → 五档结果（COC 式：骰值≤成功率成功；压线=勉强；≤5 或压极限=大成功） */
export function judgeRoll(d100: number, finalRate: number): {
  key: "critical_fail" | "fail" | "partial" | "success" | "critical_success";
  label: string;
  success: boolean;
} {
  if (d100 <= 5 && d100 <= finalRate) {
    return { key: "critical_success", label: "大成功", success: true };
  }
  if (d100 <= finalRate) {
    // 压线成功（成功率-margin 内）→ 勉强成功带代价
    if (finalRate - d100 <= 8) {
      return { key: "partial", label: "勉强成功", success: true };
    }
    return { key: "success", label: "成功", success: true };
  }
  // 失败侧：骰值极高（≥96）且远超成功率 → 大失败（灾难性）
  if (d100 >= 96 && d100 - finalRate >= 40) {
    return { key: "critical_fail", label: "大失败", success: false };
  }
  return { key: "fail", label: "失败", success: false };
}

/** 成功率的中文梯度（注入 prompt 帮叙事 AI 理解难度语义） */
export function rateLabel(rate: number): string {
  if (rate >= 85) return "手到擒来";
  if (rate >= 70) return "颇有把握";
  if (rate >= 55) return "五五之数偏乐观";
  if (rate >= 40) return "五五之数偏凶险";
  if (rate >= 25) return "希望渺茫";
  return "几乎不可能";
}
