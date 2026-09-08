/**
 * src/lib/llm.ts 单元测试 —— P0-4 补齐「全库最热、原本零测试」模块。
 *
 * 覆盖：
 *  - mapLLMError：各 HTTP 状态码 → 用户可读中文提示
 *  - estimateCost：已知/未知模型定价、成本计算
 *  - getSettings：provider 选择、预设 provider 的 baseUrl 强制走 PROVIDER_BASE_URLS
 *    （忽略数据库残留的错误 baseUrl）、local 走用户填写的 baseUrl、无 DB 时退环境变量
 *
 * 说明：llm.ts 不再承载裸 fetch，因此「超时」「占位 key 拒绝调用」属于
 * core/llm/client.ts 与 core/settings/local-parser.ts（hasLLMConfig），不在本文件范围内，
 * 已在复盘文档 §7 P1 中列为后续补测项。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSettings: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}));

import {
  PROVIDER_BASE_URLS,
  mapLLMError,
  estimateCost,
  getSettings,
  clearLLMCache,
} from "@/lib/llm";

// 环境变量在用例间隔离
const savedEnv = { ...process.env };

beforeEach(() => {
  mockFindUnique.mockReset();
  clearLLMCache();
  process.env = { ...savedEnv };
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_BASE_URL;
});

describe("mapLLMError", () => {
  it("401 提示 API Key 无效/过期", () => {
    expect(mapLLMError(401, "")).toContain("API Key 无效");
  });
  it("403 提示无权限", () => {
    expect(mapLLMError(403, "")).toContain("无权限");
  });
  it("404 带模型名提示模型不存在", () => {
    expect(mapLLMError(404, "", "gpt-x")).toContain("gpt-x");
  });
  it("429 提示限流", () => {
    expect(mapLLMError(429, "")).toContain("限流");
  });
  it(">=500 提示服务端异常", () => {
    expect(mapLLMError(503, "")).toContain("服务端异常");
  });
  it("其他状态码走默认提示", () => {
    expect(mapLLMError(400, "")).toContain("调用失败");
  });
  it("带回文内容时拼接服务端返回片段", () => {
    expect(mapLLMError(401, "bad key")).toContain("bad key");
  });
});

describe("estimateCost", () => {
  it("已知模型按单价计算（prompt+completion 各 1M token）", () => {
    const r = estimateCost("deepseek-chat", 1_000_000, 1_000_000);
    expect(r.known).toBe(true);
    expect(r.cost).toBeCloseTo(0.14 + 0.28, 5);
  });
  it("gpt-4o 定价正确", () => {
    const r = estimateCost("gpt-4o", 1_000_000, 1_000_000);
    expect(r.known).toBe(true);
    expect(r.cost).toBeCloseTo(2.5 + 10, 5);
  });
  it("未知模型返回 known=false、cost=0", () => {
    const r = estimateCost("my-custom-model-xyz", 1_000_000, 1_000_000);
    expect(r.known).toBe(false);
    expect(r.cost).toBe(0);
  });
});

describe("getSettings - provider 选择与 baseUrl 强制", () => {
  it("预设 provider 强制走 PROVIDER_BASE_URLS，忽略残留错误 baseUrl", async () => {
    mockFindUnique.mockResolvedValue({
      llmProvider: "deepseek",
      llmApiKey: "sk-real-test-key-1234567890",
      llmBaseUrl: "https://stale-wrong-url.example.com/v1", // 残留脏值
      llmModel: "deepseek-chat",
    });
    const s = await getSettings();
    expect(s.provider).toBe("deepseek");
    expect(s.baseUrl).toBe(PROVIDER_BASE_URLS.deepseek);
    expect(s.baseUrl).not.toContain("stale-wrong-url");
    expect(s.model).toBe("deepseek-chat");
  });

  it("模型未显式配置时按 provider 兜底默认模型", async () => {
    mockFindUnique.mockResolvedValue({
      llmProvider: "openai",
      llmApiKey: "sk-real-test-key-1234567890",
      llmBaseUrl: "",
      llmModel: "",
    });
    const s = await getSettings();
    expect(s.provider).toBe("openai");
    expect(s.baseUrl).toBe(PROVIDER_BASE_URLS.openai);
    expect(s.model).toBe("gpt-3.5-turbo"); // DEFAULT_MODELS.openai
  });

  it("local 走用户填写的 baseUrl，无需 apiKey", async () => {
    mockFindUnique.mockResolvedValue({
      llmProvider: "local",
      llmApiKey: "",
      llmBaseUrl: "http://localhost:11434/v1",
      llmModel: "qwen2.5:7b",
    });
    const s = await getSettings();
    expect(s.provider).toBe("local");
    expect(s.apiKey).toBe("");
    expect(s.baseUrl).toBe("http://localhost:11434/v1");
    expect(s.model).toBe("qwen2.5:7b");
  });

  it("无 DB 配置时回退到环境变量 LLM_API_KEY", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.LLM_API_KEY = "sk-env-test-key-1234567890";
    process.env.LLM_PROVIDER = "siliconflow";
    const s = await getSettings();
    expect(s.provider).toBe("siliconflow");
    expect(s.apiKey).toBe("sk-env-test-key-1234567890");
    expect(s.baseUrl).toBe(PROVIDER_BASE_URLS.siliconflow);
  });

  it("数据库与环境变量均无 Key 时抛出明确错误", async () => {
    mockFindUnique.mockResolvedValue(null);
    delete process.env.LLM_API_KEY;
    await expect(getSettings()).rejects.toThrow(/API Key 未配置/);
  });
});
