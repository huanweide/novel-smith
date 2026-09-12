import { describe, it, expect } from "vitest";
import { buildCoachReport, scoreColor, COACH_ADVICE } from "./coach";

describe("buildCoachReport - 实时写作教练内核", () => {
  it("空文本给满分且零待优化", () => {
    const r = buildCoachReport("");
    expect(r.overallScore).toBe(100);
    expect(r.grade).toBe("A");
    expect(r.flaggedCount).toBe(0);
    expect(r.dimensions).toHaveLength(6);
  });

  it("六维全部附中文教练建议（tip + fix 非空）", () => {
    const r = buildCoachReport("他握剑刺出。敌人应声倒下。她转身离去。");
    expect(r.dimensions).toHaveLength(6);
    for (const d of r.dimensions) {
      expect(d.advice.tip.length).toBeGreaterThan(0);
      expect(d.advice.fix.length).toBeGreaterThan(0);
    }
  });

  it("COACH_ADVICE 覆盖全部六维 key", () => {
    const keys = ["wasteWordRate", "showVsTell", "povConsistency", "sentenceVariety", "dialogueNaturalness", "subjectDiversity"];
    for (const k of keys) expect(COACH_ADVICE[k]).toBeTruthy();
  });

  it("废词密集文本触发废词率维度问题", () => {
    const r = buildCoachReport("此外此外综上所述。他握剑刺出。敌人倒下。");
    const w = r.dimensions.find((d) => d.key === "wasteWordRate")!;
    expect(w.issues.length).toBeGreaterThan(0);
  });

  it("传入角色名且分段时 PoV 检测不跳过且能识别视角跳变", () => {
    const r = buildCoachReport("张三走向门口。\n\n李四坐在桌前。\n\n张三回头看李四。", ["张三", "李四"]);
    const pov = r.dimensions.find((d) => d.key === "povConsistency")!;
    expect(pov.detail).not.toContain("跳过");
    expect(pov.issues.length).toBeGreaterThan(0);
  });

  it("scoreColor 阈值映射（红差绿好）", () => {
    expect(scoreColor(90)).toContain("#22C55E");
    expect(scoreColor(40)).toContain("#EF4444");
  });
});
