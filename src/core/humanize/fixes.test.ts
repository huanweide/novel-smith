// ============================================================
// 去 AI 味 · 「一键套用」执行层回归测试
// ============================================================
//
// 这层代码一旦算错下标，后果不是报错，而是**静悄悄改坏稿子**——
// 作者根本发现不了。所以每条契约都必须硬化成断言，尤其这几条：
//  1. 多段文本里删除的位置必须精准（段内下标 vs 全文下标那个坑）
//  2. 删词必须连带吞掉紧跟的逗号 / 「地」，不许留下病句
//  3. 同时改多处时，前面的改动不能让后面的位置错位
//  4. 没有 fix 的命中一律不许碰（机器不做作者的审美决定）

import { describe, it, expect } from "vitest";
import { applyFixes, countFixable, deletionFix, replacementFix } from "./fixes";
import { detectAiVocab, detectDashOveruse, detectParenOveruse } from "./rules";
import { analyzeText } from "./index";
import type { AiTraceHit } from "./types";

/** 造一条不带 fix 的命中，用来验证「不该动的不能动」 */
function plainHit(start: number, end: number): AiTraceHit {
  return {
    ruleId: "manual",
    ruleName: "手工",
    severity: "low",
    excerpt: "",
    start,
    end,
    reason: "",
    suggestion: "",
  };
}

describe("deletionFix —— 吞尾巴符号", () => {
  it("删值得关注的是时连逗号一起吞，不留句首孤零零的逗号", () => {
    const text = "值得注意的是，他推门进来了。";
    const i = text.indexOf("值得注意的是");
    const fix = deletionFix(text, i, i + "值得注意的是".length);
    expect(fix.start).toBe(i);
    expect(fix.end).toBe(i + "值得注意的是".length + 1); // 多吞一个「，」
    expect(applyFixes(text, [plainHit(i, i + 6)])).toEqual({ text, applied: 0, skipped: 0 });
  });

  it("删情不自禁时连「地」一起吞，不留「她地笑了」", () => {
    const text = "她情不自禁地笑了。";
    const hits = detectAiVocab(text);
    expect(hits).toHaveLength(1);
    expect(applyFixes(text, hits).text).toBe("她笑了。");
  });

  it("吞尾最多 4 个字符，不会一口气吃掉半句话", () => {
    const text = "综上所述，，，，他走了。";
    const i = text.indexOf("综上所述");
    const fix = deletionFix(text, i, i + 4);
    expect((fix.end ?? 0) - (fix.start ?? 0)).toBeLessThanOrEqual(4 + 4);
  });

  it("吞尾遇到正常字符立刻停手，不会吃掉正文", () => {
    const text = "这一刻他明白了。";
    const hits = detectAiVocab(text);
    expect(applyFixes(text, hits).text).toBe("他明白了。");
  });

  it("带 offset 时返回的是全文下标", () => {
    // 模拟段落级规则：段落从第 100 个字符开始
    const fix = deletionFix("综上所述，完了。", 0, 4, 100);
    expect(fix.start).toBe(100);
    expect(fix.end).toBe(105); // 4 字 + 一个逗号
  });
});

describe("applyFixes —— 位置正确性", () => {
  it("多处同时改，前面的删改不会让后面的位置错位", () => {
    const text = "值得注意的是，他来了。综上所述，他走了。一言以蔽之，结束了。";
    const hits = detectAiVocab(text);
    expect(countFixable(hits)).toBe(3);
    const r = applyFixes(text, hits);
    expect(r.applied).toBe(3);
    expect(r.text).toBe("他来了。他走了。结束了。");
  });

  it("「宛如」替换成「像」而不是删除", () => {
    const text = "月光宛如一层薄纱，落在新雪上。";
    const hits = detectAiVocab(text);
    expect(applyFixes(text, hits).text).toBe("月光像一层薄纱，落在新雪上。");
  });

  it("破折号按规则建议换成逗号", () => {
    // 重复字的 200 字门槛：detectDashOveruse 对短文本不判，这里必须够长才出命中
    const dashText = "甲".repeat(80) + "——" + "乙".repeat(80) + "——" + "丙".repeat(80);
    const hits = detectDashOveruse(dashText);
    expect(hits.length).toBeGreaterThan(0);
    const r = applyFixes(dashText, hits);
    expect(r.applied).toBeGreaterThan(0);
    expect(r.text).not.toContain("——");
    expect(r.text).toContain("，");
  });

  it("括号过度时删掉的是整对括号，不含糊", () => {
    const text = "他带了三样东西（一把刀、一根绳、一盏灯）上路（还带了水）。确实如此（认真的）。";
    const hits = detectParenOveruse(text);
    expect(hits.length).toBeGreaterThan(0);
    const r = applyFixes(text, hits);
    expect(r.text).not.toContain("（");
    expect(r.text).not.toContain("）");
  });

  it("区间重叠时只改一处，绝不叠加改动把原文搅烂", () => {
    const hits: AiTraceHit[] = [
      { ...plainHit(3, 8), fix: replacementFix("A", "A") },
      { ...plainHit(5, 10), fix: replacementFix("B", "B") },
    ];
    const r = applyFixes("0123456789", hits);
    expect(r.applied).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.text).not.toContain("AB");
  });

  it("没有 fix 的命中一个字都不许动", () => {
    const text = "心头一紧，他说不出话。";
    const hits = detectAiVocab(text);
    expect(countFixable(hits)).toBe(0);
    const r = applyFixes(text, hits);
    expect(r.text).toBe(text);
    expect(r.applied).toBe(0);
  });

  it("越界或空区间的修复被丢弃，不会抛错也不会改坏", () => {
    const bad: AiTraceHit[] = [
      { ...plainHit(0, 3), fix: { replacement: "", start: -5, end: 3, label: "负下标" } },
      { ...plainHit(7, 7), fix: deletionFix("0123456789", 7, 7) },
      { ...plainHit(0, 5), fix: { replacement: "X", start: 0, end: 999, label: "越过文末" } },
    ];
    const r = applyFixes("0123456789", bad);
    expect(r.applied).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.text).toBe("0123456789");
  });

  it("fix 显式给了区间就以 fix 为准，不跟着命中片段走", () => {
    // 删词要连带吞掉后面的逗号，靠的就是 fix.end 比 hit.end 大
    const hit: AiTraceHit = { ...plainHit(2, 5), fix: { replacement: "", start: 2, end: 6, label: "吞逗号" } };
    expect(applyFixes("甲乙丙丁戊，己庚", [hit]).text).toBe("甲乙己庚");
  });

  it("空文本直接原样返回，不做无意义的拼接", () => {
    expect(applyFixes("", detectAiVocab(""))).toEqual({ text: "", applied: 0, skipped: 0 });
  });
});

describe("端到端：套用之后 AI 痕迹分必须下降", () => {
  it("典型 AI 腔文本一键套用后，分数下降且不留病句", () => {
    const before =
      "综上所述，不难发现这是一段机器味很重的文字。值得注意的是，他情不自禁地抬起头，不由得握紧了拳头。" +
      "从某种意义上说，这扇门不太容易推开——门轴锈了——门板也裂了。这一刻，他下意识地后退半步。";
    const reportBefore = analyzeText(before);
    const fixable = countFixable(reportBefore.hits);
    expect(fixable).toBeGreaterThan(0);

    const after = applyFixes(before, reportBefore.hits);
    expect(after.applied).toBe(fixable);

    // 不许留下句首孤零零的逗号，也不许出现「她地」这种残骸
    expect(after.text).not.toMatch(/^，/);
    expect(after.text).not.toContain("，他其中");
    expect(after.text).not.toContain("地说");

    // 套用后被消灭的词不该再出现在正文里
    expect(after.text).not.toContain("综上所述");
    expect(after.text).not.toContain("不难发现");
    expect(after.text).not.toContain("值得注意的是");
    expect(after.text).not.toContain("情不自禁");
    expect(after.text).not.toContain("不由得");

    const reportAfter = analyzeText(after.text);
    expect(reportAfter.score).toBeLessThan(reportBefore.score);
  });

  it("多段落场景下 position 依然精准（段内下标换算成全文下标）", () => {
    const p1 = "窗外的雨下得很急。";
    const p2 = "综上所述，他决定今天就走。";
    const full = `${p1}\n\n${p2}`;
    const rep = analyzeText(full);
    const after = applyFixes(full, rep.hits);
    expect(after.text).toContain(p1); // 第一段完好无损
    expect(after.text).not.toContain("综上所述");
    expect(after.text).toContain("他决定今天就走。");
  });

  it("重复套用不会把正文越改越短（幂等）", () => {
    const before = "综上所述，他来了。简而言之，他走了。";
    const r1 = applyFixes(before, analyzeText(before).hits);
    const r2 = applyFixes(r1.text, analyzeText(r1.text).hits);
    expect(r2.applied).toBe(0);
    expect(r2.text).toBe(r1.text);
  });
});
