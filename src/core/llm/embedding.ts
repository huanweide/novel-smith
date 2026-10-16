// ============================================================
// Embedding（向量嵌入）—— 把一段文字翻译成一串数字
// ============================================================
//
// 【这个功能对用户有什么用】
//   录了设定「北境守将 · 曾率部倒戈」，正文里写的是「那个叛变北境的将军」。
//   字面对不上 → 这条设定不会告诉 AI → AI 只知道「将军」通常指忠臣 → 把叛徒写成了忠臣。
//   本文件负责让「叛变北境的将军」和「北境守将·曾率部倒戈」能被认成同一件事。
//
// 【落点说明 —— 为什么在这里，不在 src/lib/llm.ts】
//   src/lib/llm.ts 顶部写明「非流式 LLM 请求已统一收敛到 core/llm/client.ts，本文件不再
//   承载裸 fetch 调用封装」。embedding 同样是一次外部模型调用，因此放 core/llm/ 下。
//   配置读取复用 lib/llm.ts 的 getSettings()（已内置预设 provider 的 Base URL 净化、
//   local 特判、60 秒缓存），不新开通道、不引新依赖。
//
// 【不做什么】
//   - 不引第三方向量 SDK：各厂商 embedding 接口都是 OpenAI 兼容的 /v1/embeddings，
//     一个 fetch 就够，装 SDK 只会增加依赖面与供应链风险。
//   - 不做向量数据库：本地设定库量级在数百条，全量余弦几十毫秒算完。
//   - 不吞错误：任何失败都返回 null 而不是抛异常——embedding 是**增强**，
//     失败必须静默退回纯关键词召回，绝不能让作者写不了字。
//
// 【与纯函数层的关系】
//   本文件只负责「拿到向量」；怎么比（余弦、混合打分、阈值）全在 memory/hybrid-score.ts。
//   两层分开是有意的：出问题时能立刻分清是网络/接口的问题，还是比对逻辑的问题。

import { getSettings } from "@/lib/llm";

/** 各提供商的默认 embedding 模型。刻意与 chat 模型分开——两者不能混用。 */
const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: "text-embedding-3-small",
  siliconflow: "BAAI/bge-m3",
  deepseek: "deepseek-embed",
  groq: "nomic-embed-text",
  local: "nomic-embed-text",
};

/** embedding 请求超时。比对聊天短，但要留网络余量。 */
const EMBEDDING_TIMEOUT_MS = 20_000;

/** 环境变量可覆盖模型名，不配就用上表默认值。 */
function resolveEmbeddingModel(provider: string, baseURL: string): string {
  const envKey =
    process.env.LLM_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || "";
  if (envKey.trim()) return envKey.trim();

  const fallback = DEFAULT_EMBEDDING_MODELS[provider];
  if (fallback) return fallback;

  // 本地 Ollama 等未登记的 provider：本地部署常见模型名兜底
  if (provider === "local" || baseURL.includes("11434")) return "nomic-embed-text";

  return "text-embedding-3-small";
}

/** 判断是否具备调用条件。没配 key 时直接跳过，绝不硬发一个注定 401 的请求。 */
export function isEmbeddingConfigured(config: {
  provider: string;
  apiKey: string;
  baseUrl: string;
}): boolean {
  // 本地推理（Ollama 等）没有 API Key，靠 baseUrl + 模型名即可调用，不算未配置
  if (config.provider === "local") return Boolean(config.baseUrl);
  return Boolean(config.apiKey && config.apiKey.trim() && config.baseUrl);
}

/**
 * 调用供应商的 embedding 接口，返回与输入等长的向量数组。
 *
 * **任何失败一律返回 null**，不抛异常。理由：embedding 是增强项而非必需项，
 * 作者没配 key、网络抖动、余额不足，都应该退回纯关键词召回，而不是让写不了字。
 *
 * @param texts 待向量化的文本数组
 * @returns 与 texts 等长的 number[][]；不可用时返回 null
 */
export async function callEmbedding(texts: string[]): Promise<number[][] | null> {
  if (!Array.isArray(texts) || texts.length === 0) return null;

  // 注意：走 getSettings() 而非 getEffectiveConfig()。
  // 后者返回的是 LLMConfig（无 provider 字段，chat 专用）；embedding 需要 provider 来选模型，
  // 且 getSettings 已内置「预设 provider 强制用代码内Base URL」「local 特判」等净化逻辑。
  const settings = await getSettings();
  if (!isEmbeddingConfigured(settings)) return null;

  // 空串在多数接口会报错，直接剔除；但索引必须保位，否则返回的向量与入参对不上
  const payload = texts.map((t) => (typeof t === "string" ? t.trim() : ""));
  if (payload.every((t) => t.length === 0)) return null;

  const model = resolveEmbeddingModel(settings.provider, settings.baseUrl);
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/embeddings`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 本地推理无 key 时不发 Authorization 头，否则部分本地服务会因未知头而报错
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: payload }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const json: any = await res.json();
    const data = json?.data;
    if (!Array.isArray(data) || data.length !== payload.length) return null;

    const out: number[][] = new Array(payload.length);
    for (let i = 0; i < payload.length; i++) {
      const vec = data[i]?.embedding;
      // 逐项校验：脏数据（空/非数组/含非数）整条判为不可用
      if (!Array.isArray(vec) || vec.length === 0) return null;
      if (!vec.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) return null;
      out[i] = vec as number[];
    }
    return out;
  } catch {
    // 网络错误 / 超时 / JSON 解析失败 —— 全部静默退回关键词召回
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 单条文本的便捷包装（正文本身向量化时用）。 */
export async function embedOne(text: string): Promise<number[] | null> {
  const r = await callEmbedding([text]);
  return r && Array.isArray(r[0]) ? r[0] : null;
}

/** 批量上限。超长文本需分批，否则单请求体过大且计费变贵。 */
export const EMBEDDING_BATCH_LIMIT = 64;

/**
 * 分批向量化，返回与入参等长的结果数组。
 * 某一批失败则该批全部填null——「未向量化」与「不像」是两种状态，不可混淆。
 */
export async function embedBatch(texts: string[]): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = new Array(texts.length).fill(null);
  if (!Array.isArray(texts) || texts.length === 0) return out;

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_LIMIT) {
    const slice = texts.slice(i, i + EMBEDDING_BATCH_LIMIT);
    const res = await callEmbedding(slice);
    if (!res) continue; // 该批留null，不影响其他批
    for (let j = 0; j < slice.length; j++) out[i + j] = res[j];
  }
  return out;
}