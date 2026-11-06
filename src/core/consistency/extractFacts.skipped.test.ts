import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractConsistencyFacts } from "./extractFacts";

// 隔离 DB 与 LLM：mock 掉 prisma 与 completeText，验证「抽空不清空历史」的守卫
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    consistencyFact: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}));
vi.mock("@/core/llm/client", () => ({
  completeText: vi.fn(),
}));

import { completeText } from "@/core/llm/client";
import { prisma } from "@/lib/prisma";

const fakeProject = (summaries: unknown[]) => ({
  id: "p1",
  name: "测试",
  synopsis: "",
  globalPrompt: "",
  chapterSummaries: summaries,
  characters: [],
});

describe("extractConsistencyFacts · 空响应守卫（多章连贯稳定性）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.project.findUnique as any).mockResolvedValue(fakeProject([
      { chapterId: "c1", chapterTitle: "第1章", summary: "林砚今年28岁，外卖骑手" },
    ]));
  });

  it("LLM 返回空 → 跳过清空，保留既有基线（不得 deleteMany）", async () => {
    // 模拟抽空：超时 / 返回空 / 解析失败
    (completeText as any).mockResolvedValue("");

    const res = await extractConsistencyFacts("p1");

    expect(res.skipped).toBe(true);
    expect(res.count).toBe(0);
    // 关键断言：没有执行「先清后插」的清空动作，前几章累积的事实得以保留
    expect(prisma.consistencyFact.deleteMany).not.toHaveBeenCalled();
    expect(prisma.consistencyFact.createMany).not.toHaveBeenCalled();
  });

  it("LLM 返回非法 JSON（解析为空）→ 同样跳过清空", async () => {
    (completeText as any).mockResolvedValue("模型抽风，不是 json 的乱码 [abc");

    const res = await extractConsistencyFacts("p1");

    expect(res.skipped).toBe(true);
    expect(prisma.consistencyFact.deleteMany).not.toHaveBeenCalled();
  });

  it("LLM 正常返回 → 仍走幂等清空重建（既有行为不变）", async () => {
    (completeText as any).mockResolvedValue(JSON.stringify([
      { category: "character", subject: "林砚", attribute: "年龄", value: "28岁", source: "第1章" },
    ]));

    const res = await extractConsistencyFacts("p1");

    expect(res.skipped).toBeUndefined();
    expect(res.count).toBe(1);
    expect(prisma.consistencyFact.deleteMany).toHaveBeenCalledWith({
      where: { projectId: "p1", source: { not: "manual" } },
    });
    expect(prisma.consistencyFact.createMany).toHaveBeenCalled();
  });
});
