import { describe, it, expect, vi, beforeEach } from "vitest";

// 三个副作用依赖全部 mock：prisma（避免真实数据库）、getSettings、
// embedding（避免真实网络）。本测试只验证组装逻辑与脏数据防御。
const mockFindMany = vi.fn();
const mockEmbedOne = vi.fn();
const mockGetSettings = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: { lorebookEntry: { findMany: (...a: unknown[]) => mockFindMany(...a) } } }));
vi.mock("@/lib/llm", () => ({ getSettings: () => mockGetSettings() }));
vi.mock("@/core/llm/embedding", () => ({
  embedOne: (...a: unknown[]) => mockEmbedOne(...a),
  isEmbeddingConfigured: (c: { provider: string; apiKey: string; baseUrl: string }) =>
    c.provider === "local" ? Boolean(c.baseUrl) : Boolean(c.apiKey && c.apiKey.trim() && c.baseUrl),
}));

const { buildSemanticHints, parseEmbedding } = await import("./semantic-recall");

const OK_SETTINGS = { provider: "siliconflow", apiKey: "sk-t", model: "m", baseUrl: "https://x/v1" };

describe("parseEmbedding —— 库里的 Json 还原成向量", () => {
  it("正常数组原样返回", () => {
    expect(parseEmbedding([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });

  it("非数组（null/对象/字符串）→ null", () => {
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding(undefined)).toBeNull();
    expect(parseEmbedding({ a: 1 })).toBeNull();
    expect(parseEmbedding("0.1")).toBeNull();
    expect(parseEmbedding(123)).toBeNull();
  });

  it("空数组 → null", () => {
    expect(parseEmbedding([])).toBeNull();
  });

  it("含非数字项 → null（脏数据整条判为不可比）", () => {
    expect(parseEmbedding([0.1, "x"])).toBeNull();
    expect(parseEmbedding([0.1, null])).toBeNull();
    expect(parseEmbedding([0.1, NaN])).toBeNull();
    expect(parseEmbedding([0.1, Infinity])).toBeNull();
  });
});

describe("buildSemanticHints —— 前置条件不满足就退回", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue(OK_SETTINGS);
  });

  it("正文为空 → null", async () => {
    await expect(buildSemanticHints("", "p1")).resolves.toBeNull();
    await expect(buildSemanticHints("   ", "p1")).resolves.toBeNull();
  });

  it("无 projectId → null", async () => {
    await expect(buildSemanticHints("正文", "")).resolves.toBeNull();
  });

  it("没配 embedding key → null，且不发网络请求", async () => {
    mockGetSettings.mockResolvedValue({ provider: "siliconflow", apiKey: "", model: "m", baseUrl: "https://x" });
    mockEmbedOne.mockResolvedValue([1, 0]);
    await expect(buildSemanticHints("正文", "p1")).resolves.toBeNull();
    expect(mockEmbedOne).not.toHaveBeenCalled();
  });

  it("没有任何已回填的条目 → null（还没补清单，退回关键词）", async () => {
    mockFindMany.mockResolvedValue([]);
    await expect(buildSemanticHints("正文", "p1")).resolves.toBeNull();
  });

  it("正文向量化失败 → null（接口挂了不能影响写作）", async () => {
    mockFindMany.mockResolvedValue([{ id: "1", title: "甲", content: "甲", embedding: [1, 0] }]);
    mockEmbedOne.mockResolvedValue(null);
    await expect(buildSemanticHints("正文", "p1")).resolves.toBeNull();
  });
});

describe("buildSemanticHints —— 正常组装", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue(OK_SETTINGS);
  });

  it("候选与相似度等长同序", async () => {
    mockFindMany.mockResolvedValue([
      { id: "1", title: "甲", content: "甲内容", embedding: [1, 0] },
      { id: "2", title: "乙", content: "乙内容", embedding: [0, 1] },
    ]);
    mockEmbedOne.mockResolvedValue([1, 0]);

    const hints = await buildSemanticHints("正文", "p1");
    expect(hints).not.toBeNull();
    expect(hints!.candidates).toHaveLength(2);
    expect(hints!.similarities).toHaveLength(2);
    expect(hints!.candidates[0].title).toBe("甲");
    // 甲与查询同向 → 接近 1；乙正交 → 接近 0
    expect(hints!.similarities[0] as number).toBeCloseTo(1, 5);
    expect(hints!.similarities[1] as number).toBeCloseTo(0, 5);
  });

  it("★ 核心场景：字面不同但意思相同 → 相似度够高", async () => {
    // 正文「叛变北境的将军」与设定「北境守将·曾率部倒戈」方向接近
    mockFindMany.mockResolvedValue([
      { id: "1", title: "北境守将", content: "曾率部倒戈", embedding: [0.85, 0.15, 0.18] },
      { id: "2", title: "茶馆老板", content: "卖馄饨", embedding: [0.0, 1.0, 0.0] },
    ]);
    mockEmbedOne.mockResolvedValue([0.9, 0.1, 0.2]);

    const hints = await buildSemanticHints("那个叛变北境的将军", "p1");
    const hit = hints!.similarities[0] as number;
    const miss = hints!.similarities[1] as number;

    expect(hit).toBeGreaterThan(0.62); // 阈值之上 → 会被召回
    expect(miss).toBeLessThan(0.62); // 阈值之下 → 不召回
  });

  it("未回填（embedding 为 null）的条目相似度是 null，不是 0", async () => {
    mockFindMany.mockResolvedValue([
      { id: "1", title: "甲", content: "甲", embedding: null },
      { id: "2", title: "乙", content: "乙", embedding: [1, 0] },
    ]);
    mockEmbedOne.mockResolvedValue([1, 0]);

    const hints = await buildSemanticHints("正文", "p1");
    // null 与 0 必须区分：null=不可比，0=可比但不像
    expect(hints!.similarities[0]).toBeNull();
    expect(hints!.similarities[1]).not.toBeNull();
  });

  it("维度不一致的向量 → null（不可比，不是不像）", async () => {
    mockFindMany.mockResolvedValue([
      { id: "1", title: "甲", content: "甲", embedding: [1, 0, 0, 0] },
    ]);
    mockEmbedOne.mockResolvedValue([1, 0]);

    const hints = await buildSemanticHints("正文", "p1");
    expect(hints!.similarities[0]).toBeNull();
  });

  it("脏向量（含字符串）→ null，不崩", async () => {
    mockFindMany.mockResolvedValue([
      { id: "1", title: "甲", content: "甲", embedding: [1, "x"] },
    ]);
    mockEmbedOne.mockResolvedValue([1, 0]);

    const hints = await buildSemanticHints("正文", "p1");
    expect(hints!.similarities[0]).toBeNull();
  });

  it("查库抛异常 → 向上抛出，由调用方兜底（不在本层吞掉）", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    await expect(buildSemanticHints("正文", "p1")).rejects.toThrow("db down");
  });
});
