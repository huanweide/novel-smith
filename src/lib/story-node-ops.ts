/**
 * 章节/卷相关的共享操作：重编号 + 级联删除孤儿记录。
 * 抽出来是因为软删（DELETE）与彻底删（purge）两条路径都需要同一套逻辑，
 * 避免「顶层重编号」函数被复制两份、且都忽略了分卷内重新计数。
 *
 * 编号规则（与既有行为一致，扩展到分卷）：
 *  - 把标题里的「第X章：」前缀剥掉后，按存活节点顺序重排为 第1章 / 第2章 …
 *  - 顶层章节一组；每个 volume 内部的子章节各自一组，互不干扰
 *  - 因此「分卷后新卷从第一章重新计数」天然成立
 */
import { prisma } from "@/lib/prisma";

const cnDigits = [
  "零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "二十一", "二十二", "二十三", "二十四", "二十五", "二十六", "二十七", "二十八", "二十九", "三十",
];
const toCn = (n: number) => cnDigits[n] || String(n);

const TITLE_RE = /^第[一二三四五六七八九十百千\d]+章[：:\s]*/;

async function renumberGroup(projectId: string, parentId: string | null) {
  const remaining = await prisma.storyNode.findMany({
    where: { projectId, parentId, type: { not: "volume" }, deletedAt: null },
    orderBy: { order: "asc" },
  });
  for (let i = 0; i < remaining.length; i++) {
    const ch = remaining[i];
    const rawTitle = (ch.title || "").replace(TITLE_RE, "");
    const newTitle = rawTitle ? `第${toCn(i + 1)}章：${rawTitle}` : `第${toCn(i + 1)}章`;
    await prisma.storyNode.update({
      where: { id: ch.id },
      data: { title: newTitle, order: i },
    });
  }
}

/** 重编号：顶层一组 + 每个 volume 内部一组，各自从 第1章 起算 */
export async function renumberChapters(projectId: string) {
  await renumberGroup(projectId, null);
  const volumes = await prisma.storyNode.findMany({
    where: { projectId, type: "volume", deletedAt: null },
    select: { id: true },
  });
  for (const v of volumes) {
    await renumberGroup(projectId, v.id);
  }
}

/**
 * 级联删除某子树关联的「孤儿记录」（String 外键引用、schema 无 onDelete Cascade）。
 * 包括：章节摘要 / 故事节拍 / 未兑现伏笔 / 待办项。
 * 删除章节时一并清掉，避免脏数据污染写作上下文。
 */
export async function cascadeDeleteOrphans(subtreeIds: string[]) {
  if (subtreeIds.length === 0) return;
  await prisma.$transaction([
    prisma.chapterSummary.deleteMany({ where: { chapterId: { in: subtreeIds } } }),
    prisma.storyBeat.deleteMany({ where: { nodeId: { in: subtreeIds } } }),
    prisma.pendingCommitment.deleteMany({ where: { sourceNodeId: { in: subtreeIds } } }),
    prisma.pendingItem.deleteMany({ where: { sourceNodeId: { in: subtreeIds } } }),
  ]);
}
