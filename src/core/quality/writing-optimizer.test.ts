/**
 * R4' 判别测试 · 后端自优化写作逻辑（先红 → 改 → 绿）
 *
 * 用户界定：「R4 顶多做后端自优化写作逻辑」——就地闭环，不是外部评估框架。
 * 外部去矛盾 M7：DSPy 39,011★ MIT，但四份资料同指
 * 「Don't use it for one-shot creative tasks」「subjective quality give the optimizer no score to maximize」。
 * 故此处零 LLM 调用、纯确定性规则、硬上下限、可解释、可回滚。
 */
import { describe, expect, it } from "vitest";
import { deriveWritingAdjustment, applyAdjustment } from "./writing-optimizer";

const hist = (scores: number[], aiScores?: number[]) =>
  scores.map((s, i) => ({
    order: i + 1,
    qualityScore: s,
    humanizeScore: aiScores?.[i] ?? null,
    wordCount: 2500,
  }));

describe("R4' · 样本不足绝不瞎调", () => {
  it("少于 3 章时完全不调整", () => {
    const d = deriveWritingAdjustment(hist([40, 45]));
    expect(d.temperatureDelta).toBe(0);
    expect(d.memoryBudgetScale).toBe(1);
    expect(d.applied).toBe(false);
    expect(d.reasons.join(" ")).toContain("样本不足");
  });

  it("全部为 null（未评分）时不调整", () => {
    const d = deriveWritingAdjustment(hist([0, 0, 0]).map((h) => ({ ...h, qualityScore: null })));
    expect(d.applied).toBe(false);
  });
});

describe("R4' · 质量趋势驱动确定性微调", () => {
  it("近 3 章质量持续偏低 → 降温求稳、并略增记忆预算（给更多设定支撑）", () => {
    const d = deriveWritingAdjustment(hist([48, 45, 42]));
    expect(d.temperatureDelta).toBeLessThan(0);
    expect(d.memoryBudgetScale).toBeGreaterThan(1);
    expect(d.applied).toBe(true);
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it("质量高且稳定 → 允许小幅升温求变化，但记忆预算不膨胀", () => {
    const d = deriveWritingAdjustment(hist([85, 87, 88]));
    expect(d.temperatureDelta).toBeGreaterThan(0);
    expect(d.memoryBudgetScale).toBeLessThanOrEqual(1);
  });

  it("AI 味偏重（humanizeScore 高）→ 强化去 AI 味提示权重", () => {
    const d = deriveWritingAdjustment(hist([70, 72, 71], [72, 76, 80]));
    expect(d.humanizeEmphasis).toBeGreaterThan(1);
    expect(d.reasons.join(" ")).toContain("AI 味");
  });

  it("同样输入必须得到同样输出（可复现、可回滚）", () => {
    const a = deriveWritingAdjustment(hist([50, 52, 49], [60, 62, 61]));
    const b = deriveWritingAdjustment(hist([50, 52, 49], [60, 62, 61]));
    expect(a).toEqual(b);
  });
});

describe("R4' · 硬上下限与作者优先", () => {
  it("温度调整永不超过 ±0.15，且结果被夹在 [0.5, 1.1]", () => {
    for (const scores of [[1, 1, 1], [100, 100, 100], [0, 100, 0], [50, 50, 50]]) {
      const d = deriveWritingAdjustment(hist(scores));
      expect(Math.abs(d.temperatureDelta)).toBeLessThanOrEqual(0.15);
      const out = applyAdjustment({ baseTemperature: 0.85, baseMemoryBudget: 800, adjustment: d });
      expect(out.temperature).toBeGreaterThanOrEqual(0.5);
      expect(out.temperature).toBeLessThanOrEqual(1.1);
    }
  });

  it("记忆预算缩放夹在 [0.85, 1.15]，绝不把上下文砍到缺信息", () => {
    const d = deriveWritingAdjustment(hist([1, 1, 1]));
    expect(d.memoryBudgetScale).toBeGreaterThanOrEqual(0.85);
    expect(d.memoryBudgetScale).toBeLessThanOrEqual(1.15);
    const out = applyAdjustment({ baseTemperature: 0.85, baseMemoryBudget: 800, adjustment: d });
    expect(out.memoryBudget).toBeGreaterThanOrEqual(Math.floor(800 * 0.85));
  });

  it("作者手填温度时，自调整被完全跳过（作者意志最高优先级）", () => {
    const base = { baseTemperature: 0.62, baseMemoryBudget: 800 };
    const d = deriveWritingAdjustment(hist([40, 41, 39]));
    const manual = applyAdjustment({ ...base, adjustment: d, authorTemperature: 0.62 });
    expect(manual.temperature).toBe(0.62);
    expect(manual.temperatureDeltaApplied).toBe(0);
    expect(manual.authorOverride).toBe(true);
  });

  it("未提供作者设定时才应用自动调整", () => {
    const d = deriveWritingAdjustment(hist([40, 41, 39]));
    const auto = applyAdjustment({ baseTemperature: 0.85, baseMemoryBudget: 800, adjustment: d });
    expect(auto.temperature).toBeLessThan(0.85);
    expect(auto.authorOverride).toBe(false);
    expect(auto.temperatureDeltaApplied).toBeLessThan(0);
  });
});

describe("R4' · 从 allNodes 解析（零额外查询）", () => {
  it("只取当前章之前的历史，且决策与实际生效参数一致", async () => {
    const { resolveWritingParams } = await import("./writing-optimizer");
    const nodes = [
      { order: 1, qualityScore: 45, humanizeScore: 70 },
      { order: 2, qualityScore: 43, humanizeScore: 72 },
      { order: 3, qualityScore: 41, humanizeScore: 75 },
      { order: 4, qualityScore: null, humanizeScore: null },
    ];
    const r = resolveWritingParams({ allNodes: nodes, baseTemperature: 0.85, baseMemoryBudget: 800, currentOrder: 4 });
    expect(r.adjustment.sampleSize).toBe(3);
    expect(r.applied.temperature).toBeLessThan(0.85);
    expect(r.applied.reasons.join(" ")).toContain("偏低");
  });

  it("作者手填温度时，即便历史分很低也不改", async () => {
    const { resolveWritingParams } = await import("./writing-optimizer");
    const r = resolveWritingParams({
      allNodes: [1, 2, 3].map((i) => ({ order: i, qualityScore: 20 })),
      baseTemperature: 0.85,
      baseMemoryBudget: 800,
      authorTemperature: 0.4,
    });
    expect(r.applied.temperature).toBe(0.4); // 作者手填低于自动调整下限，仍原样保留，不被夹住
    expect(r.applied.authorOverride).toBe(true);
    expect(r.applied.temperatureDeltaApplied).toBe(0);
  });
});
