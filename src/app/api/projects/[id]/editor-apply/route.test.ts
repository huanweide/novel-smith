import { describe, it, expect, vi, beforeEach } from "vitest";

// 应用修改路由：mock prisma + mock LLM 改写 + mock 版本快照（不真调模型、不真写库）。
const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  storyNode: { findUnique: vi.fn(), update: vi.fn() },
}));
const reviewMock = vi.hoisted(() => ({ runEditorApply: vi.fn() }));
const versionsMock = vi.hoisted(() => ({ snapshotRevision: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/editor/review", () => ({ runEditorApply: reviewMock.runEditorApply }));
vi.mock("@/lib/versions", () => ({ snapshotRevision: versionsMock.snapshotRevision }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: any, init?: any) => ({ payload, status: init?.status ?? 200 }),
  },
}));

import { POST } from "./route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const makeReq = (body: any) => ({ json: async () => body }) as any;

const SUG = [{ location: "第2段", issue: "拖沓", suggestion: "精简", rewriteHint: "合并两句" }];

describe("POST /api/projects/[id]/editor-apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.project.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.storyNode.findUnique.mockResolvedValue({
      id: "n1",
      projectId: "p1",
      content: "原文正文".repeat(50),
      wordCount: 200,
      editVersion: 1,
      deletedAt: null,
      title: "第一章",
      reviewLogs: [],
    });
    prismaMock.storyNode.update.mockResolvedValue({ id: "n1", wordCount: 210 });
    reviewMock.runEditorApply.mockResolvedValue("改写后的正文".repeat(50));
    versionsMock.snapshotRevision.mockResolvedValue(undefined);
  });

  it("空 items 返回 400", async () => {
    const res: any = await POST(makeReq({ items: [] }), makeParams("p1"));
    expect(res.status).toBe(400);
  });

  it("项目不存在返回 404", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    const res: any = await POST(makeReq({ items: [{ nodeId: "n1", suggestions: SUG }] }), makeParams("x"));
    expect(res.status).toBe(404);
  });

  it("正常改写：先快照再更新，版本号+1 且返回字数", async () => {
    const res: any = await POST(makeReq({ items: [{ nodeId: "n1", suggestions: SUG }] }), makeParams("p1"));
    expect(res.status).toBe(200);
    expect(versionsMock.snapshotRevision).toHaveBeenCalledOnce();
    expect(versionsMock.snapshotRevision.mock.calls[0][0].source).toBe("ai-rewrite");
    expect(prismaMock.storyNode.update).toHaveBeenCalledOnce();
    const data = prismaMock.storyNode.update.mock.calls[0][0].data;
    expect(data.editVersion).toEqual({ increment: 1 }); // 乐观锁版本递增
    expect(data.revisionCount).toEqual({ increment: 1 });
    expect(res.payload.summary.ok).toBe(1);
    expect(res.payload.summary.failed).toBe(0);
    expect(res.payload.applied[0].wordCount).toBe(210);
  });

  it("改写结果为空：保留原正文并记为失败", async () => {
    reviewMock.runEditorApply.mockResolvedValue("  ");
    const res: any = await POST(makeReq({ items: [{ nodeId: "n1", suggestions: SUG }] }), makeParams("p1"));
    expect(prismaMock.storyNode.update).not.toHaveBeenCalled();
    expect(res.payload.summary.ok).toBe(0);
    expect(res.payload.summary.failed).toBe(1);
    expect(res.payload.applied[0].error).toContain("为空");
  });

  it("改写后过短（疑似截断）：不覆盖原正文", async () => {
    // 原正文 200 字；新内容 60 字 ≥50 通过空守卫，但 <200*0.4 命中「过短」守卫
    reviewMock.runEditorApply.mockResolvedValue("改".repeat(60));
    const res: any = await POST(makeReq({ items: [{ nodeId: "n1", suggestions: SUG }] }), makeParams("p1"));
    expect(prismaMock.storyNode.update).not.toHaveBeenCalled();
    expect(res.payload.applied[0].error).toContain("过短");
  });

  it("回收站章节不可改写", async () => {
    prismaMock.storyNode.findUnique.mockResolvedValue({
      id: "n1", projectId: "p1", content: "原文".repeat(50), wordCount: 100,
      editVersion: 1, deletedAt: new Date(), title: "x", reviewLogs: [],
    });
    const res: any = await POST(makeReq({ items: [{ nodeId: "n1", suggestions: SUG }] }), makeParams("p1"));
    expect(prismaMock.storyNode.update).not.toHaveBeenCalled();
    expect(res.payload.applied[0].error).toContain("回收站");
  });

  it("缺少 nodeId 的建议项记为失败而不中断整批", async () => {
    const res: any = await POST(
      makeReq({ items: [{ nodeId: "", suggestions: SUG }, { nodeId: "n1", suggestions: SUG }] }),
      makeParams("p1"),
    );
    expect(res.payload.summary.failed).toBe(1);
    expect(res.payload.summary.ok).toBe(1);
  });
});
