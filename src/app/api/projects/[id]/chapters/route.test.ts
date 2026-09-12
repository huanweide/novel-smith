import { describe, it, expect, vi, beforeEach } from "vitest";

// 轻量章节清单路由：供「指定单章」下拉使用，只返回 id/order/title/字数，**不带正文**。
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

import { GET } from "./route";

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) }) as any;

describe("GET /api/projects/[id]/chapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.project.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.storyNode.findMany.mockResolvedValue([
      { id: "n1", order: 0, title: "第一章 觉醒", content: "夜色中他睁开了眼。" },
      { id: "n2", order: 1, title: "第二章 抉择", content: "前路两难，他必须做出选择。" },
      { id: "n3", order: 2, title: "空白章", content: "   " }, // 应被过滤
    ]);
  });

  it("项目不存在返回 404", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    const res: any = await GET({} as any, makeParams("x"));
    expect(res.status).toBe(404);
  });

  it("返回章节清单且不含正文（轻量，不拉全书）", async () => {
    const res: any = await GET({} as any, makeParams("p1"));
    expect(res.status).toBe(200);
    const ch = res.payload.chapters;
    expect(ch).toHaveLength(2); // 空白章被过滤
    expect(ch[0]).toHaveProperty("id");
    expect(ch[0]).toHaveProperty("title");
    expect(ch[0]).toHaveProperty("words");
    // 关键：绝不能把正文带出来
    expect(ch[0]).not.toHaveProperty("content");
    expect(JSON.stringify(res.payload)).not.toContain("夜色中他睁开了眼");
  });

  it("字数统计去掉空白按字算", async () => {
    const res: any = await GET({} as any, makeParams("p1"));
    expect(res.payload.chapters[0].words).toBe("夜色中他睁开了眼。".replace(/\s+/g, "").length);
    expect(res.payload.meta.total).toBe(2);
  });

  it("prisma 抛错 → 统一脱敏错误（不透传内部 SQL / 表名）", async () => {
    prismaMock.project.findUnique.mockRejectedValueOnce(
      new Error("SQLITE_ERROR: no such table: Project")
    );
    const res: any = await GET({} as any, makeParams("p1"));
    expect(res.status).toBe(500);
    expect(res.payload.code).toBeTruthy();
    expect(res.payload.hint).toBeTruthy();
    expect(JSON.stringify(res.payload)).not.toContain("SQLITE_ERROR");
    expect(JSON.stringify(res.payload)).not.toContain("no such table");
  });
});
