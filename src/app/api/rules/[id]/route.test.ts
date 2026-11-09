import { describe, it, expect, vi, beforeEach } from "vitest";

// 越权裸写防护：PUT /api/rules/[id]
// 此前 `data: body` 会把 projectId / id / createdAt 等系统字段一并写库，
// 客户端可借请求体把规则挪到别的项目。改为白名单字段后，越权字段必须被剥离。

const prismaMock = vi.hoisted(() => ({
  rule: { update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
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

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const makeReq = (body: any) => ({ json: async () => body }) as any;

describe("PUT /api/rules/[id] 越权裸写防护", () => {
  beforeEach(() => vi.clearAllMocks());

  it("仅写入白名单字段，剥离经请求体注入的 projectId/id", async () => {
    prismaMock.rule.update.mockResolvedValueOnce({ id: "r1" });
    const body = {
      name: "主角不杀人",
      content: "正文",
      category: "writing",
      enabled: false,
      priority: 5,
      scope: "all",
      // 越权系统字段：企图把规则挪到别的项目 / 改主键
      projectId: "evil-project",
      id: "evil-id",
    };
    const res: any = await PUT(makeReq(body), makeParams("r1"));
    expect(res.status).toBe(200);
    const call = prismaMock.rule.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "r1" });
    // 白名单字段被写入
    expect(call.data.name).toBe("主角不杀人");
    expect(call.data.enabled).toBe(false);
    expect(call.data.priority).toBe(5);
    // 越权系统字段必须被剥离
    expect(call.data.projectId).toBeUndefined();
    expect(call.data.id).toBeUndefined();
  });

  it("仅发 enabled（开关）时正常，且不写入 projectId", async () => {
    prismaMock.rule.update.mockResolvedValueOnce({ id: "r1" });
    const res: any = await PUT(makeReq({ enabled: true }), makeParams("r1"));
    expect(res.status).toBe(200);
    const call = prismaMock.rule.update.mock.calls[0][0];
    expect(call.data.enabled).toBe(true);
    expect(call.data).not.toHaveProperty("projectId");
  });
});
