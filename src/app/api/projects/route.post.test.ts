import { describe, it, expect, vi, beforeEach } from "vitest";

// v3.1.124：POST /api/projects 必须拒绝「没有名字」的项目。
// 背景（黑箱实测 BLANK-REQUIRED）：此前 asStr 的 required 只挡 undefined / null，
// 于是 `{ name: "" }` 能建出一个空名项目 —— 首页列表里一张空白卡片，认不出也删不干净。
// 这条用例把「空名 / 纯空格名必须 400」钉死在路由层，防止将来又漏。

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      create: createMock,
    },
  },
}));

import { POST } from "@/app/api/projects/route";

function req(body: unknown) {
  return new Request("http://127.0.0.1:3001/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("v3.1.124 POST /api/projects 必填 name 不接受空白", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ id: "new-id", name: "ok" });
  });

  it("name 为空串 → 400，且绝不落库", async () => {
    const res = await POST(req({ name: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.field).toBe("name");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("name 为纯空格 → 400", async () => {
    const res = await POST(req({ name: "   " }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("name 缺失 → 400", async () => {
    const res = await POST(req({ description: "只有描述" }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("name 正常 → 201 且照常落库", async () => {
    const res = await POST(req({ name: "我的新书" }));
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data.name).toBe("我的新书");
  });
});
