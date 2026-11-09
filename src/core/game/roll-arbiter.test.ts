/**
 * 检定官纯函数单测（2026-11-08 P0-4 进阶）
 * arbitrateRoll 本体走 LLM 不在此测（mock 层收益低）；测动态调整/掷骰判定/状态机。
 */
import { describe, it, expect } from "vitest";
import { computeAdjustments, nextRollStats, judgeRoll, rateLabel } from "./roll-arbiter";

describe("computeAdjustments —— 防退化三件套", () => {
  const key = "custom|偷袭老头|";

  it("无历史 → 无调整", () => {
    const adj = computeAdjustments({ winStreak: 0, loseStreak: 0, lastKey: "", repeatCount: 0 }, key);
    expect(adj).toHaveLength(0);
  });

  it("连胜骄敌：连胜 2 轮 -10、3 轮 -30 封顶", () => {
    expect(computeAdjustments({ winStreak: 2, loseStreak: 0, lastKey: "x", repeatCount: 0 }, key)).toEqual([
      { reason: "连胜2轮，对手与局势已警惕", value: -20 },
    ]);
    expect(computeAdjustments({ winStreak: 5, loseStreak: 0, lastKey: "x", repeatCount: 0 }, key)[0].value).toBe(-30);
  });

  it("命运保底：连败 ≥2 → +15（防全败劝退）", () => {
    expect(computeAdjustments({ winStreak: 0, loseStreak: 2, lastKey: "x", repeatCount: 0 }, key)).toEqual([
      { reason: "连败2轮，命运保底", value: 15 },
    ]);
  });

  it("重复惩罚：同一行动每次 -15，第 3 次 -25（卡 bug 无效）", () => {
    const rep1 = computeAdjustments({ winStreak: 0, loseStreak: 0, lastKey: key, repeatCount: 0 }, key);
    expect(rep1[0].value).toBe(-15);
    const rep3 = computeAdjustments({ winStreak: 0, loseStreak: 0, lastKey: key, repeatCount: 2 }, key);
    expect(rep3[0].value).toBe(-25);
    expect(rep3[0].reason).toContain("3次");
  });

  it("重复优先于连胜（先堵 bug 再谈运气）", () => {
    const adj = computeAdjustments({ winStreak: 4, loseStreak: 0, lastKey: key, repeatCount: 0 }, key);
    expect(adj).toHaveLength(1);
    expect(adj[0].reason).toContain("重复");
  });
});

describe("nextRollStats —— 动态状态机", () => {
  it("成功：连胜累积、连败清零、重复计数累进", () => {
    const s = nextRollStats({ winStreak: 1, loseStreak: 2, lastKey: "a", repeatCount: 1 }, "a", true);
    expect(s).toEqual({ winStreak: 2, loseStreak: 0, lastKey: "a", repeatCount: 2 });
  });

  it("失败：连败累积、连胜清零、换行动重置重复", () => {
    const s = nextRollStats({ winStreak: 3, loseStreak: 0, lastKey: "a", repeatCount: 2 }, "b", false);
    expect(s).toEqual({ winStreak: 0, loseStreak: 1, lastKey: "b", repeatCount: 0 });
  });
});

describe("judgeRoll —— d100 + 成功率 → 五档", () => {
  it("骰值≤成功率 → 成功；压线 8 点内 → 勉强成功", () => {
    expect(judgeRoll(30, 60).key).toBe("success");
    expect(judgeRoll(55, 60).key).toBe("partial"); // 压线
    expect(judgeRoll(55, 60).success).toBe(true);
  });

  it("骰值≤5 且 ≤成功率 → 大成功", () => {
    expect(judgeRoll(3, 60).key).toBe("critical_success");
  });

  it("骰值>成功率 → 失败；≥96 且超 40 点 → 大失败", () => {
    expect(judgeRoll(70, 60).key).toBe("fail");
    expect(judgeRoll(70, 60).success).toBe(false);
    expect(judgeRoll(98, 20).key).toBe("critical_fail");
    // 96 但只超 30 点 → 普通失败（大失败要灾难性落差）
    expect(judgeRoll(96, 70).key).toBe("fail");
  });

  it("成功率收口语义：极低也可能成功（骰子永远有意义）", () => {
    expect(judgeRoll(1, 8).success).toBe(true);
  });
});

describe("rateLabel —— 成功率语义梯度", () => {
  it("五个梯度", () => {
    expect(rateLabel(90)).toBe("手到擒来");
    expect(rateLabel(75)).toBe("颇有把握");
    expect(rateLabel(60)).toBe("五五之数偏乐观");
    expect(rateLabel(45)).toBe("五五之数偏凶险");
    expect(rateLabel(30)).toBe("希望渺茫");
    expect(rateLabel(10)).toBe("几乎不可能");
  });
});
