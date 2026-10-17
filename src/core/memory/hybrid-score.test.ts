import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  mixScore,
  acceptSemanticCandidate,
  DEFAULT_MIX_ALPHA,
  DEFAULT_SEMANTIC_THRESHOLD,
} from "./hybrid-score";

describe("cosineSimilarity —— 基础数学", () => {
  it("同向量相似度为 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("正交向量相似度为 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("反向向量相似度为 -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("缩放不改变余弦（方向相同即同分）", () => {
    // 余弦只看方向，向量整体放大 100 倍相似度不变
    expect(cosineSimilarity([1, 2, 3], [100, 200, 300])).toBeCloseTo(1, 10);
  });
});

describe("cosineSimilarity —— 脏数据必须判为不可比而非抛错", () => {
  it("空向量 → 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("null / undefined → 0", () => {
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], undefined)).toBe(0);
    expect(cosineSimilarity(null, null)).toBe(0);
  });

  it("维度不一致 → 0（宁可漏，不可错判为相关）", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("全零向量 → 0（除零保护）", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("含 NaN / Infinity → 0（脏数据不参与判定）", () => {
    expect(cosineSimilarity([NaN, 1], [1, 1])).toBe(0);
    expect(cosineSimilarity([Infinity, 1], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, NaN])).toBe(0);
  });
});

describe("mixScore —— 向后兼容是硬要求", () => {
  it("语义为 null（未向量化）时退化为纯关键词分，且不缩放", () => {
    // 这是最关键的一条：没配 embedding key 的项目，行为必须与改动前逐位一致
    expect(mixScore(10, null)).toBe(10);
    expect(mixScore(0, undefined)).toBe(0);
    expect(mixScore(7, null, 0.9)).toBe(7);
    expect(mixScore(7, null, 0)).toBe(7);
  });

  it("语义为 NaN 同样退化为纯关键词分", () => {
    expect(mixScore(10, NaN)).toBe(10);
    expect(mixScore(10, Infinity)).toBe(10);
  });

  it("关键词分为NaN 时按 0 处理，不产生 NaN 分数", () => {
    const s = mixScore(NaN, 0.8);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeCloseTo((1 - DEFAULT_MIX_ALPHA) * 0.8, 10);
  });

  it("有语义分时按权重线性混合", () => {
    expect(mixScore(10, 0.6, 0.4)).toBeCloseTo(0.4 * 10 + 0.6 * 0.6, 10);
    expect(mixScore(0, 0.9, 0.4)).toBeCloseTo(0.6 * 0.9, 10);
  });

  it("α=1 退化为纯关键词（语义权重为0）", () => {
    expect(mixScore(10, 0.2, 1)).toBeCloseTo(10, 10);
  });

  it("α=0 全看语义", () => {
    expect(mixScore(10, 0.7, 0)).toBeCloseTo(0.7, 10);
  });

  it("α 越界时被夹到 [0,1]，不产生异常分数", () => {
    expect(mixScore(10, 0.5, -5)).toBeCloseTo(0.5, 10); // α→0
    expect(mixScore(10, 0.5, 99)).toBeCloseTo(10, 10); // α→1
    expect(mixScore(10, 0.5, NaN)).toBe(mixScore(10, 0.5, DEFAULT_MIX_ALPHA));
  });

  it("相似度被夹到 [0,1]（负余弦不当成负分惩罚）", () => {
    expect(mixScore(0, -0.5, 0)).toBe(0);
    expect(mixScore(0, 1.5, 0)).toBe(1);
  });
});

describe("acceptSemanticCandidate —— 阈值把噪声挡在外面", () => {
  const base = { source: "lorebook" as const, title: "北境守将", content: "曾率部倒戈" };

  it("达标的候选被接受", () => {
    const r = acceptSemanticCandidate({ ...base, similarity: 0.8 });
    expect(r).not.toBeNull();
    expect(r!.title).toBe("北境守将");
  });

  it("v3.1.138：返回值带出原始 similarity（供 UI 显示「多像」）", () => {
    const r = acceptSemanticCandidate({ ...base, similarity: 0.8 });
    expect(r!.similarity).toBe(0.8);
  });

  it("不达标 → null（宁漏不污染上下文）", () => {
    expect(acceptSemanticCandidate({ ...base, similarity: 0.3 })).toBeNull();
  });

  it("正好等于阈值时接受（边界含等号）", () => {
    expect(acceptSemanticCandidate({ ...base, similarity: DEFAULT_SEMANTIC_THRESHOLD })).not.toBeNull();
    expect(acceptSemanticCandidate({ ...base, similarity: DEFAULT_SEMANTIC_THRESHOLD - 0.001 })).toBeNull();
  });

  it("NaN 相似度 → null，不当成 0 放过", () => {
    expect(acceptSemanticCandidate({ ...base, similarity: NaN })).toBeNull();
    expect(acceptSemanticCandidate({ ...base, similarity: Infinity })).toBeNull();
  });

  it("接受后的分数与关键词召回同量级（便于同一列表排序）", () => {
    const r = acceptSemanticCandidate({ ...base, similarity: 1 });
    // 纯语义召回时关键词分为 0，分数 = (1-α)×1 = 0.6
    expect(r!.score).toBeCloseTo(1 - DEFAULT_MIX_ALPHA, 10);
    expect(r!.score).toBeGreaterThan(0);
  });

  it("自定义阈值生效", () => {
    expect(acceptSemanticCandidate({ ...base, similarity: 0.5 }, 0.4)).not.toBeNull();
    expect(acceptSemanticCandidate({ ...base, similarity: 0.5 }, 0.6)).toBeNull();
  });

  it("阈值传NaN → 退回默认阈值，而非当作无限制", () => {
    // 退回默认（0.62）意味着 0.5 被拒。若误当成 0，脏阈值会放进来一堆噪声
    expect(acceptSemanticCandidate({ ...base, similarity: 0.5 }, NaN)).toBeNull();
    expect(acceptSemanticCandidate({ ...base, similarity: 0.9 }, NaN)).not.toBeNull();
  });
});

describe("端到端：关键词召不到但语义召得到（本次要解决的核心场景）", () => {
  it("「背叛主角的将军」vs「曾率部倒戈的北境守将」—— 语义能捞，关键词捞不到", () => {
    const queryVec = [0.9, 0.1, 0.2];
    const entryVec = [0.85, 0.15, 0.18];
    const entryVecUnrelated = [0.0, 1.0, 0.0];

    const hit = cosineSimilarity(queryVec, entryVec);
    const miss = cosineSimilarity(queryVec, entryVecUnrelated);

    expect(hit).toBeGreaterThan(DEFAULT_SEMANTIC_THRESHOLD);
    expect(miss).toBeLessThan(DEFAULT_SEMANTIC_THRESHOLD);

    expect(acceptSemanticCandidate({ source: "lorebook", title: "北境守将", content: "曾率部倒戈", similarity: hit })).not.toBeNull();
    expect(acceptSemanticCandidate({ source: "lorebook", title: "茶馆老板", content: "卖馄饨", similarity: miss })).toBeNull();
  });
});