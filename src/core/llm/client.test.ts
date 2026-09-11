/**
 * LLM 客户端测试
 *
 * 为什么值得单独补这一份（core 下唯一长期零测试的模块，却最烧钱、最易静默出错）：
 *   1. **它决定烧多少钱**：重试几次、4xx 要不要重试、故障转移切不切，全是这里的判定。
 *      一个「401 也重试 3 次」的 bug 不会报错，只会让你多等两秒、多扣几次失败调用。
 *   2. **它决定会不会被静默截断**：max_tokens 算小了，正文会无声无息地少半章，
 *      界面上什么都不报。
 *   3. **它决定监控看板准不准**：用量记账错了，你看到的成本曲线就是假的。
 *
 * 测试策略：
 *   - 纯判定函数（预算 / 重试 / 退避 / 构建调用链）：直接调，零网络。
 *   - 涉及网络的行为：stub 掉全局 fetch，用假响应驱动，断言请求次数与请求体。
 *     断言「请求次数」是这里最关键的一类断言——它直接对应真金白银。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  backoffDelay,
  buildChain,
  buildProjectOverrides,
  completeText,
  createLLMClient,
  getEffectiveConfig,
  isRetryable,
  parseRetryAfter,
  resolveMaxTokens,
} from "./client";

// ─── 测试夹具 ───────────────────────────────────────────────

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
    ...over,
  };
}

function okResp(
  content = "好了",
  usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errResp(status: number, body = "boom", headers?: Record<string, string>) {
  return new Response(body, { status, headers });
}

/** 把若干 SSE 帧拼成一个流式响应 */
function sseResponse(frames: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function userMsg(content = "写一段"): { messages: Array<{ role: "user"; content: string }> } {
  return { messages: [{ role: "user" as const, content }] };
}

// 关于耗时：涉及重试的用例会真的 sleep（0.6s / 1.2s），全份约 8 秒。
// 试过用 vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 }) 加速，
// 结果反而更慢（14 秒）——假定时器与 mock fetch 的微任务队列互相拖累。
// 结论：这几秒就让它真等，正确性优先。别再试第二次。
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(recordLlmCall).mockClear();
});

// ─── 输出预算 ───────────────────────────────────────────────

describe("resolveMaxTokens —— 输出预算（算小了正文会被静默截断）", () => {
  it("推理模型强制保底 2500：思考链和正文共用预算，给少了正文会整个空掉", () => {
    expect(resolveMaxTokens("deepseek-reasoner", 800, 4096)).toBe(2500);
  });

  it.each(["deepseek-reasoner", "deepseek-v4-flash", "o1-mini", "qwq-32b", "my-r1-model"])(
    "识别为推理模型：%s",
    (model) => {
      expect(resolveMaxTokens(model, 800, 4096)).toBe(2500);
    },
  );

  it("普通模型不受保底影响（分类、短回复仍用小预算，不浪费）", () => {
    expect(resolveMaxTokens("deepseek-chat", 800, 4096)).toBe(800);
  });

  it("目标字数按 1.6 倍 token 估算放大，长章不会被固定 4096 截断", () => {
    expect(resolveMaxTokens("deepseek-chat", undefined, 4096, { targetWordCount: 5000 })).toBe(8000);
  });

  it("目标字数再小也有 4096 下限", () => {
    expect(resolveMaxTokens("deepseek-chat", undefined, 4096, { targetWordCount: 10 })).toBe(4096);
  });

  it("预算不超过上下文窗口的 80%，不把上下文撑爆", () => {
    expect(
      resolveMaxTokens("deepseek-chat", undefined, 4096, {
        targetWordCount: 100000,
        contextWindowSize: 32768,
      }),
    ).toBe(26214);
  });

  it("没指定 maxTokens 时用配置兜底", () => {
    expect(resolveMaxTokens("deepseek-chat", undefined, 2048)).toBe(2048);
  });
});

// ─── 该不该重试 ─────────────────────────────────────────────

describe("isRetryable —— 重试资格（重试错对象 = 白等 + 白记账）", () => {
  it.each([429, 500, 502, 503])("可重试：%s", (status) => {
    expect(isRetryable(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("不可重试：%s（属于配置/请求错误，重试也不会变好）", (status) => {
    expect(isRetryable(status)).toBe(false);
  });

  it("网络层错误（拿不到状态码）可重试", () => {
    expect(isRetryable(null)).toBe(true);
  });
});

describe("parseRetryAfter —— 尊重服务端的限流指令", () => {
  it("秒数转成毫秒", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "3" }))).toBe(3000);
  });

  it("HTTP-date 形式也能解析", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(new Headers({ "retry-after": future }));
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThanOrEqual(6000);
  });

  it("封顶 60 秒，不让服务端用超大值把客户端挂死", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "99999" }))).toBe(60000);
  });

  it("HTTP-date 同样封顶 60 秒", () => {
    const far = new Date(Date.now() + 3600_000).toUTCString();
    expect(parseRetryAfter(new Headers({ "retry-after": far }))).toBe(60000);
  });

  it("没有这个头就返回 null，交给指数退避兜底", () => {
    expect(parseRetryAfter(new Headers())).toBeNull();
  });

  it("乱值返回 null，不崩", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "soon" }))).toBeNull();
  });

  it("过去的时间返回 null，不会倒退着等", () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(new Headers({ "retry-after": past }))).toBeNull();
  });
});

describe("backoffDelay —— 退避延迟", () => {
  it("随重试次数指数增长", () => {
    const first = backoffDelay(1, 600);
    const third = backoffDelay(3, 600);
    expect(third).toBeGreaterThan(first * 2);
  });

  it("封顶 8 秒，重试再多也不会等成几分钟", () => {
    expect(backoffDelay(20, 600)).toBeLessThanOrEqual(8000);
  });

  it("抖动不会把延迟抖成负数", () => {
    for (let i = 1; i <= 10; i++) expect(backoffDelay(i, 600)).toBeGreaterThanOrEqual(0);
  });
});

// ─── 调用链 ─────────────────────────────────────────────────

describe("buildChain —— 主模型到备用模型的调用链", () => {
  it("去掉地址尾部的斜杠，避免拼出 //chat/completions", () => {
    const chain = buildChain(mkConfig({ baseURL: "https://api.deepseek.com///" }), "m1");
    expect(chain[0]!.baseURL).toBe("https://api.deepseek.com");
  });

  it("备用模型没指定时继承主模型的地址与密钥", () => {
    const chain = buildChain(mkConfig({ fallbackModels: [{ model: "backup" }] }), "primary");
    expect(chain).toHaveLength(2);
    expect(chain[1]).toEqual({
      model: "backup",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-test",
    });
  });

  it("备用模型可自带地址与密钥（跨供应商兜底）", () => {
    const chain = buildChain(
      mkConfig({ fallbackModels: [{ model: "b", baseURL: "https://b.example.com/", apiKey: "sk-b" }] }),
      "primary",
    );
    expect(chain[1]!.baseURL).toBe("https://b.example.com");
    expect(chain[1]!.apiKey).toBe("sk-b");
  });

  it("主模型永远排在第一位", () => {
    const chain = buildChain(
      mkConfig({ fallbackModels: [{ model: "b1" }, { model: "b2" }] }),
      "primary",
    );
    expect(chain.map((c) => c.model)).toEqual(["primary", "b1", "b2"]);
  });
});

// ─── chat：重试与故障转移 ───────────────────────────────────

describe("chat —— 重试与故障转移（请求次数直接对应真金白银）", () => {
  beforeEach(() => {
    vi.mocked(recordLlmCall).mockClear();
  });

  it("5xx 会自动重试，重试成功后返回内容", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errResp(500)).mockResolvedValueOnce(okResp());
    vi.stubGlobal("fetch", fetchMock);

    const res = await createLLMClient(mkConfig()).chat({
      ...userMsg(),
      model: "deepseek-chat",
      maxTokens: 100,
    });

    expect(res.content).toBe("好了");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("401 鉴权错误一次都不重试（Key 填错了，重试只是白等白记账）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResp(401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLLMClient(mkConfig()).chat({ ...userMsg(), model: "deepseek-chat" }),
    ).rejects.toThrow(/UPSTREAM-401/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 也不切备用模型（换模型救不了填错的 Key）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResp(401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLLMClient(mkConfig({ fallbackModels: [{ model: "backup" }] })).chat({
        ...userMsg(),
        model: "deepseek-chat",
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络不可达会重试，且错误信息讲清该去查什么", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLLMClient(mkConfig({ baseURL: "https://nope.example.com" })).chat({
        ...userMsg(),
        model: "deepseek-chat",
      }),
    ).rejects.toThrow(/无法连接 AI 服务/);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("主模型重试耗尽后切到备用模型", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResp(500))
      .mockResolvedValueOnce(errResp(500))
      .mockResolvedValueOnce(errResp(500))
      .mockResolvedValueOnce(okResp("备用救场"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await createLLMClient(mkConfig({ fallbackModels: [{ model: "backup" }] })).chat({
      ...userMsg(),
      model: "deepseek-chat",
    });

    expect(res.content).toBe("备用救场");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("429 会尊重 Retry-After，不硬闯限流", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResp(429, "slow down", { "retry-after": "0" }))
      .mockResolvedValueOnce(okResp("恢复了"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await createLLMClient(mkConfig()).chat({ ...userMsg(), model: "deepseek-chat" });

    expect(res.content).toBe("恢复了");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("空 choices 不报错，返回空内容（内容过滤等场景不该炸）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const res = await createLLMClient(mkConfig()).chat({ ...userMsg(), model: "deepseek-chat" });

    expect(res.content).toBe("");
  });

  it("内容被过滤（content_filter）时返回空内容而不是抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "x" }, finish_reason: "content_filter" }],
            usage: { prompt_tokens: 8, completion_tokens: 0, total_tokens: 8 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const res = await createLLMClient(mkConfig()).chat({ ...userMsg(), model: "deepseek-chat" });

    expect(res.content).toBe("");
    expect(res.usage.totalTokens).toBe(8);
  });
});

// ─── 请求体 ─────────────────────────────────────────────────

describe("chat —— 请求体构造", () => {
  it("json 模式带上 response_format", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await createLLMClient(mkConfig()).chat({ ...userMsg(), model: "m", json: true });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("不带 json 时不要多塞 response_format（部分供应商会因此报错）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp());
    vi.stubGlobal("fetch", fetchMock);

    await createLLMClient(mkConfig()).chat({ ...userMsg(), model: "m" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.response_format).toBeUndefined();
  });

  it("带工具定义时自动补 tool_choice=auto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp());
    vi.stubGlobal("fetch", fetchMock);

    await createLLMClient(mkConfig()).chat({
      ...userMsg(),
      model: "m",
      tools: [{ type: "function", function: { name: "f", description: "d", parameters: {} } }],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.tool_choice).toBe("auto");
  });

  it("thinking 只在显式传入时才带（第三方供应商不认这个字段）", async () => {
    // 每次都要新建一个 Response：同一个响应对象的 body 只能读一次
    const fetchMock = vi.fn().mockImplementation(() => okResp());
    vi.stubGlobal("fetch", fetchMock);

    await createLLMClient(mkConfig()).chat({ ...userMsg(), model: "m" });
    const plain = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(plain.thinking).toBeUndefined();

    await createLLMClient(mkConfig()).chat({
      ...userMsg(),
      model: "m",
      thinking: { type: "disabled" },
    });
    const withThinking = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body));
    expect(withThinking.thinking).toEqual({ type: "disabled" });
  });

  it("鉴权头用的是当前目标模型的密钥", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp());
    vi.stubGlobal("fetch", fetchMock);

    await createLLMClient(mkConfig({ apiKey: "sk-real" })).chat({ ...userMsg(), model: "m" });

    expect(fetchMock.mock.calls[0]![1]!.headers.Authorization).toBe("Bearer sk-real");
  });
});

// ─── 记账 ───────────────────────────────────────────────────

describe("用量记账（成本看板准不准全看这里）", () => {
  it("成功调用按业务角色记账", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResp()));
    const calls: unknown[] = [];
    vi.mocked(recordLlmCall).mockImplementation((i) => calls.push(i));

    await createLLMClient(mkConfig()).chat({
      ...userMsg(),
      model: "deepseek-chat",
      role: "writer",
    });

    expect(calls).toEqual([
      expect.objectContaining({ role: "writer", model: "deepseek-chat", isFallback: false }),
    ]);
  });

  it("失败的尝试也记账，且带 fail: 前缀（否则成功率会被算得虚高）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errResp(401)));
    const calls: Array<{ role?: string }> = [];
    vi.mocked(recordLlmCall).mockImplementation((i) => calls.push(i));

    await expect(
      createLLMClient(mkConfig()).chat({ ...userMsg(), model: "deepseek-chat", role: "writer" }),
    ).rejects.toThrow();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.role).toBe("fail:writer");
  });

  it("没传角色时按 general 记账", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errResp(401)));
    const calls: Array<{ role?: string }> = [];
    vi.mocked(recordLlmCall).mockImplementation((i) => calls.push(i));

    await expect(
      createLLMClient(mkConfig()).chat({ ...userMsg(), model: "deepseek-chat" }),
    ).rejects.toThrow();

    expect(calls[0]!.role).toBe("fail:general");
  });

  it("走备用模型成功的调用要标记为 isFallback（看板才看得出主模型挂了）", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(errResp(500))
        .mockResolvedValueOnce(errResp(500))
        .mockResolvedValueOnce(errResp(500))
        .mockResolvedValueOnce(okResp()),
    );
    const calls: Array<{ isFallback?: boolean; role?: string }> = [];
    vi.mocked(recordLlmCall).mockImplementation((i) => calls.push(i));

    await createLLMClient(mkConfig({ fallbackModels: [{ model: "backup" }] })).chat({
      ...userMsg(),
      model: "deepseek-chat",
    });

    const success = calls.find((c) => !String(c.role).startsWith("fail:"));
    expect(success).toEqual(expect.objectContaining({ isFallback: true, model: "backup" }));
  });
});

// ─── 流式 ───────────────────────────────────────────────────

describe("chatStream —— 流式读取", () => {
  it("逐 token 产出，末尾给一条 done 并带上用量", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const tokens: string[] = [];
    const events = [];
    for await (const ev of createLLMClient(mkConfig()).chatStream({
      ...userMsg(),
      model: "deepseek-chat",
    })) {
      events.push(ev);
      if (ev.type === "token") tokens.push(ev.content);
    }

    expect(tokens).toEqual(["你", "好"]);
    expect(events.at(-1)!.type).toBe("done");
    expect(events.at(-1)!.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
  });

  it("finish_reason 必须透传——被截断时界面全靠它提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"半"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    let last;
    for await (const ev of createLLMClient(mkConfig()).chatStream({
      ...userMsg(),
      model: "deepseek-chat",
    })) {
      last = ev;
    }

    expect(last!.finishReason).toBe("length");
  });

  it("推理模型的思考链也要计入用量（否则成本看板少算推理消耗）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"让我想想"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    let last;
    for await (const ev of createLLMClient(mkConfig()).chatStream({
      ...userMsg(),
      model: "deepseek-reasoner",
    })) {
      last = ev;
    }

    expect(last!.usage.completionTokens).toBe(2);
  });

  it("流里混进解析不了的行要跳过，不能整条流崩掉", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          "data: not-json\n\n",
          'data: {"choices":[{"delta":{"content":"活"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const tokens: string[] = [];
    for await (const ev of createLLMClient(mkConfig()).chatStream({
      ...userMsg(),
      model: "deepseek-chat",
    })) {
      if (ev.type === "token") tokens.push(ev.content);
    }

    expect(tokens).toEqual(["活"]);
  });

  it("建立流就 401 时不重试，直接抛", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResp(401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(async () => {
      for await (const _ev of createLLMClient(mkConfig()).chatStream({
        ...userMsg(),
        model: "deepseek-chat",
      })) {
        void _ev;
      }
    }).rejects.toThrow(/UPSTREAM-401/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("流建立失败重试耗尽后切备用模型", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResp(500))
      .mockResolvedValueOnce(errResp(500))
      .mockResolvedValueOnce(errResp(500))
      .mockResolvedValueOnce(sseResponse(['data: {"choices":[{"delta":{"content":"兜"}}]}\n\n', "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);

    const tokens: string[] = [];
    for await (const ev of createLLMClient(mkConfig({ fallbackModels: [{ model: "backup" }] })).chatStream({
      ...userMsg(),
      model: "deepseek-chat",
    })) {
      if (ev.type === "token") tokens.push(ev.content);
    }

    expect(tokens).toEqual(["兜"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

// ─── JSON 模式降级 ──────────────────────────────────────────

describe("completeText —— JSON 模式降级（什么时候该再试一次）", () => {
  it("供应商不认 response_format（4xx）时，去掉 json 再试一次", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResp(400))
      .mockResolvedValueOnce(okResp('{"ok":1}'));
    vi.stubGlobal("fetch", fetchMock);

    const out = await completeText("sys", "prompt", { config: mkConfig(), json: true });

    expect(out).toBe('{"ok":1}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body));
    expect(secondBody.response_format).toBeUndefined();
  });

  it("限流 / 服务端错误**不**降级——否则请求数翻倍，把已经吃紧的供应商压得更狠", async () => {
    const fetchMock = vi.fn().mockImplementation(() => errResp(500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeText("sys", "prompt", { config: mkConfig(), json: true })).rejects.toThrow();

    // 只有 chat 内部的 3 次重试，不该再多出「去掉 json 重来一轮」的 3 次
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("非 json 模式失败时不做任何额外重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResp(400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeText("sys", "prompt", { config: mkConfig() })).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── 项目级覆盖 ─────────────────────────────────────────────

describe("buildProjectOverrides —— 项目级配置覆盖", () => {
  it("没填或填了空对象时不产生任何覆盖（留空 = 继承全局）", () => {
    expect(buildProjectOverrides(undefined)).toEqual({});
    expect(buildProjectOverrides(null)).toEqual({});
    expect(buildProjectOverrides({})).toEqual({});
  });

  it("一个 model 字段同时覆盖五个角色，不用填五遍", () => {
    const o = buildProjectOverrides({ model: "qwen-max" });
    expect(o.writerModel).toBe("qwen-max");
    expect(o.summarizeModel).toBe("qwen-max");
    expect(o.extractorModel).toBe("qwen-max");
  });

  it("纯空白视为没填，不覆盖", () => {
    expect(buildProjectOverrides({ model: "   ", apiKey: "", baseUrl: "  " })).toEqual({});
  });

  it("类型不对的字段直接忽略，不让脏数据污染配置", () => {
    expect(buildProjectOverrides({ model: 123, temperature: "0.5" })).toEqual({});
  });

  it("temperature 为 0 是合法值，不能因为「假值」被丢掉", () => {
    expect(buildProjectOverrides({ temperature: 0 })).toEqual({ defaultTemperature: 0 });
  });

  it("非对象输入安全返回空，不抛错", () => {
    expect(buildProjectOverrides("nonsense" as unknown as Record<string, unknown>)).toEqual({});
  });
});

// ─── 配置装配 ───────────────────────────────────────────────

describe("getEffectiveConfig —— 故障转移链解析", () => {
  const original = process.env.LLM_FALLBACK;
  afterEach(() => {
    if (original === undefined) delete process.env.LLM_FALLBACK;
    else process.env.LLM_FALLBACK = original;
  });

  it("解析 model@baseURL 与裸 model 两种写法", async () => {
    process.env.LLM_FALLBACK = "m1@https://a.example.com, m2";
    const cfg = await getEffectiveConfig();
    expect(cfg.fallbackModels).toEqual([
      { model: "m1", baseURL: "https://a.example.com" },
      { model: "m2" },
    ]);
  });

  it("没配环境变量时是空链，不做故障转移", async () => {
    delete process.env.LLM_FALLBACK;
    const cfg = await getEffectiveConfig();
    expect(cfg.fallbackModels).toEqual([]);
  });

  it("显式传入的覆盖项优先于环境变量", async () => {
    process.env.LLM_FALLBACK = "from-env";
    const cfg = await getEffectiveConfig({ fallbackModels: [{ model: "from-code" }] });
    expect(cfg.fallbackModels).toEqual([{ model: "from-code" }]);
  });
});
