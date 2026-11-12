/**
 * R1 判别测试 · 修尺子（本文件必须先红，再改实现到绿）
 *
 * 对应真缺陷（逐字符锚点见 PROCESS/research-后端可靠性与评估/best-practices.md §2.1）：
 *  D1 `client.ts:238` 非流式 fetch 只挂 timeout，未合并外部 request.signal（流式 :342 已合并）
 *  D2 `client.ts:492/505/543/561` 四处 recordLlmCall 不带 projectId，按项目成本看板失真
 *  D3 失败记账不带 durationMs，被 `generation-metrics:53 durationMs not null` 过滤
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({
  getSettings: vi.fn(async () => ({
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test",
  })),
  mapLLMError: vi.fn((status: number) => `UPSTREAM-${status}`),
  recordLlmCall: vi.fn(),
}));

import type { LLMConfig } from "@/core/types";
import { recordLlmCall } from "@/lib/llm";
import { createLLMClient } from "./client";

function mkConfig(over: Partial<LLMConfig> = {}): LLMConfig {
  return {
    architectModel: "deepseek-chat",
    writerModel: "deepseek-chat",
    reviewerModel: "deepseek-chat",
    summarizeModel: "deepseek-chat",
    extractorModel: "deepseek-chat",
    baseURL: "https://api.deepseek.com",
    apiKey: "sk-test",
    defaultTemperature: 0.8,
    defaultTopP: 0.95,
    maxTokensPerRequest: 4096,
    contextWindowSize: 65536,
    disableThinking: false,
    ...over,
  };
}

function okResp(content = "好了") {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const userMsg = () => ({ model: "deepseek-chat", messages: [{ role: "user" as const, content: "写一段" }] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(recordLlmCall).mockClear();
});

describe("R1-D1 · 非流式调用必须能被用户停止", () => {
  it("chat() 传入已 abort 的 signal 时，fetch 收到的 signal 必须已 aborted", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen = init.signal ?? undefined;
        return okResp();
      }),
    );
    const ac = new AbortController();
    ac.abort();
    // 实现改前：signal = AbortSignal.timeout(300000)，aborted=false
    await createLLMClient(mkConfig()).chat({ ...userMsg(), signal: ac.signal });
    expect(seen, "fetch 应收到合并后的 signal").toBeTruthy();
    expect(seen!.aborted, "外部已 abort，合并信号必须立即 aborted（否则点停止仍白跑满 5 分钟）").toBe(true);
  });

  it("chat() 未传 signal 时行为不变（signal 仍是非 aborted 的超时信号）", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen = init.signal ?? undefined;
        return okResp();
      }),
    );
    await createLLMClient(mkConfig()).chat(userMsg());
    expect(seen!.aborted).toBe(false);
  });
});

describe("R1-D2 · 主链路成本必须能按项目归属", () => {
  it("createLLMClient 带 projectId 时，chat 成功记账携带 projectId", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResp()));
    // 第二形参在改前不存在，用 any 绕开类型以拿到 baseline 红而不是 TS 红
    const client = (createLLMClient as any)(mkConfig(), { projectId: "proj-r1" });
    await client.chat(userMsg());
    expect(recordLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-r1" }),
    );
  });

  it("chatStream 成功记账同样携带 projectId", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}\n\n' +
      "data: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );
    const client = (createLLMClient as any)(mkConfig(), { projectId: "proj-r1-stream" });
    for await (const _ of client.chatStream(userMsg())) { /* drain */ }
    expect(recordLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-r1-stream" }),
    );
  });

  it("request 级 projectId 优先于客户端默认值", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResp()));
    const client = (createLLMClient as any)(mkConfig(), { projectId: "proj-default" });
    await client.chat({ ...userMsg(), projectId: "proj-override" });
    expect(recordLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-override" }),
    );
  });

  it("未配置 projectId 时保持 null，不臆造归属", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResp()));
    await createLLMClient(mkConfig()).chat(userMsg());
    const calls = vi.mocked(recordLlmCall).mock.calls.map((c) => c[0]);
    expect(calls.every((c) => c.projectId === undefined || c.projectId === null)).toBe(true);
  });
});

describe("R1-D3 · 失败调用也必须进延迟看板", () => {
  it("chat 失败记账带 durationMs（>=0），不再被 durationMs not null 过滤掉", async () => {
    // 401 为 fatal，只尝试一次，不触发退避 sleep
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );
    await expect(createLLMClient(mkConfig()).chat(userMsg())).rejects.toThrow();
    const failCalls = vi.mocked(recordLlmCall).mock.calls
      .map((c) => c[0])
      .filter((c) => String(c.role).startsWith("fail:"));
    expect(failCalls.length).toBeGreaterThan(0);
    expect(failCalls.every((c) => typeof c.durationMs === "number" && c.durationMs >= 0)).toBe(true);
  });
});
