import { describe, it, expect, vi } from "vitest";

// v3.1.120：GET /api/projects/[id] 必须把 llmConfig.apiKey 脱敏，避免公开部署泄露作者密钥。
// 用 vi.mock 隔离 prisma，断言返回体里的 apiKey 已打码、明文不出现、其余配置字段保留。

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: findUniqueMock,
    },
  },
}));

vi.mock("@/core/sync-global-prompt", () => ({
  syncGlobalPrompt: vi.fn(async () => "synced"),
}));

import { GET } from "@/app/api/projects/[id]/route";

const params = { params: Promise.resolve({ id: "p1" }) };

describe("v3.1.120 GET /api/projects/[id] llmConfig.apiKey 脱敏", () => {
  it("含明文 apiKey 时返回体必须打码且带 hasApiKey，明文不出现", async () => {
    findUniqueMock.mockResolvedValue({
      id: "p1",
      name: "测试项目",
      llmConfig: {
        apiKey: "sk-abcdefghijklmnop",
        baseURL: "https://api.x.com",
        model: "gpt-4",
      },
      characters: [],
      storyNodes: [],
    });
    const res = await GET(new Request("http://localhost/api/projects/p1"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.llmConfig.apiKey).not.toBe("sk-abcdefghijklmnop");
    expect(body.llmConfig.apiKey.endsWith("mnop")).toBe(true);
    expect(body.llmConfig.apiKey.startsWith("sk-")).toBe(false);
    expect(body.llmConfig.hasApiKey).toBe(true);
    // 整包序列化后也不能含明文 key
    expect(JSON.stringify(body)).not.toContain("sk-abcdefghijklmnop");
    // 其余配置字段保留
    expect(body.llmConfig.baseURL).toBe("https://api.x.com");
    expect(body.llmConfig.model).toBe("gpt-4");
  });

  it("llmConfig 为 null 时返回 null，不报错", async () => {
    findUniqueMock.mockResolvedValue({ id: "p1", name: "X", llmConfig: null });
    const res = await GET(new Request("http://localhost/api/projects/p1"), params);
    const body = await res.json();
    expect(body.llmConfig).toBeNull();
  });

  it("项目不存在返回 404", async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/projects/p1"), params);
    expect(res.status).toBe(404);
  });
});
