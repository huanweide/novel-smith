import { describe, it, expect, vi } from "vitest";

// v3.1.121：GET /api/settings 必须把全局 llmApiKey 脱敏，避免公开部署泄露作者密钥。
// 复用共享 @/lib/llm-config-mask 的 maskKey（与 projects 路由同源），断言返回体已打码、明文不出现。
import { GET } from "./route";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSettings: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));
vi.mock("@/lib/llm", () => ({ clearLLMCache: vi.fn() }));

describe("v3.1.121 GET /api/settings llmApiKey 脱敏", () => {
  it("含明文 llmApiKey 时返回体必须打码且带 hasKey，明文不出现", async () => {
    (prisma.appSettings.findUnique as any).mockResolvedValue({
      id: "default",
      llmProvider: "deepseek",
      llmApiKey: "sk-secret12345",
      llmModel: "deepseek-chat",
      llmBaseUrl: "",
    });
    const res = await GET();
    const body = await res.json();
    expect(body.llmApiKey).not.toBe("sk-secret12345");
    expect(body.llmApiKey.endsWith("2345")).toBe(true);
    expect(body.hasKey).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-secret12345");
  });

  it("llmApiKey 为 null 时返回空串且 hasKey=false", async () => {
    (prisma.appSettings.findUnique as any).mockResolvedValue({
      id: "default",
      llmProvider: "deepseek",
      llmApiKey: null,
      llmModel: "",
      llmBaseUrl: "",
    });
    const res = await GET();
    const body = await res.json();
    expect(body.llmApiKey).toBe("");
    expect(body.hasKey).toBe(false);
  });
});
