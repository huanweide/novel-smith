import { describe, it, expect, vi, beforeEach } from "vitest";

// 越权裸写防护：PUT /api/projects/[id]/lore-tables/[tableId]
// 此前 `data: { ...body } as any` 会把 projectId / id / createdAt 等系统字段一并写库，
// 客户端可借请求体把表格挪到别的项目或篡改主键。改为白名单字段后，越权字段必须被剥离。

const prismaMock = vi.hoisted(() => ({
  loreTable: { update: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: any, init?: any) => ({ payload, status: init?.status ?? 200 }),
  },
}));
vi.mock("@/lib/api-error", () => ({
  jsonError: (err: any) => ({ payload: { error: String(err) }, status: 500 }),
}));

import { PUT } from "./route";

const makeParams = (id: string, tableId: string) =>
  ({ params: Promise.resolve({ id, tableId }) }) as any;
const makeReq = (body: any) => ({ json: async () => body }) as any;

describe("PUT /api/projects/[id]/lore-tables/[tableId] 越权裸写防护", () => {
  beforeEach(() => vi.clearAllMocks());

  it("仅写入白名单字段，剥离经请求体注入的 projectId/id/createdAt", async () => {
    prismaMock.loreTable.update.mockResolvedValueOnce({ id: "t1" });
    const body = {
      name: "妃嫔居住表",
      note: "说明",
      category: "person",
      columns: [{ key: "name", label: "名称", type: "text" }],
      rows: [{ row_id: 1, name: "甄嬛" }],
      // 越权系统字段：企图把表格挪到别的项目 / 改主键 / 倒签创建时间
      projectId: "evil-project",
      id: "evil-id",
      createdAt: "2000-01-01T00:00:00.000Z",
    };
    const res: any = await PUT(makeReq(body), makeParams("p1", "t1"));
    expect(res.status).toBe(200);
    const call = prismaMock.loreTable.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "t1" });
    // 白名单字段被写入
    expect(call.data.name).toBe("妃嫔居住表");
    expect(call.data.columns).toEqual([{ key: "name", label: "名称", type: "text" }]);
    expect(call.data.rows).toEqual([{ row_id: 1, name: "甄嬛" }]);
    // 越权系统字段必须被剥离
    expect(call.data.projectId).toBeUndefined();
    expect(call.data.id).toBeUndefined();
    expect(call.data.createdAt).toBeUndefined();
  });

  it("部分字段更新（缺少字段）不报错，且不写入 projectId", async () => {
    prismaMock.loreTable.update.mockResolvedValueOnce({ id: "t1" });
    const res: any = await PUT(makeReq({ name: "改名" }), makeParams("p1", "t1"));
    expect(res.status).toBe(200);
    const call = prismaMock.loreTable.update.mock.calls[0][0];
    expect(call.data.name).toBe("改名");
    expect(call.data).not.toHaveProperty("projectId");
    expect(call.data).not.toHaveProperty("id");
  });
});
