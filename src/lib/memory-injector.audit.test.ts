import { describe, it, expect } from "vitest";
import { analyzeMemoryInjection, injectOptimizedMemory, DEFAULT_BUDGET } from "./memory-injector";
import type { TieredMemory } from "./memory-classifier";

// 测试用 tokenizer：中文按字符数，稳定可复现，不依赖真实分词器
const countTokens = (s: string) => Array.from(s).length;

const ev = (content: string, importance: "critical" | "high" | "medium" = "medium", ch?: number) => ({
  content, importance, source: "chapter_summary" as const, chapterNumber: ch,
});

const tm = (over: Partial<TieredMemory> = {}): TieredMemory => ({
  sTier: [], aTier: [], bTier: [], ...over,
});

describe("analyzeMemoryInjection · 只读诊断旁路", () => {
  it("注入文本与 injectOptimizedMemory 逐字一致（不改动生成链路）", () => {
    const memory = tm({
      sTier: [ev("【核心角色·李富贵】雨夜收下账册成为关键转折", "critical", 3)],
      aTier: [ev("第5章 赵六在青龙镇交出钥匙", "high", 5)],
    });
    const d = analyzeMemoryInjection(memory, "", DEFAULT_BUDGET, countTokens);
    const real = injectOptimizedMemory(memory, "", DEFAULT_BUDGET, countTokens);
    expect(d.injectedText).toBe(real);
  });

  it("与最近上下文重复的事件归因为 dedup_dropped", () => {
    // 必须 >=30 字符：策略3 用 30 字符滑动窗口比对，短事件不进循环（见下一条边界测试）
    const line = "李富贵在雨夜收下那本沾了泥的账册，随后离开了青龙镇，此后再没有人见过他出现在镇上";
    expect(line.length).toBeGreaterThanOrEqual(30);
    const memory = tm({ aTier: [ev(line, "high", 3)] });
    const d = analyzeMemoryInjection(memory, `前文：${line}`, DEFAULT_BUDGET, countTokens);
    expect(d.dropped.length).toBe(1);
    expect(d.dropped[0].reason).toBe("dedup_dropped");
  });

  it("如实反映策略3 边界：短于 30 字符的重复事件不会被去重", () => {
    // 这是 injectOptimizedMemory 的真实行为（滑动窗口循环条件 i <= len-30），
    // 诊断旁路不得把它包装成「已去重」，否则会误导排查。
    const short = "李富贵收下账册后离开";
    const memory = tm({ aTier: [ev(short, "high", 3)] });
    const d = analyzeMemoryInjection(memory, `前文：${short}`, DEFAULT_BUDGET, countTokens);
    expect(d.dropped.length).toBe(0);
    expect(d.injectedText).toContain("李富贵收下账册后离开");
  });

  it("超预算被静默丢弃的事件归因为 budget_truncated 并可见", () => {
    // 极小预算：S 级占 40%，只够 header，后续条目全被截断
    const tiny = { maxTokens: 20, sTierRatio: 0.4, aTierRatio: 0.4, bTierRatio: 0.2 };
    const memory = tm({
      sTier: [
        ev("【核心角色·甲】第一章发生了一件极其重要的事情导致主线转折", "critical", 1),
        ev("【核心角色·乙】第二章发生了一件极其重要的事情导致主线转折", "critical", 2),
        ev("【核心角色·丙】第三章发生了一件极其重要的事情导致主线转折", "critical", 3),
      ],
    });
    const d = analyzeMemoryInjection(memory, "", tiny, countTokens);
    expect(d.dropped.length).toBeGreaterThan(0);
    expect(d.dropped.every((x) => x.reason === "budget_truncated")).toBe(true);
    expect(d.dropped[0].tier).toBe("S");
  });

  it("分级计数自洽：injected + dropped = total", () => {
    const memory = tm({
      sTier: [ev("【核心角色·甲】关键转折一", "critical", 1), ev("【核心角色·乙】关键转折二", "critical", 2)],
      aTier: [ev("第5章 赵六交出钥匙", "high", 5)],
      bTier: [ev("第9章 王五离城", "medium", 9)],
    });
    const d = analyzeMemoryInjection(memory, "", DEFAULT_BUDGET, countTokens);
    const total = (["S", "A", "B"] as const).reduce((n, t) => n + d.byTier[t].total, 0);
    const injected = (["S", "A", "B"] as const).reduce((n, t) => n + d.byTier[t].injected, 0);
    expect(injected).toBe(d.injectedCount);
    expect(injected + d.dropped.length).toBe(total);
  });

  it("空记忆不报错且返回空文本", () => {
    const d = analyzeMemoryInjection(tm(), "", DEFAULT_BUDGET, countTokens);
    expect(d.injectedText).toBe("");
    expect(d.dropped).toEqual([]);
    expect(d.injectedCount).toBe(0);
  });
});
