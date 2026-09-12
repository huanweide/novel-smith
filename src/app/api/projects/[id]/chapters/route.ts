/**
 * 轻量章节清单 —— GET /api/projects/[id]/chapters
 *
 * 只返回章节的 id / order / title / 字数（**不带正文**），供「模拟审稿」面板的
 * 「指定单章」下拉懒加载使用，避免为了选一章就把全书正文拉到前端。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-error";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const nodes = await prisma.storyNode.findMany({
      where: { projectId: id, deletedAt: null },
      select: { id: true, order: true, title: true, content: true },
      orderBy: { order: "asc" },
    });

    const chapters = (nodes || [])
      .filter((n) => (n.content || "").trim())
      .map((n) => ({
        id: n.id,
        order: n.order,
        title: n.title || `第${n.order + 1}章`,
        words: (n.content || "").replace(/\s+/g, "").length,
      }));

    return NextResponse.json({
      chapters,
      meta: { projectId: id, total: chapters.length },
    });
  } catch (err) {
    return jsonError(err);
  }
}
