/**
 * GET  /api/game/saga/[sagaId]/characters/avatar?name=…&v=…
 *   → 图片本体（PNG/JPEG/WEBP 原样回）；没生成过 → 404（前端回退到首字占位框）。
 *      v 是版本号（缓存失效用），服务端不读它。
 *
 * POST /api/game/saga/[sagaId]/characters/avatar
 *   body: { name, image?: dataURL或裸base64 }            → 导入本地图片
 *   body: { name, generate: true }                        → AI 生成（按设置里的生图配置）
 *   → { ok, avatarVersion }（版本号用于前端缓存失效）
 *
 * 存储判据（avatar.ts 头注释）：图片落 data/avatars/<sagaId>/<hash>.<ext>，
 * 档案 JSON 里只记 avatarVersion。data/ 整目录 gitignore，用户数据不出本机。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import {
  avatarFileHash,
  composePortraitPrompt,
  parseImageUpload,
  PORTRAIT_SIZE,
} from "@/core/game/avatar";
import { generateImage, IMAGE_DEFAULTS, sniffMime } from "@/core/llm/image-client";
import { completeText, getEffectiveConfig } from "@/core/llm/client";

/**
 * 提示词精炼：确定性拼的提示词拼不出性别与年龄段（「苏绾」是女名，但规则读不出来），
 * 交给一次轻 LLM 调用补齐——它只改写提示词，不碰判定、不碰数据。
 * 任何失败都回退确定性提示词（生成链路不因这一步而断）。
 */
async function refinePortraitPrompt(sheet: Record<string, any>, draft: string): Promise<string> {
  try {
    const refined = await completeText(
      "你是插画师的提示词作者。根据中文小说角色档案写一句中文人物立绘提示词。必须明确：性别、大致年龄段、服饰与气质（贴合身份背景）。只输出提示词本身，不要解释，不超过60字。",
      `角色名：${sheet?.name || "未知"}\n身份：${sheet?.role || "不详"}${sheet?.title ? ` · ${sheet.title}` : ""}\n外貌：${sheet?.appearance || "档案未填，按名字与身份合理推断"}\n性格：${sheet?.personality || "不详"}\n背景：${(sheet?.background || "不详").slice(0, 120)}\n\n初稿（供参考，可改写得更准）：${draft}`,
      { maxTokens: 120, temperature: 0.4 }
    );
    const t = (refined || "").trim().replace(/^["「]|["」]$/g, "");
    return t.length >= 10 && t.length <= 120 ? t : draft;
  } catch {
    return draft;
  }
}

type Params = { params: Promise<{ sagaId: string }> };

export const maxDuration = 120;

/** data/ 目录锚点：next 进程的工作目录 = 项目根（dev 与 start 一致）；electron 打包时也在 userData 前的项目内 */
function avatarsDir(sagaId: string): string {
  return path.join(process.cwd(), "data", "avatars", sagaId);
}

// ─── GET：读图 ────────────────────────────────────────────────

export async function GET(req: Request, { params }: Params) {
  const { sagaId } = await params;
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") || "").trim();
  if (!name) return NextResponse.json({ error: "缺少角色名" }, { status: 400 });

  // 文件名 = 名字哈希（avatarFilePath 返回 "<sagaId>/<hash>.png"，取文件名部分）；
  // 扩展名由写入时的 mime 决定，png/jpeg/webp 都找一遍。
  const hash = avatarFileHash(name);
  const dir = avatarsDir(sagaId);
  for (const [ext, type] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]] as const) {
    try {
      const buf = await readFile(path.join(dir, `${hash}.${ext}`));
      return new Response(new Uint8Array(buf), {
        headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
      });
    } catch { /* 下一个扩展名 */ }
  }
  return NextResponse.json({ error: "还没设置头像" }, { status: 404 });
}

// ─── POST：导入 / 生成 ────────────────────────────────────────

export async function POST(req: Request, { params }: Params) {
  const { sagaId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "缺少角色名" }, { status: 400 });

    const saga = await prisma.gameSaga.findUnique({
      where: { id: sagaId },
      select: { characterSheets: true, projectId: true },
    });
    if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });

    const all: Record<string, any> =
      saga.characterSheets && typeof saga.characterSheets === "object"
        ? { ...(saga.characterSheets as Record<string, any>) }
        : {};
    const sheet = all[name] || { name };

    let bytes: Buffer;
    let mime: "png" | "jpeg" | "webp";

    if (body.generate) {
      // ── AI 生成：设置里解析生图配置（Key 留空=跟随文本 Key） ──
      const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
      const apiKey = settings?.imageApiKey || settings?.llmApiKey || "";
      if (!apiKey) {
        return NextResponse.json({ error: "还没配置生图 API Key——设置里填一个（或直接用文本 Key）" }, { status: 400 });
      }
      let synopsis = "";
      if (saga.projectId) {
        try {
          const proj = await prisma.project.findUnique({ where: { id: saga.projectId }, select: { synopsis: true } });
          synopsis = proj?.synopsis || "";
        } catch { /* 世界观拿不到不影响生成 */ }
      }
      const prompt = await refinePortraitPrompt(sheet, composePortraitPrompt(sheet, synopsis));
      const result = await generateImage(
        {
          baseUrl: settings?.imageBaseUrl || IMAGE_DEFAULTS.baseUrl,
          apiKey,
          model: settings?.imageModel || "",
        },
        prompt,
        PORTRAIT_SIZE
      );
      if (!result.ok || !result.bytes) {
        return NextResponse.json({ error: result.error || "生成失败" }, { status: 502 });
      }
      bytes = result.bytes;
      mime = result.mime || sniffMime(undefined, bytes);
    } else {
      // ── 导入本地图片：魔数校验，不看扩展名 ──
      const parsed = parseImageUpload(String(body.image || ""));
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      bytes = parsed.bytes;
      mime = parsed.mime;
    }

    // ── 落盘 + 版本号 ──
    const dir = avatarsDir(sagaId);
    await mkdir(dir, { recursive: true });
    const fileBase = avatarFileHash(name);
    await writeFile(path.join(dir, `${fileBase}.${mime}`), bytes);
    // 换格式覆盖后清掉旧扩展名，不留死文件（尽力而为，没有旧文件就算了）
    const { unlink } = await import("fs/promises");
    for (const ext of ["png", "jpeg", "webp"]) {
      if (ext !== mime) {
        try { await unlink(path.join(dir, `${fileBase}.${ext}`)); } catch { /* 没有就算了 */ }
      }
    }

    const prevVersion = Number(sheet.avatarVersion || 0);
    all[name] = { ...sheet, name, avatarVersion: prevVersion + 1, updatedAt: new Date().toISOString() };
    await prisma.gameSaga.update({
      where: { id: sagaId },
      data: { characterSheets: all },
      select: { characterSheets: true },
    });

    return NextResponse.json({ ok: true, avatarVersion: prevVersion + 1 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "头像保存失败" }, { status: 500 });
  }
}
