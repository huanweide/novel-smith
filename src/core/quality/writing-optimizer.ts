/**
 * R4' · 后端自优化写作逻辑（确定性就地闭环）
 *
 * 这是什么：读近 N 章**已落库**的质量分（`StoryNode.qualityScore` / `humanizeScore`），
 * 用确定性规则给出下一章的写作参数微调建议（温度 / 记忆预算 / 去 AI 味强调）。
 *
 * 这**不是**什么：
 *  - 不是 DSPy 式提示词编译优化（外部资料同指创意写作没有可优化标量，见 best-practices.md M7）；
 *  - 不是 LLM 自评自改（会拖慢每章、引入幻觉、破坏可复现性）；
 *  - 不改提示词正文、不改生成主链路结构，只调数值参数。
 *
 * 四条硬约束：①零 LLM 调用 ②硬上下限 ③作者手填参数恒优先 ④同输入同输出（可复现、可回滚）。
 */

export interface ChapterQualityLike {
  order: number;
  qualityScore: number | null;
  /** AI 痕迹指数 0-100，越高越像 AI 写的 */
  humanizeScore?: number | null;
  wordCount?: number | null;
}

export interface WritingAdjustment {
  applied: boolean;
  /** 温度增量，夹在 ±0.15 */
  temperatureDelta: number;
  /** 记忆预算缩放，夹在 [0.85, 1.15] */
  memoryBudgetScale: number;
  /** 去 AI 味强调系数，>= 1 */
  humanizeEmphasis: number;
  /** 可审计理由（人话，不是黑话） */
  reasons: string[];
  /** 参与决策的样本数 */
  sampleSize: number;
}

export interface AppliedAdjustment {
  temperature: number;
  memoryBudget: number;
  temperatureDeltaApplied: number;
  memoryBudgetDeltaApplied: number;
  humanizeEmphasis: number;
  authorOverride: boolean;
  reasons: string[];
}

const MIN_SAMPLES = 3;
const WINDOW = 5;
const MAX_TEMP_DELTA = 0.15;
const TEMP_MIN = 0.5;
const TEMP_MAX = 1.1;
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.15;
const QUALITY_LOW = 55;
const QUALITY_HIGH = 80;
const AI_HEAVY = 65;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 从历史质量序列推导调整建议。纯函数，无副作用。
 */
export function deriveWritingAdjustment(history: ChapterQualityLike[]): WritingAdjustment {
  const scored = (history || [])
    .filter((h) => typeof h.qualityScore === "number" && Number.isFinite(h.qualityScore))
    .sort((a, b) => a.order - b.order)
    .slice(-WINDOW);
  const reasons: string[] = [];
  const noop = (why?: string): WritingAdjustment => ({
    applied: false,
    temperatureDelta: 0,
    memoryBudgetScale: 1,
    humanizeEmphasis: 1,
    reasons: why ? [why] : [],
    sampleSize: scored.length,
  });

  if (scored.length < MIN_SAMPLES) return noop(`样本不足：只有 ${scored.length} 章有质量分，至少需 ${MIN_SAMPLES} 章才调整，避免凭一两章噪声乱动参数。`);

  const scores = scored.map((h) => h.qualityScore as number);
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
  const firstHalf = scores.slice(0, Math.ceil(scores.length / 2));
  const secondHalf = scores.slice(Math.ceil(scores.length / 2));
  const avgOf = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const trend = avgOf(secondHalf) - avgOf(firstHalf);

  let temperatureDelta = 0;
  let memoryBudgetScale = 1;
  let humanizeEmphasis = 1;

  // 规则 1：质量持续偏低 → 降温（更稳、更贴设定）+ 略增记忆预算（多给设定支撑）
  if (avg < QUALITY_LOW) {
    temperatureDelta = -Math.min(MAX_TEMP_DELTA, (QUALITY_LOW - avg) / 300);
    memoryBudgetScale = 1 + Math.min(0.1, (QUALITY_LOW - avg) / 500);
    reasons.push(`近 ${scored.length} 章平均质量 ${avg.toFixed(1)} 分偏低，小幅降温求稳，并给设定回忆多留一点空间。`);
  } else if (avg > QUALITY_HIGH && trend > -3) {
    // 规则 2：质量高且不塌 → 允许小幅升温求变化，不动记忆预算
    temperatureDelta = Math.min(MAX_TEMP_DELTA, (avg - QUALITY_HIGH) / 300);
    reasons.push(`近 ${scored.length} 章平均质量 ${avg.toFixed(1)} 分且走势稳定，小幅升温增加表达变化。`);
  } else {
    reasons.push(`质量 ${avg.toFixed(1)} 分处于正常区间，不做温度调整。`);
  }

  // 规则 3：趋势明显下滑（哪怕均值不低）→ 额外收紧
  if (trend < -8) {
    temperatureDelta -= 0.03;
    reasons.push(`质量走势下滑 ${trend.toFixed(1)} 分，再收紧一点避免越写越散。`);
  }

  // 规则 4：AI 味偏重 → 强化去 AI 味强调（交给既有 humanize 规则引擎消费，不重造评分器）
  const aiScores = scored
    .map((h) => h.humanizeScore)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (aiScores.length >= MIN_SAMPLES) {
    const aiAvg = avgOf(aiScores);
    if (aiAvg > AI_HEAVY) {
      humanizeEmphasis = 1 + Math.min(0.3, (aiAvg - AI_HEAVY) / 150);
      reasons.push(`AI 痕迹指数均值 ${aiAvg.toFixed(1)} 偏高，加强去 AI 味强调。`);
    }
  }

  temperatureDelta = round3(clamp(temperatureDelta, -MAX_TEMP_DELTA, MAX_TEMP_DELTA));
  memoryBudgetScale = round3(clamp(memoryBudgetScale, SCALE_MIN, SCALE_MAX));
  humanizeEmphasis = round3(clamp(humanizeEmphasis, 1, 1.3));

  return {
    applied: temperatureDelta !== 0 || memoryBudgetScale !== 1 || humanizeEmphasis !== 1,
    temperatureDelta,
    memoryBudgetScale,
    humanizeEmphasis,
    reasons,
    sampleSize: scored.length,
  };
}

/**
 * 应用调整。作者手填温度恒优先，自动调整只作用于「作者没指定」的场合。
 */
export function applyAdjustment(input: {
  baseTemperature: number;
  baseMemoryBudget: number;
  adjustment: WritingAdjustment;
  authorTemperature?: number | null;
}): AppliedAdjustment {
  const { adjustment: a } = input;
  const authorOverride = typeof input.authorTemperature === "number" && Number.isFinite(input.authorTemperature);
  const rawTemp = authorOverride ? (input.authorTemperature as number) : input.baseTemperature + a.temperatureDelta;
  // 硬上下限只约束「自动调整」的结果；作者手填的温度是作者意志，原样保留、不夹不裁。
  const temperature = authorOverride ? round3(rawTemp) : round3(clamp(rawTemp, TEMP_MIN, TEMP_MAX));
  const memoryBudget = Math.max(1, Math.floor(input.baseMemoryBudget * a.memoryBudgetScale));
  return {
    temperature,
    memoryBudget,
    temperatureDeltaApplied: authorOverride ? 0 : a.temperatureDelta,
    memoryBudgetDeltaApplied: memoryBudget - input.baseMemoryBudget,
    humanizeEmphasis: a.humanizeEmphasis,
    authorOverride,
    reasons: authorOverride
      ? [`作者已手填温度 ${input.authorTemperature}，自动调整跳过（作者意志最高优先级）。`, ...a.reasons]
      : a.reasons,
  };
}

/**
 * 从已装载的 allNodes（零额外 DB 查询）解析写作参数决策。
 * 供生成主链路与只读诊断 API 共用，保证「看到的」和「实际用的」是同一份决策。
 */
export function resolveWritingParams(input: {
  allNodes: Array<{ order?: number | null; qualityScore?: number | null; humanizeScore?: number | null; wordCount?: number | null }>;
  baseTemperature: number;
  baseMemoryBudget: number;
  /** 作者在项目设置里手填的温度；有值则自动调整完全跳过 */
  authorTemperature?: number | null;
  /** 只取当前章之前的历史，避免把未写完的本章算进去 */
  currentOrder?: number | null;
}): { adjustment: WritingAdjustment; applied: AppliedAdjustment } {
  const before = (input.allNodes || []).filter(
    (n) => input.currentOrder == null || (n.order ?? 0) < input.currentOrder,
  );
  const history: ChapterQualityLike[] = before.map((n, i) => ({
    order: n.order ?? i + 1,
    qualityScore: typeof n.qualityScore === "number" ? n.qualityScore : null,
    humanizeScore: typeof n.humanizeScore === "number" ? n.humanizeScore : null,
    wordCount: typeof n.wordCount === "number" ? n.wordCount : null,
  }));
  const adjustment = deriveWritingAdjustment(history);
  const applied = applyAdjustment({
    baseTemperature: input.baseTemperature,
    baseMemoryBudget: input.baseMemoryBudget,
    adjustment,
    authorTemperature: input.authorTemperature,
  });
  return { adjustment, applied };
}
