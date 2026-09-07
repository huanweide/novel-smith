import { describe, it, expect, vi, beforeEach } from "vitest";

// 分章打包导出路由：按平台排版，返回「每章独立 .txt」结构（纯本地，不联网）。
const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  storyNode: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: any, init?: any) => ({ payload, status: init?.status ?? 200 }),
  },
}));

import { POST } from "./route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const makeReq = (body: any) => ({ json: async () => body }) as any;

describe("POST /api/projects/[id]/export-chapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.project.findUnique.mockResolvedValue({ id: "p1", name: "测试小说" });
    prismaMock.storyNode.findMany.mockResolvedValue([
      { id: "n1", order: 0, title: "第一章 觉醒", content: "夜色中他睁开了眼。命运的齿轮开始转动。" },
      { id: "n2", order: 1, title: "第二章 抉择", content: "前路两难，他必须做出选择。" },
      { id: "n3", order: 2, title: "空白章", content: "   " }, // 应被过滤
    ]);
  });

  it("项目不存在返回 404", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    const res: any = await POST(makeReq({ platform: "fanqie" }), makeParams("x"));
    expect(res.status).toBe(404);
  });

  it("按平台排版返回每章独立文件，过滤空章，文件名安全化", async () => {
    const res: any = await POST(makeReq({ platform: "fanqie", includeAttribution: true }), makeParams("p1"));
    expect(res.status).toBe(200);
    const ch = res.payload.chapters;
    expect(ch).toHaveLength(2); // 空白章被过滤
    expect(ch[0].filename).toMatch(/^001_.*\.txt$/);
    expect(ch[0].title).toContain("第一章");
    expect(ch[0].content).toContain("第一章");
    expect(ch[0].content).toContain("命运的齿轮");
    expect(res.payload.readme).toContain("测试小说");
    expect(res.payload.totalChapters).toBe(2);
  });

  it("不带署名时不返回说明文件", async () => {
    const res: any = await POST(makeReq({ platform: "general", includeAttribution: false }), makeParams("p1"));
    expect(res.payload.readme).toBe("");
    expect(res.payload.chapters[0].content).not.toContain("本书使用 novel-smith");
  });

  it("公众号平台标题不带章节编号", async () => {
    const res: any = await POST(makeReq({ platform: "wechat" }), makeParams("p1"));
    expect(res.payload.chapters[0].title).toBe("第一章 觉醒");
  });
});
