import { describe, it, expect, vi } from "vitest";

// 阶段 C1 判别测试：同一 (subject, attribute) 积累多版事实时，
// 基线只注入最新/最可信的一条，旧条**保留在库里不删除**（历史可追溯）。
// 不改 schema、不引图数据库——用现有 createdAt / confidence / source 三个字段即可。

vi.mock("@/lib/prisma", () => ({
  prisma: {
    consistencyFact: {
      findMany: vi.fn(async () => [
        {
          id: "f1", projectId: "p", category: "character",
          subject: "李富贵", attribute: "身份", value: "青龙镇账房",
          source: "第一章", confidence: 0.9, createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "f2", projectId: "p", category: "character",
          subject: "李富贵", attribute: "身份", value: "杀人凶手",
          source: "第九章", confidence: 0.9, createdAt: new Date("2026-03-01T00:00:00Z"),
        },
        {
          id: "f3", projectId: "p", category: "world",
          subject: "青龙镇", attribute: "位置", value: "东境",
          source: "第一章", confidence: 0.8, createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ]),
    },
    chapterSummary: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/core/llm/client", () => ({ completeText: vi.fn() }));

import {
  collapseSupersededFacts,
  getConsistencyBaselineReport,
} from "@/core/consistency/extractFacts";

type F = {
  subject: string;
  attribute: string;
  value: string;
  source: string;
  confidence: number;
  createdAt?: Date | string | null;
};

function f(partial: Partial<F> & Pick<F, "value">): F {
  return {
    subject: "李富贵",
    attribute: "身份",
    source: "第一章",
    confidence: 0.9,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  };
}

describe("collapseSupersededFacts · 纯函数", () => {
  it("同键两版 → 只留 createdAt 更新的那条，supersededCount=1", () => {
    const r = collapseSupersededFacts([
      f({ value: "青龙镇账房", createdAt: new Date("2026-01-01") }),
      f({ value: "杀人凶手", createdAt: new Date("2026-03-01") }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].value).toBe("杀人凶手");
    expect(r.supersededCount).toBe(1);
  });

  it("不同 attribute → 互不覆盖，全部保留", () => {
    const r = collapseSupersededFacts([
      f({ value: "账房" }),
      f({ value: "左腿有旧伤", attribute: "伤势" }),
    ]);
    expect(r.kept).toHaveLength(2);
    expect(r.supersededCount).toBe(0);
  });

  it("作者手填（source=manual）优先级最高，绝不被自动事实顶掉", () => {
    const r = collapseSupersededFacts([
      f({ value: "作者钦定", source: "manual", createdAt: new Date("2025-01-01") }),
      f({ value: "模型后抽", source: "第九章", createdAt: new Date("2026-09-01") }),
    ]);
    expect(r.kept[0].value).toBe("作者钦定");
  });

  it("时间相同 → confidence 高者胜；全同 → 保守保留先到的（行为可预测）", () => {
    const same = new Date("2026-01-01");
    expect(collapseSupersededFacts([
      f({ value: "低置信", confidence: 0.5, createdAt: same }),
      f({ value: "高置信", confidence: 0.95, createdAt: same }),
    ]).kept[0].value).toBe("高置信");
    expect(collapseSupersededFacts([
      f({ value: "先到", createdAt: same }),
      f({ value: "后到", createdAt: same }),
    ]).kept[0].value).toBe("先到");
  });

  it("key 大小写/首尾空白归一，同义键照样合并", () => {
    const r = collapseSupersededFacts([
      f({ value: "甲", subject: " 李富贵 ", attribute: "身份" }),
      f({ value: "乙", subject: "李富贵", attribute: " 身份 ", createdAt: new Date("2026-05-01") }),
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].value).toBe("乙");
  });

  it("无 createdAt 字段也不崩（老数据/测试夹具兼容）", () => {
    const r = collapseSupersededFacts([
      { subject: "A", attribute: "x", value: "1", source: "", confidence: 1 },
      { subject: "A", attribute: "x", value: "2", source: "", confidence: 1 },
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].value).toBe("1");
  });
});

describe("getConsistencyBaselineReport · 集成（baseline 红 → 绿）", () => {
  it("基线文本不含过期值、含新值，report 给出 supersededFactCount", async () => {
    const r = await getConsistencyBaselineReport("p");
    expect(r.text).toContain("杀人凶手");
    expect(r.text).not.toContain("青龙镇账房");
    expect(r.supersededFactCount).toBe(1);
    // 旧事实仍在 facts 里（只不注入，不删历史）
    expect(r.facts.some((x: any) => x.value === "青龙镇账房")).toBe(true);
  });

  it("droppedFactCount 语义不变：只算「摘要内已含」的剔除", async () => {
    const r = await getConsistencyBaselineReport("p");
    expect(r.droppedFactCount).toBe(0); // mock 的摘要为空
  });
});
