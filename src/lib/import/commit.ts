/**
 * 导入落库服务（Import Novel · M2）
 *
 * 核心决定：导入的章节**直接进现有 StoryNode 链**，不另开归档表。
 *   - 阅读器 /read 读同一批节点 → 天然能读
 *   - 写作区看到的是同一批节点 → 天然能改
 *   - 续写 = 在最后一章后接一个 source=user 的新节点，零额外架构
 *
 * 三个字段撑起"带前史的建项目"：
 *   source        imported | ai | user —— 续写内容不污染原始导入正文
 *   importKind    frontmatter | volume | chapter —— 附录/卷名页/正文章节分开对待
 *   importSourceKey —— 同一文件重复导入幂等，不产生第二份
 */

import { prisma } from "@/lib/prisma";
import type { ParsedNovel } from "@/lib/import/types";
import { checkHealth, type NovelHealth } from "@/lib/import/types";

/** 导入角色：与 StoryNode.importKind 一一对应 */
export type ImportKind = "frontmatter" | "volume" | "chapter";

export interface CommitInput {
  projectId: string;
  novel: ParsedNovel;
  /** 文件名（含扩展名），用于生成幂等键与书名兜底 */
  fileName?: string;
  /** 附加到项目简介里的导入摘要 */
  summary?: string;
}

export interface CommitResult {
  ok: boolean;
  /** 幂等命中：同一个文件此前已导入过 */
  duplicate: boolean;
  created: { frontmatter: number; volume: number; chapter: number };
  /** 最后一条正文章节节点 id —— 「从此继续写」的锚点 */
  lastChapterNodeId: string | null;
  /** 本次导入的来源指纹（M3 提炼出的资产要靠它溯源） */
  sourceKey: string | null;
  health: NovelHealth;
  message: string;
}

/** 由文件名生成幂等键：路径 + 大小 + 前若干字节，够用且不依赖 Node crypto */
function makeSourceKey(fileName: string | undefined, buf?: Buffer): string | null {
  if (!fileName) return null;
  const size = buf?.length ?? 0;
  const head = buf ? buf.subarray(0, 64).toString("base64") : "";
  return `${fileName}::${size}::${head.length}`.slice(0, 180);
}

/**
 * 按健康度报告给每章定角色。
 * 直接复用 M1 的判定（frontMatter / emptyNodes），避免 M2 再写一套识别逻辑——
 * 两套规则必然漂移，那才是真坑。
 */
function classify(
  health: NovelHealth,
  chapterIndex: number,
  fallbackKind: ImportKind,
): ImportKind {
  if (health.frontMatter.includes(chapterIndex)) return "frontmatter";
  if (health.emptyNodes.includes(chapterIndex)) return "volume";
  return fallbackKind;
}

/**
 * 落库主入口。
 *
 * 整体放一个事务：导入要么整本成功，要么整本不落——
 * 半本书（后面章节丢了）比不导入更糟，因为用户看不出来。
 */
export async function commitImport(input: CommitInput): Promise<CommitResult> {
  const { projectId, novel, fileName } = input;
  const health = checkHealth(novel);
  const sourceKey = makeSourceKey(fileName);

  const empty = (duplicate: boolean, message: string): CommitResult => ({
    ok: true,
    duplicate,
    created: { frontmatter: 0, volume: 0, chapter: 0 },
    lastChapterNodeId: null,
    sourceKey,
    health,
    message,
  });

  if (novel.chapters.length === 0) {
    return { ...empty(false, "没有可导入的章节"), ok: false };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    return { ...empty(false, `项目不存在：${projectId}`), ok: false };
  }

  // 幂等：同一个文件已导入过就直接返回，不产生第二份
  if (sourceKey) {
    const existing = await prisma.storyNode.findFirst({
      where: { projectId, importSourceKey: sourceKey },
      select: { id: true, type: true },
      orderBy: { order: "desc" },
    });
    if (existing) {
      return {
        ...empty(true, `《${project.name}》已导入过这个文件，未重复创建`),
        lastChapterNodeId: existing.type === "chapter" ? existing.id : null,
        sourceKey,
      };
    }
  }

  // 导入正文落在已存在的根节点之后，不覆盖用户已有的写作区内容
  const maxOrder = await prisma.storyNode.aggregate({
    where: { projectId, parentId: null, deletedAt: null },
    _max: { order: true },
  });
  let order = maxOrder._max.order ?? -1;

  const rows = novel.chapters.map((c) => {
    order += 1;
    const kind = classify(health, c.index, "chapter");
    return {
      projectId,
      parentId: null,
      type: kind === "volume" ? "volume" : "chapter",
      title: c.title.slice(0, 200),
      order,
      // 导入的正文是「已完成」状态：它是成品，不是待写的大纲
      status: "completed",
      content: c.content,
      wordCount: c.wordCount,
      source: "imported",
      importKind: kind,
      importSourceKey: sourceKey,
      confirmedAt: new Date(),
    };
  });

  // createMany 比逐条 create 快一个数量级（600 章的书逐条插入会卡到界面无响应）
  const created = await prisma.$transaction(async (tx) => {
    await tx.storyNode.createMany({ data: rows });
    const last = rows[rows.length - 1]!;
    return { lastTitle: last.title, lastOrder: last.order, lastType: last.type };
  });

  // 回查最后一条正文章节的 id（createMany 不返回 id）
  const lastNode = await prisma.storyNode.findFirst({
    where: {
      projectId,
      importSourceKey: sourceKey,
      type: "chapter",
      wordCount: { gt: 0 },
    },
    select: { id: true, order: true },
    orderBy: { order: "desc" },
  });

  const created_ = {
    frontmatter: health.frontMatter.filter(
      (i) => !health.emptyNodes.includes(i),
    ).length,
    volume: health.emptyNodes.length,
    chapter: rows.length - health.frontMatter.length,
  };

  return {
    ok: true,
    duplicate: false,
    created: created_,
    lastChapterNodeId: lastNode?.id ?? null,
    sourceKey,
    health,
    message:
      `已导入《${project.name}》共 ${rows.length} 个节点` +
      `（正文 ${created_.chapter} 章 / 卷 ${created_.volume} / 附录 ${created_.frontmatter}），` +
      `合计 ${health.totalWords.toLocaleString()} 字。`,
  };
}

/**
 * 「从此继续写」：在导入内容之后接一个新章节节点。
 *
 * 为什么要单独一个函数而不是让UI 调 POST /api/story/nodes：
 * 这里要保证 order 排在所有导入节点之后、source=user、并且带上
 * 「接的是哪一章之后」这个线索——否则续写上下文里不知道前情在哪。
 */
export async function continueAfterImport(params: {
  projectId: string;
  /** 承接的源章节 id（阅读器当前所在章） */
  afterNodeId?: string | null;
  title?: string;
  /** 从导入正文里摘的前情摘要，喂给续写上下文 */
  contextDigest?: string;
}): Promise<{ id: string; order: number; title: string } | null> {
  const { projectId, afterNodeId, title } = params;
  const maxOrder = await prisma.storyNode.aggregate({
    where: { projectId, parentId: null, deletedAt: null },
    _max: { order: true },
  });
  const order = (maxOrder._max.order ?? -1) + 1;

  const notes = params.contextDigest
    ? `【接续线索】承接自导入内容：${params.contextDigest}`
    : "由「从此继续写」新建，接在导入内容之后";

  const node = await prisma.storyNode.create({
    data: {
      projectId,
      parentId: null,
      type: "chapter",
      title: (title ?? "续写").slice(0, 200),
      order,
      status: "outline_only",
      outline: null,
      content: null,
      wordCount: 0,
      // ★关键一行：续写是 user 的新内容，不是导入原文
      source: "user",
      importKind: null,
      notes,
    },
    select: { id: true, order: true, title: true },
  });
  return node;
}
