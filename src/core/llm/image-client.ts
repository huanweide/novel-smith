/**
 * 生图客户端 —— 角色卡头像的 AI 生成（2026-11-14）
 *
 * 与文本 LLM（client.ts）分开：生图服务常不是同一家，配置也分开
 * （AppSettings.imageBaseUrl / imageApiKey / imageModel，留空各自兜底）。
 *
 * 协议双认（宽容）：
 *   · SiliconFlow 风格：POST {base}/images/generations，body 用 image_size，响应 images[].url
 *   · OpenAI 风格：同路径，body 用 size，响应 data[].url / data[].b64_json
 *   base URL 里带 siliconflow 就走前者，否则走后者；响应两样都认（extractImageFromResponse）。
 *
 * 铁律：生图失败不炸卡——返回 {ok:false,error}，调用方保留旧头像并如实提示。
 */

export interface ImageClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 留空兜底：Base=硅基流动、Key=跟随文本 Key、模型=Kolors（由调用方从 AppSettings 解析后传入） */
export const IMAGE_DEFAULTS = {
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "Kwai-Kolors/Kolors",
} as const;

export interface GenerateImageResult {
  ok: boolean;
  /** 图片二进制（成功时有） */
  bytes?: Buffer;
  mime?: "png" | "jpeg" | "webp";
  error?: string;
}

/**
 * 生一张图。prompt 由调用方拼（avatar.ts 的 composePortraitPrompt）。
 * 超时 90s（生图比文本慢得多）；HTTP 非 2xx 时把状态与片段带回去，不吞错。
 */
export async function generateImage(
  cfg: ImageClientConfig,
  prompt: string,
  size: string
): Promise<GenerateImageResult> {
  const base = (cfg.baseUrl || IMAGE_DEFAULTS.baseUrl).replace(/\/+$/, "");
  const isSilicon = /siliconflow/i.test(base);
  const body: Record<string, unknown> = isSilicon
    ? { model: cfg.model || IMAGE_DEFAULTS.model, prompt, image_size: size }
    : { model: cfg.model || IMAGE_DEFAULTS.model, prompt, size, n: 1, response_format: "b64_json" };

  let res: Response;
  try {
    res = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e: any) {
    return { ok: false, error: `连不上生图服务：${e?.message || e}` };
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, error: `生图服务返回 ${res.status}${text ? `：${text}` : ""}` };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: "生图响应不是 JSON" };
  }

  // 宽容解析放这里跑不了纯函数测试？——解析逻辑在 avatar.ts（纯），这里只做 IO 胶水。
  // 为了不循环依赖，把解析结果再走一次本地判定：
  const p = payload as any;
  const item = (Array.isArray(p?.data) && p.data[0]) || (Array.isArray(p?.images) && p.images[0]) || null;
  if (!item) return { ok: false, error: "生图响应里没有图片项" };

  if (typeof item.b64_json === "string" && item.b64_json) {
    return { ok: true, bytes: Buffer.from(item.b64_json, "base64"), mime: sniffMime(item.b64_json) };
  }
  const url = typeof item.url === "string" ? item.url : typeof item.image_url === "string" ? item.image_url : "";
  if (!url) return { ok: false, error: "图片项里既没有 url 也没有 b64_json" };

  // URL 型：下载回来（ SiliconFlow 的链接是临时 CDN，不落地就丢）
  try {
    const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) return { ok: false, error: `图片下载失败 ${img.status}` };
    const ab = await img.arrayBuffer();
    const bytes = Buffer.from(ab);
    const mime = sniffMime(bytes.toString("base64").length > 8 ? bytes.toString("base64") : "", bytes);
    return { ok: true, bytes, mime };
  } catch (e: any) {
    return { ok: false, error: `图片下载失败：${e?.message || e}` };
  }
}

/** 魔数嗅探：PNG / JPEG / WEBP，其余按 png 存（服务方说是什么不重要） */
export function sniffMime(_b64?: string, bytes?: Buffer): "png" | "jpeg" | "webp" {
  const b = bytes || Buffer.from(_b64 || "", "base64");
  if (b.length > 1 && b[0] === 0x89 && b[1] === 0x50) return "png";
  if (b.length > 1 && b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b.length > 12 && b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "webp";
  return "png";
}
