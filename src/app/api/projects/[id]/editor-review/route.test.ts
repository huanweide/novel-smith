import { describe, it, expect, vi, beforeEach } from "vitest";

// 模拟编辑审稿路由：mock prisma 取章节 + mock LLM 调用（不真调模型）。
const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  storyNode: { findMany: vi.fn(), findFirst: vi.fn() },
}));
const reviewMock = vi.hoisted(() => ({ runEditorReview: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/editor/review", () => ({ runEditorReview: reviewMock.runEditorReview }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: any, init?: any) => ({ payload, status: init?.status ?? 200 }),
  },
}));

import { POST } from "./route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const makeReq = (body: any) => ({ json: async () => body }) as any;

const SAMPLE = {
  overall: "整体可投",
  verdict: "可投但需打磨",
  dimensions: [{ key: "hook", label: "开头钩子", score: 70, comment: "ok" }],
  suggestions: [
    { chapterRef: "章1", location: "开头", issue: "慢", severity: "high", suggestion: "加速", rewriteHint: "删环境描写" },
  ],
  promptForTune: "微调指令示例",
};

describe("POST /api/projects/[id]/editor-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.project.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.storyNode.findMany.mockResolvedValue([
      { id: "n1", order: 0, title: "第一章", content: "正文一" },
      { id: "n2", order: 1, title: "第二章", content: "正文二" },
    ]);
    prismaMock.storyNode.findFirst.mockResolvedValue({ id: "n1", order: 0, title: "第一章", content: "正文一" });
    reviewMock.runEditorReview.mockResolvedValue(SAMPLE);
  });

  it("提示词为空返回 400", async () => {
    const res: any = await POST(makeReq({ platform: "fanqie", role: "fanqie", systemPrompt: "" }), makeParams("p1"));
    expect(res.status).toBe(400);
  });

  it("项目不存在返回 404", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    const res: any = await POST(makeReq({ platform: "fanqie", role: "fanqie", systemPrompt: "x" }), makeParams("x"));
    expect(res.status).toBe(404);
  });

  it("最近N章：只取末尾N章送审并拿到结构化结果", async () => {
    const res: any = await POST(
      makeReq({ platform: "qidian", role: "qidian", systemPrompt: "你是编辑", scope: { mode: "recent", count: 5 } }),
      makeParams("p1"),
    );
    expect(res.status).toBe(200);
    expect(reviewMock.runEditorReview).toHaveBeenCalledOnce();
    const arg = reviewMock.runEditorReview.mock.calls[0][0];
    expect(arg.chapters).toHaveLength(2);
    expect(arg.chapters[0].ref).toBe("章1");
    expect(arg.roleId).toBe("qidian");
    expect(res.payload.overall).toBe("整体可投");
    expect(res.payload.meta.reviewedChapters).toBe(2);
  });

  it("单章模式取指定节点", async () => {
    const res: any = await POST(
      makeReq({ platform: "fanqie", role: "fanqie", systemPrompt: "x", scope: { mode: "single", nodeId: "n1" } }),
      makeParams("p1"),
    );
    expect(res.status).toBe(200);
    const arg = reviewMock.runEditorReview.mock.calls[0][0];
    expect(arg.chapters).toHaveLength(1);
    expect(arg.chapters[0].nodeId).toBe("n1");
  });

  it("LLM 调用失败返回 502 且透出错误", async () => {
    reviewMock.runEditorReview.mockRejectedValue(new Error("模型无响应"));
    const res: any = await POST(
      makeReq({ platform: "fanqie", role: "fanqie", systemPrompt: "x", scope: { mode: "recent", count: 5 } }),
      makeParams("p1"),
    );
    expect(res.status).toBe(502);
    expect(res.payload.error).toContain("模型无响应");
  });
});
