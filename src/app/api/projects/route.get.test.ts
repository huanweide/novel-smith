import { describe, it, expect, vi } from "vitest";

// v3.1.120：GET /api/projects 列表必须把 llmConfig.apiKey 脱敏。
// 关键：不 mock getProjectsForHome，而是 mock 底层 prisma.project.findMany，
// 让真实的 getProjectsForHome（已在源头对 llmConfig 脱敏）跑起来，覆盖列表 + 首页 SSR 共用的取数路径。

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: findManyMock,
    },
  },
}));

import { GET } from "@/app/api/projects/route";

describe("v3.1.120 GET /api/projects llmConfig.apiKey 脱敏", () => {
  it("列表每项 llmConfig.apiKey 必须打码，明文不出现", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "p1",
        name: "A",
        llmConfig: { apiKey: "sk-secret12345", model: "x" },
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        _count: { characters: 0, lorebookEntries: 0, storyNodes: 0 },
      },
      {
        id: "p2",
        name: "B",
        llmConfig: null,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        _count: { characters: 0, lorebookEntries: 0, storyNodes: 0 },
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].llmConfig.apiKey).not.toBe("sk-secret12345");
    expect(body[0].llmConfig.apiKey.endsWith("2345")).toBe(true);
    expect(body[0].llmConfig.hasApiKey).toBe(true);
    expect(body[1].llmConfig).toBeNull();
    // 整包序列化后也不能含明文 key
    expect(JSON.stringify(body)).not.toContain("sk-secret12345");
  });
});
