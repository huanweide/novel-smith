/**
 * 轻量章节清单 —— GET /api/projects/[id]/chapters
 *
 * 只返回章节的 id / order / title / 字数（**不带正文**），供「模拟审稿」面板的
 * 「指定单章」下拉懒加载使用，避免为了选一章就把全书正文拉到前端。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-error";

/** 安全读取 includeFrontMatter：url 缺失或非法时默认「带前置页」。 */
function readIncludeFrontMatter(url: string | undefined): boolean {
  if (!url) return true;
  try {
    return new URL(url).searchParams.get("includeFrontMatter") !== "0";
  } catch {
    return true;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {  try {
    const { id } = await params;
    // 阅读器要能看到导入的前置页（扉页/人物表/简介），默认带上；
    // 审稿面板只想要正文章节，传 includeFrontMatter=0 排除。
    // 防御：单元测试可能传入空 request，此时按默认「带前置页」处理。
    const includeFrontMatter = readIncludeFrontMatter(request?.url);

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const nodes = await prisma.storyNode.findMany({
      where: { projectId: id, deletedAt: null },
      select: {
        id: true,
        order: true,
        title: true,
        content: true,
        type: true,
        importKind: true,
      },
      orderBy: { order: "asc" },
    });

    const chapters = (nodes || [])
      // 有正文才算可读条目（导入的卷名页是 0 字，自然被这里滤掉）
      .filter((n) => (n.content || "").trim())
      .filter((n) => includeFrontMatter || n.importKind !== "frontmatter")
      .map((n) => ({
        id: n.id,
        order: n.order,
        title: n.title || `第${n.order + 1}章`,
        words: (n.content || "").replace(/\s+/g, "").length,
        // 导入节点带上角色，前端可折叠附录/显示"导入"标记
        ...(n.importKind ? { importKind: n.importKind, source: "imported" } : {}),
      }));

    return NextResponse.json({
      chapters,
      meta: { projectId: id, total: chapters.length },
    });
  } catch (err) {
    return jsonError(err);
  }
}
