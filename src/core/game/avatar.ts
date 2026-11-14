/**
 * 角色卡头像 —— 文件名哈希、立绘提示词、图片校验（纯函数，零 LLM）
 *
 * 用户口径（2026-11-14）：头像位可选择「导入」或「AI 生成」；
 * 生图服务在设置里可配置。
 *
 * 存储判据：头像是图片二进制，不塞 characterSheets JSON（会把整张档案撑爆），
 * 落盘 data/avatars/<sagaId>/<hash>.png（data/ 整目录 gitignore，用户数据不出本机）；
 * 档案里只记 avatarVersion（版本号），前端用它做缓存失效。
 */

export interface PortraitSource {
  name: string;
  role?: string;
  title?: string;
  appearance?: string;
  personality?: string;
  background?: string;
  abilities?: string[];
}

/** FNV-1a 32 位：文件名安全、确定性、可单测（人物重名靠 sagaId 目录隔离） */
export function avatarFileHash(name: string): string {
  const s = (name || "").trim() || "unnamed";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** data/avatars/<sagaId>/<hash>.png —— 路径拼装（sagaId 已是 uuid，name 只以哈希出现） */
export function avatarFilePath(sagaId: string, name: string): string {
  return `${sagaId}/${avatarFileHash(name)}.png`;
}

/**
 * 立绘提示词：从档案里已经知道的东西拼——外貌为主，身份/性格点睛。
 * 生图模型（Kolors 等）吃中文；不额外调一次 LLM 翻译——档案本身就是人写的。
 */
export function composePortraitPrompt(sheet: PortraitSource, synopsis?: string): string {
  const parts: string[] = [];
  const look = (sheet.appearance || "").trim();
  if (look) parts.push(look.slice(0, 120));
  const roleBits = [sheet.role, sheet.title].filter(Boolean).join("，");
  if (roleBits) parts.push(`${sheet.name}，${roleBits}`.slice(0, 60));
  const nature = (sheet.personality || "").trim();
  if (nature) parts.push(`气质${nature.slice(0, 30)}`);
  const bg = (sheet.background || "").trim();
  if (bg && parts.length < 2) parts.push(bg.slice(0, 80)); // 档案太空时背景顶上
  if (!parts.length) parts.push(sheet.name || "一位旅人");
  if (synopsis) parts.push(`画风贴合：${synopsis.slice(0, 60)}`);
  return `人物立绘插画，半身像，正面微侧，简洁留白背景：${parts.join("；")}。高质量，细节丰富，统一光影。`;
}

/** 生图尺寸：立绘用竖版（有的服务只认 1:1，失败时由客户端降级重试由调用方决定） */
export const PORTRAIT_SIZE = "768x1024";

/**
 * 校验并拆出 base64（导入路径）。
 * 接受 dataURL（data:image/png;base64,....）或裸 base64；
 * 只认 PNG/JPEG/WEBP 三种魔数——不认的一律拒绝，不当图片存。
 */
export function parseImageUpload(raw: string, maxBytes = 4 * 1024 * 1024):
  { ok: true; mime: "png" | "jpeg" | "webp"; bytes: Buffer } | { ok: false; error: string } {
  const s = (raw || "").trim();
  if (!s) return { ok: false, error: "没有收到图片数据" };
  const b64 = s.startsWith("data:") ? s.slice(s.indexOf(",") + 1) : s;
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, error: "图片数据不是合法的 base64" };
  }
  if (buf.length === 0) return { ok: false, error: "图片数据为空" };
  if (buf.length > maxBytes) return { ok: false, error: `图片超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限` };
  // 魔数判定：不看扩展名（前端说是什么不重要，字节说是什么才重要）
  if (buf[0] === 0x89 && buf[1] === 0x50) return { ok: true, mime: "png", bytes: buf };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { ok: true, mime: "jpeg", bytes: buf };
  if (buf.length > 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP")
    return { ok: true, mime: "webp", bytes: buf };
  return { ok: false, error: "只支持 PNG / JPG / WEBP 图片" };
}

/** 生图响应的宽容解析：认 OpenAI 风格 data[0] 与 SiliconFlow 风格 images[0]（url 或 b64_json） */
export function extractImageFromResponse(payload: unknown):
  { ok: true; url?: string; b64?: string } | { ok: false; error: string } {
  const p = payload as any;
  if (!p || typeof p !== "object") return { ok: false, error: "生图响应不是 JSON 对象" };
  const item = (Array.isArray(p.data) && p.data[0]) || (Array.isArray(p.images) && p.images[0]) || null;
  if (!item) return { ok: false, error: "生图响应里没有图片项" };
  if (typeof item.b64_json === "string" && item.b64_json) return { ok: true, b64: item.b64_json };
  if (typeof item.url === "string" && item.url) return { ok: true, url: item.url };
  if (typeof item.image_url === "string" && item.image_url) return { ok: true, url: item.image_url };
  return { ok: false, error: "图片项里既没有 url 也没有 b64_json" };
}
