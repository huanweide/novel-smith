/**
 * 分章打包导出 —— 按目标平台排版，返回「每章一个独立 .txt」的结构
 *
 * 前端拿到 chapters 数组后用 JSZip 在本地打包成 zip 下载，便于作者批量上传平台后台，无需手动拆分。
 * 全程本地处理，不联网、不上传稿件。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  formatChapterTitle,
  formatForPlatform,
  type PublishPlatform,
} from "@/core/publish/pipeline";

const FORMAT_PLATFORMS: PublishPlatform[] = ["fanqie", "qidian", "wechat", "general"];

/** 文件名安全化（去掉 Windows/类 Unix 非法字符，限长，保证 zip 内可被正常解压） */
function safeFileName(rawTitle: string, order: number, platform: PublishPlatform): string {
  const title = formatChapterTitle(rawTitle, order, platform);
  const cleaned = title
    .replace(/[\\/:*?"<>|\n\r\t]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const idx = String(order + 1).padStart(3, "0");
  return `${idx}_${cleaned || "未命名"}.txt`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let platform: PublishPlatform = "general";
  let includeAttribution = true;
  try {
    const body = (await request.json()) as { platform?: unknown; includeAttribution?: unknown };
    if (typeof body?.platform === "string" && FORMAT_PLATFORMS.includes(body.platform as PublishPlatform)) {
      platform = body.platform as PublishPlatform;
    }
    if (typeof body?.includeAttribution === "boolean") includeAttribution = body.includeAttribution;
  } catch {
    /* 默认 general + 带署名 */
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const nodes = await prisma.storyNode.findMany({
    where: { projectId: id, deletedAt: null },
    select: { id: true, order: true, title: true, content: true },
    orderBy: { order: "asc" },
  });

  const active = (nodes || [])
    .filter((n) => (n.content || "").trim())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const chapters = active.map((n) => {
    const formattedTitle = formatChapterTitle(n.title, n.order, platform);
    const body = formatForPlatform(n.content || "", platform);
    return {
      order: n.order,
      nodeId: n.id,
      title: formattedTitle,
      filename: safeFileName(n.title, n.order, platform),
      content: `${formattedTitle}\n\n${body}`,
    };
  });

  const totalWords = chapters.reduce((s, c) => s + (c.content.replace(/\s+/g, "").length), 0);

  let readme = "";
  if (includeAttribution) {
    readme =
      `《${project.name || "未命名作品"}》章节分卷导出\n` +
      `本书使用 novel-smith（https://github.com/huanweide/novel-smith）辅助创作。\n` +
      `导出平台规范：${platform}　章节数：${chapters.length}　总字数：${totalWords}\n` +
      `每章为独立 .txt 文件，可直接批量上传平台后台。`;
  }

  return NextResponse.json({
    platform,
    platformLabel: platform,
    totalChapters: chapters.length,
    totalWords,
    chapters,
    readme: includeAttribution ? readme : "",
    meta: { projectName: project.name || "未命名作品" },
  });
}
