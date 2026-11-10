/**
 * 番茄小说发布 · 单章体检（不落库，发布台里的「先看看这章能不能发」）
 *
 * POST { title, content, chapterOrder }
 */
import { NextResponse } from "next/server";
import { safeJson } from "@/lib/api-body";
import { preflightChapter } from "@/core/publish/fanqie/preflight";
import { formatForPlatform, formatChapterTitle } from "@/core/publish/pipeline";

export async function POST(req: Request) {
  const parsed = await safeJson(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as any;
  try {
    const order = Math.max(1, Math.floor(Number(body.chapterOrder) || 1));
    const formatted = body.raw === true ? String(body.content || "") : formatForPlatform(String(body.content || ""), "fanqie");
    const title = formatChapterTitle(String(body.title || ""), order - 1, "fanqie");
    const result = preflightChapter({ title, content: formatted, chapterOrder: order });
    return NextResponse.json({
      ok: true,
      preflight: result,
      title,
      /** 排版后的正文：界面上可一键采用 */
      content: formatted,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "体检失败" }, { status: 500 });
  }
}
