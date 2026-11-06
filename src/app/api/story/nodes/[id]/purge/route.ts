import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-error";
import { createSnapshot } from "@/lib/db-snapshot";
import { renumberChapters, cascadeDeleteOrphans } from "@/lib/story-node-ops";

// 收集某节点整棵子树（含自身）的全部 id
async function collectSubtreeIds(projectId: string, rootId: string): Promise<string[]> {
  const all = await prisma.storyNode.findMany({
    where: { projectId },
    select: { id: true, parentId: true },
  });
  const childrenMap = new Map<string | null, string[]>();
  for (const n of all) {
    const key = n.parentId ?? null;
    const arr = childrenMap.get(key) ?? [];
    arr.push(n.id);
    childrenMap.set(key, arr);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    ids.push(cur);
    for (const c of childrenMap.get(cur) ?? []) stack.push(c);
  }
  return ids;
}

// POST /api/story/nodes/[id]/purge —— #123 彻底删除（硬删，级联子树 + 清孤儿记录 + 重新编号）
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const node = await prisma.storyNode.findUnique({ where: { id }, select: { id: true, projectId: true, parentId: true, type: true, deletedAt: true } });
    if (!node) {
      return NextResponse.json({ error: "节点不存在" }, { status: 404 });
    }
    // 防丢：删前自动留一份快照
    try {
      await createSnapshot("pre-delete");
    } catch {
      /* 快照失败不阻断删除 */
    }
    const subtreeIds = await collectSubtreeIds(node.projectId, id);
    // 清关联孤儿（String 引用子记录，schema 无 onDelete Cascade），杜绝污染写作上下文
    await cascadeDeleteOrphans(subtreeIds);
    await prisma.storyNode.deleteMany({ where: { id: { in: subtreeIds } } });
    // 重编号：顶层 + 各分卷内部各自从 第1章 起算
    await renumberChapters(node.projectId);
    return NextResponse.json({ success: true, purged: true, count: subtreeIds.length });
  } catch (err) {
    return jsonError(err);
  }
}
