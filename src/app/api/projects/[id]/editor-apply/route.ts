/**
 * 应用修改 —— 把审稿意见真正落到正文
 *
 * 接收前端选中的修改建议（按章节分组），对每一章调用本地 LLM 按意见改写，
 * 用版本快照 + editVersion+1 乐观锁落库，与手动保存/微调走同一套安全网。
 *
 * 请求体：{ items: [{ nodeId, suggestions: [{ location, issue, suggestion, rewriteHint }] }] }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runEditorApply } from "@/core/editor/review";
import { snapshotRevision } from "@/lib/versions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let items: Array<{ nodeId?: string; suggestions?: unknown }> = [];
  try {
    const body = (await request.json()) as { items?: unknown };
    if (Array.isArray(body?.items)) items = body.items as typeof items;
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!items.length) {
    return NextResponse.json({ error: "没有可应用的修改项" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const applied: Array<{
    nodeId: string;
    ok: boolean;
    wordCount?: number;
    error?: string;
  }> = [];

  for (const item of items) {
    const nodeId = item?.nodeId;
    const suggestions = Array.isArray(item?.suggestions) ? (item!.suggestions as any[]) : [];
    if (!nodeId || !suggestions.length) {
      applied.push({ nodeId: nodeId ?? "", ok: false, error: "缺少 nodeId 或建议" });
      continue;
    }

    try {
      const node = await prisma.storyNode.findUnique({
        where: { id: nodeId },
        select: { id: true, projectId: true, content: true, wordCount: true, editVersion: true, deletedAt: true, title: true, reviewLogs: true },
      });
      if (!node) {
        applied.push({ nodeId, ok: false, error: "章节不存在" });
        continue;
      }
      if (node.deletedAt) {
        applied.push({ nodeId, ok: false, error: "该章节已在回收站，无法改写" });
        continue;
      }
      const original = node.content || "";
      if (!original.trim()) {
        applied.push({ nodeId, ok: false, error: "原章节无正文" });
        continue;
      }

      const cleanSuggestions = suggestions
        .filter((s) => s && typeof s === "object")
        .map((s) => ({
          location: String(s.location ?? ""),
          issue: String(s.issue ?? ""),
          suggestion: String(s.suggestion ?? ""),
          rewriteHint: String(s.rewriteHint ?? s.suggestion ?? ""),
        }));

      const newContent = await runEditorApply({ content: original, suggestions: cleanSuggestions });

      // 安全护栏：空响应或过度缩短都视为失败，保留原正文（与微调路由同策略）
      if (!newContent || newContent.trim().length < 50) {
        applied.push({ nodeId, ok: false, error: "改写结果为空，已保留原正文，请重试" });
        continue;
      }
      if (newContent.length < original.length * 0.4) {
        applied.push({
          nodeId,
          ok: false,
          error: `改写后过短（${newContent.length} 字 vs 原 ${original.length} 字），疑似未完整重输出，已保留原正文`,
        });
        continue;
      }

      // 覆盖前先快照（去重由 helper 处理）
      await snapshotRevision({
        nodeId,
        projectId: node.projectId,
        source: "ai-rewrite",
        prevContent: original,
        prevWordCount: node.wordCount,
        summary: `模拟编辑审稿应用修改（${cleanSuggestions.length} 条建议）`,
      });

      const upd = await prisma.storyNode.update({
        where: { id: nodeId },
        data: {
          content: newContent,
          wordCount: newContent.replace(/\s+/g, "").length,
          editVersion: { increment: 1 },
          revisionCount: { increment: 1 },
          reviewLogs: [
            ...(Array.isArray(node.reviewLogs) ? node.reviewLogs : []),
            {
              action: "editor-apply",
              at: new Date().toISOString(),
              note: `按 ${cleanSuggestions.length} 条审稿意见应用修改`,
            },
          ],
        },
        select: { id: true, wordCount: true },
      });

      applied.push({ nodeId, ok: true, wordCount: upd.wordCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      applied.push({ nodeId, ok: false, error: `应用失败：${msg}` });
    }
  }

  const okCount = applied.filter((a) => a.ok).length;
  return NextResponse.json({
    applied,
    summary: { total: applied.length, ok: okCount, failed: applied.length - okCount },
  });
}
