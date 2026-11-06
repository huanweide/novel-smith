import { describe, it, expect, vi, beforeEach } from "vitest";

// PUT /api/generate/outline（确认大纲后落库）判别测试。
// 真机实锤的旧缺陷：replaceAll 只删 parentId:null 的顶层章节且用硬删 →
// 分卷项目卷内旧章残留造成新旧混杂，且已写正文被永久删除、无法从回收站恢复。

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  storyNode: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  characterCard: { findMany: vi.fn() },
  loreEntry: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: any, init?: any) => ({ payload, status: init?.status ?? 200 }),
  },
}));

import { PUT } from "./route";

const makeReq = (body: any) => ({ json: async () => body }) as any;
const chapters = [
  { title: "第1章", summary: "梗概一", coreConflict: "冲突一", characters: ["林砚"] },
  { title: "第2章", summary: "梗概二", coreConflict: "冲突二", characters: [] },
];

describe("PUT /api/generate/outline · 替换大纲不丢数据", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.storyNode.updateMany.mockResolvedValue({ count: 3 });
    prismaMock.storyNode.deleteMany.mockResolvedValue({ count: 3 });
    prismaMock.storyNode.findFirst.mockResolvedValue({ order: 2 });
    prismaMock.storyNode.create.mockImplementation(async ({ data }: any) => ({ id: "n" + data.order, ...data }));
  });

  it("replaceAll 用软删而非物理删，并返回 recycled 供前端提示（回归守卫）", async () => {
    const res: any = await PUT(makeReq({ projectId: "p1", chapters, replaceAll: true }));
    expect(prismaMock.storyNode.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.storyNode.updateMany).toHaveBeenCalledTimes(1);
    const call = prismaMock.storyNode.updateMany.mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(res.payload.recycled).toBe(3);
    expect(res.payload.count).toBe(2);
  });

  it("软删范围不限 parentId（分卷内章节同样替换），且保留 volume", async () => {
    await PUT(makeReq({ projectId: "p1", chapters, replaceAll: true }));
    const where = prismaMock.storyNode.updateMany.mock.calls[0][0].where;
    expect(where.parentId).toBeUndefined(); // 旧版写死 parentId: null，卷内章节漏删
    expect(where.type).toEqual({ not: "volume" });
    expect(where.deletedAt).toBeNull();
    expect(where.projectId).toBe("p1");
  });

  it("replaceAll=false 追加模式不删任何节点", async () => {
    const res: any = await PUT(makeReq({ projectId: "p1", chapters, replaceAll: false }));
    expect(prismaMock.storyNode.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.storyNode.deleteMany).not.toHaveBeenCalled();
    expect(res.payload.recycled).toBe(0);
    expect(res.payload.count).toBe(2);
  });

  it("新章 order 按现存最大 order 递增，标题/章纲/类型落对", async () => {
    await PUT(makeReq({ projectId: "p1", chapters, replaceAll: true }));
    const created = prismaMock.storyNode.create.mock.calls.map((c: any) => c[0].data);
    expect(created.map((d: any) => d.order)).toEqual([3, 4]); // lastNode.order=2 → startOrder=3
    expect(created[0].title).toBe("第1章");
    expect(created[0].outline).toBe("梗概一");
    expect(created[0].coreConflict).toBe("冲突一");
    expect(created[0].activeCharacters).toEqual(["林砚"]);
    expect(created[0].type).toBe("chapter");
    expect(created[0].status).toBe("outline_only");
  });

  it("缺参数返回 400", async () => {
    const res: any = await PUT(makeReq({ projectId: "p1", chapters: [] }));
    expect(res.status).toBe(400);
  });
});
