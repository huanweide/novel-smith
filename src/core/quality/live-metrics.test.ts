/**
 * R5 判别测试 · 实时演算（先红 → 改 → 绿）
 *
 * 落点：`write-generation.ts:304` 已有「每积累 ~200 字符扫描一次」hook，
 * 本轮把它从「只查违禁词」扩成「增量演算」，不新增 LLM 调用、不动章末富化同步。
 */
import { describe, expect, it } from "vitest";
import { computeLiveMetrics } from "./live-metrics";

const text = `李富贵推开门，雨还没停。
"账册呢？"他问。
赵六把油纸包推过来，指节发白。青龙镇的更鼓敲了三下，远处有人在喊。
他没有立刻去接。`;

describe("R5 · 增量指标（纯本地，零 token）", () => {
  it("能算出字数、段落数、对话占比", () => {
    const m = computeLiveMetrics(text, {});
    expect(m.wordCount).toBeGreaterThan(20);
    expect(m.paragraphCount).toBe(4);
    expect(m.dialogueRatio).toBeGreaterThan(0);
    expect(m.dialogueRatio).toBeLessThan(1);
  });

  it("一致性事实命中：正文里出现的设定名被计中，未出现的不算", () => {
    const m = computeLiveMetrics(text, { factSubjects: ["李富贵", "青龙镇", "子虚乌有城"] });
    expect(m.factHits).toBe(2);
    expect(m.factMisses).toEqual(["子虚乌有城"]);
  });

  it("违禁词命中可计数（复用既有扫描结果，不重复实现扫描器）", () => {
    const m = computeLiveMetrics(text, { forbiddenMatches: [{ pattern: "雨" }, { pattern: "雨" }] });
    expect(m.forbiddenHits).toBe(2);
  });

  it("节奏：长段落占比可算，用于提示「一段太闷」", () => {
    const long = "甲".repeat(400);
    const m = computeLiveMetrics(`${long}\n\n短句。`, {});
    expect(m.longParagraphRatio).toBeGreaterThan(0);
    expect(m.pacingHint).toBeTruthy();
  });

  it("空文本不炸、全零", () => {
    const m = computeLiveMetrics("", {});
    expect(m.wordCount).toBe(0);
    expect(m.paragraphCount).toBe(0);
    expect(m.factHits).toBe(0);
  });

  it("同输入同输出（流式增量可复现）", () => {
    expect(computeLiveMetrics(text, { factSubjects: ["李富贵"] })).toEqual(
      computeLiveMetrics(text, { factSubjects: ["李富贵"] }),
    );
  });
});
