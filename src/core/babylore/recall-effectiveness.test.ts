/**
 * R6 判别测试 · 填表与长期记忆效果（先红 → 改 → 绿）
 *
 * 现有实现锚点：
 *  - `loop.ts:52` 召回项按 score 排序后 slice(0,12)，从不记录「注入后有没有被正文呼应」。
 *  - `recall.ts:22-26` 已有 via=keyword|semantic 标注，可用来分路径算命中。
 *  - `memory-decay.ts:30-35` DECAY_RULES S/A/B/C，但只在 cron 端点调用，写章时不联动。
 */
import { describe, expect, it } from "vitest";
import { computeRecallEffectiveness, rankRecallItemsWithDecay } from "./recall-effectiveness";

const items = [
  { source: "table" as const, title: "李富贵", content: "账房管事，左眉有疤", score: 3, via: "keyword" as const },
  { source: "lorebook" as const, title: "青龙镇", content: "北临渡口，每逢雨夜封街", score: 4, via: "semantic" as const },
  { source: "table" as const, title: "子虚乌有城", content: "从未出现过的地名", score: 6, via: "keyword" as const },
];

describe("R6 · 召回命中率（终于有数了）", () => {
  it("正文呼应了 2 条、漏了 1 条，命中率与明细都对", () => {
    const r = computeRecallEffectiveness(items, "李富贵走进青龙镇时，雨刚停。");
    expect(r.total).toBe(3);
    expect(r.hits).toBe(2);
    expect(r.hitRate).toBeCloseTo(2 / 3, 3);
    expect(r.misses.map((m) => m.title)).toEqual(["子虚乌有城"]);
  });

  it("按召回路径分组归因：keyword / semantic 各自命中数", () => {
    const r = computeRecallEffectiveness(items, "李富贵走进青龙镇时，雨刚停。");
    expect(r.byPath.keyword).toEqual({ total: 2, hits: 1 });
    expect(r.byPath.semantic).toEqual({ total: 1, hits: 1 });
  });

  it("空召回不炸，命中率 0", () => {
    const r = computeRecallEffectiveness([], "任意正文");
    expect(r.total).toBe(0);
    expect(r.hitRate).toBe(0);
  });

  it("只认标题/内容里的实词，不被单字误命中", () => {
    const r = computeRecallEffectiveness([items[2]], "子虚乌有");
    expect(r.hits).toBe(0); // 标题「子虚乌有城」未完整出现
  });
});

describe("R6 · 长期记忆衰减联动排序（写章时生效）", () => {
  const aged = [
    { title: "近期设定", score: 3, chapterNumber: 9, tier: "A" },
    { title: "陈旧设定", score: 5, chapterNumber: 1, tier: "B" },
    { title: "永久设定", score: 2, chapterNumber: 1, tier: "S" },
  ];

  it("陈旧 B 级记忆权重低于近期 A 级（虽 score 更高）", () => {
    const ranked = rankRecallItemsWithDecay(aged as any, 10);
    const idxNear = ranked.findIndex((r) => r.title === "近期设定");
    const idxOld = ranked.findIndex((r) => r.title === "陈旧设定");
    expect(idxNear).toBeLessThan(idxOld);
  });

  it("S 级永久记忆不因章数久远被降权", () => {
    const ranked = rankRecallItemsWithDecay(aged as any, 100);
    const s = ranked.find((r) => r.title === "永久设定") as any;
    expect(s.decayWeight).toBe(1);
  });

  it("权重夹在 (0,1]，不产生 0 或负数导致排序失真", () => {
    for (const age of [0, 1, 15, 30, 100, 10000]) {
      const ranked = rankRecallItemsWithDecay(aged as any, age + 1);
      for (const r of ranked as any[]) {
        expect(r.decayWeight).toBeGreaterThan(0);
        expect(r.decayWeight).toBeLessThanOrEqual(1);
      }
    }
  });

  it("排序稳定：同输入同输出，且返回新数组不改原数组", () => {
    const a = rankRecallItemsWithDecay(aged as any, 10).map((r) => r.title);
    const b = rankRecallItemsWithDecay(aged as any, 10).map((r) => r.title);
    expect(a).toEqual(b);
    expect(aged[0].title).toBe("近期设定");
  });
});
