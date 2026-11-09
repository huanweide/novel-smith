import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  callEmbedding,
  embedOne,
  embedBatch,
  isEmbeddingConfigured,
  EMBEDDING_BATCH_LIMIT,
} from "./embedding";

// mock 配置读取，避免真实网络与数据库
const mockGetSettings = vi.fn();
vi.mock("@/lib/llm", () => ({
  getSettings: () => mockGetSettings(),
}));

const OK_SETTINGS = {
  provider: "siliconflow",
  apiKey: "sk-test",
  model: "deepseek-ai/DeepSeek-V4-Flash",
  baseUrl: "https://api.siliconflow.cn/v1",
};

function okResponse(vectors: number[][]) {
  return {
    ok: true,
    json: async () => ({ data: vectors.map((embedding) => ({ embedding })) }),
  };
}

describe("isEmbeddingConfigured —— 没配 key 就不要发注定401 的请求", () => {
  it("key 与 baseURL 都在才算可用", () => {
    expect(isEmbeddingConfigured({ provider: "openai", apiKey: "sk-x", baseUrl: "https://x" })).toBe(true);
  });

  it("缺 key → 不可用", () => {
    expect(isEmbeddingConfigured({ provider: "openai", apiKey: "", baseUrl: "https://x" })).toBe(false);
    expect(isEmbeddingConfigured({ provider: "openai", apiKey: "   ", baseUrl: "https://x" })).toBe(false);
  });

  it("缺 baseURL → 不可用", () => {
    expect(isEmbeddingConfigured({ provider: "openai", apiKey: "sk-x", baseUrl: "" })).toBe(false);
  });

  it("本地推理（Ollama）无 key 也算可用 —— 不误伤本地部署", () => {
    // getSettings 对 local 特判：apiKey 为空是正常状态，不是「未配置」
    expect(isEmbeddingConfigured({ provider: "local", apiKey: "", baseUrl: "http://localhost:11434/v1" })).toBe(true);
    expect(isEmbeddingConfigured({ provider: "local", apiKey: "", baseUrl: "" })).toBe(false);
  });
});

describe("callEmbedding —— 任何失败都退 null，绝不抛异常", () => {
  beforeEach(() => {
    mockGetSettings.mockResolvedValue(OK_SETTINGS);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("正常返回：向量个数与入参一致", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse([[1, 0], [0, 1]])));
    const r = await callEmbedding(["甲", "乙"]);
    expect(r).toEqual([[1, 0], [0, 1]]);
  });

  it("请求体正确：走 /embeddings、带头、model 与chat 模型不同", async () => {
    const fetchMock = vi.fn(async () => okResponse([[1, 0]]));
    vi.stubGlobal("fetch", fetchMock);
    await callEmbedding(["甲"]);

    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("https://api.siliconflow.cn/v1/embeddings");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("BAAI/bge-m3"); // 与 chat 模型分离
    expect(body.input).toEqual(["甲"]);
  });

  it("baseURL 尾部斜杠被清理，不产生双斜杠", async () => {
    mockGetSettings.mockResolvedValue({ ...OK_SETTINGS, baseUrl: "https://x/v1///" });
    const fetchMock = vi.fn(async () => okResponse([[1, 0]]));
    vi.stubGlobal("fetch", fetchMock);
    await callEmbedding(["甲"]);
    expect((fetchMock.mock.calls[0] as any[])[0]).toBe("https://x/v1/embeddings");
  });

  it("HTTP 401 → null（不抛，让上层退回关键词召回）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    await expect(callEmbedding(["甲"])).resolves.toBeNull();
  });

  it("HTTP 500 → null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(callEmbedding(["甲"])).resolves.toBeNull();
  });

  it("网络异常（fetch 抛错）→ null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(callEmbedding(["甲"])).resolves.toBeNull();
  });

  it("JSON 解析失败 → null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new Error("bad json"); } })));
    await expect(callEmbedding(["甲"])).resolves.toBeNull();
  });

  it("返回条数与入参不一致 → null（错位比不给更危险）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse([[1, 0], [0, 1]])));
    await expect(callEmbedding(["只有一条"])).resolves.toBeNull();
  });

  it("向量字段缺失/为空/含非数 → null（脏数据不可用）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ embedding: [] }] }),
    })));
    await expect(callEmbedding(["甲"])).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, "x"] }] }),
    })));
    await expect(callEmbedding(["甲"])).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{}] }),
    })));
    await expect(callEmbedding(["甲"])).resolves.toBeNull();
  });

  it("无 data 字段 → null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    await expect(callEmbedding(["甲"])).resolves.toBeNull();
  });

  it("未配置 key → null 且不发请求（省一次白跑的网络往返）", async () => {
    mockGetSettings.mockResolvedValue({ provider: "openai", apiKey: "", baseUrl: "https://x" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(callEmbedding(["甲"])).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("空数组 / 全空字符串 → null（不发无意义请求）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(callEmbedding([])).resolves.toBeNull();
    await expect(callEmbedding(["", "  "])).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("本地推理：能发请求，但不携带 Authorization 头", async () => {
    mockGetSettings.mockResolvedValue({
      provider: "local",
      apiKey: "",
      model: "qwen2.5:7b",
      baseUrl: "http://localhost:11434/v1",
    });
    const fetchMock = vi.fn(async () => okResponse([[1, 0]]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callEmbedding(["甲"])).resolves.toEqual([[1, 0]]);
    const init = (fetchMock.mock.calls[0] as any[])[1];
    expect(init.headers.Authorization).toBeUndefined();
    // 本地模型默认名与云端不同
    expect(JSON.parse(init.body).model).toBe("nomic-embed-text");
  });

  it("混入空串仍保位（否则向量与文本对不上号）", async () => {
    const fetchMock = vi.fn(async () => okResponse([[1, 0], [0, 1]]));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callEmbedding(["甲", "  "]);
    expect(r).toHaveLength(2);
    expect(JSON.parse((fetchMock.mock.calls[0] as any[])[1].body).input).toEqual(["甲", ""]);
  });
});

describe("embedOne —— 单条便捷包装", () => {
  beforeEach(() => mockGetSettings.mockResolvedValue(OK_SETTINGS));
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("返回首个向量", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse([[0.1, 0.2]])));
    await expect(embedOne("甲")).resolves.toEqual([0.1, 0.2]);
  });

  it("失败 → null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(embedOne("甲")).resolves.toBeNull();
  });
});

describe("embedBatch —— 分批且保位", () => {
  beforeEach(() => mockGetSettings.mockResolvedValue(OK_SETTINGS));
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("未超批数：一次请求", async () => {
    const fetchMock = vi.fn(async () => okResponse([[1, 0], [0, 1], [1, 1]]));
    vi.stubGlobal("fetch", fetchMock);
    const r = await embedBatch(["a", "b", "c"]);
    expect(r).toEqual([[1, 0], [0, 1], [1, 1]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("超批数：拆成多批，结果仍与入参等长同序", async () => {
    const n = EMBEDDING_BATCH_LIMIT + 5;
    const fetchMock = vi.fn(async (_u: any, init: any) => {
      const input = JSON.parse(init.body).input as string[];
      return okResponse(input.map((t) => [t.length, 1]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const texts = Array.from({ length: n }, (_, i) => "x".repeat(i + 1));
    const r = await embedBatch(texts);

    expect(r).toHaveLength(n);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r[0]).toEqual([1, 1]);
    expect(r[n - 1]).toEqual([n, 1]); // 最后一条没串位
  });

  it("某批失败只让该批变null，不影响其他批", async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_u: any, init: any) => {
      call++;
      if (call === 2) return { ok: false, status: 500, json: async () => ({}) };
      const input = JSON.parse(init.body).input as string[];
      return okResponse(input.map(() => [1, 0]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await embedBatch(Array.from({ length: EMBEDDING_BATCH_LIMIT * 2 }, () => "t"));
    expect(r).toHaveLength(EMBEDDING_BATCH_LIMIT * 2);
    expect(r[0]).not.toBeNull();
    expect(r[EMBEDDING_BATCH_LIMIT]).toBeNull(); // 第二批失败
    expect(r[EMBEDDING_BATCH_LIMIT + 1]).toBeNull();
  });

  it("全批失败 → 全null（不是空数组，调用方要能区分「没向量」与「没输入」）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const r = await embedBatch(["a", "b"]);
    expect(r).toEqual([null, null]);
  });

  it("空输入 → 空数组", async () => {
    await expect(embedBatch([])).resolves.toEqual([]);
  });
});