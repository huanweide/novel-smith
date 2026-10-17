/**
 * POST/GET/DELETE /api/import/novel/assets
 *
 * 前史资产（M3）：对已导入正文重新提炼角色卡 / 世界书 / 伏笔草稿，
 * 以及对草稿做「采纳 / 丢弃」的人工确认。
 *
 * 为什么要单独一个端点而不是只挂在 import/novel 上：
 *  1. 提炼规则会随语料反馈持续调整，作者常需要「拿同一本书再跑一遍新版提炼」；
 *  2. 草稿要能被逐个处理（一键全采纳只是快捷方式，不是唯一入口）。
 *
 * 采纳 = reviewStatus 改 approved（此后进入生成上下文）；
 * 丢弃 = reviewStatus 改 rejected（永不再被取用，也不删除，保留可追溯性）。
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-error";
import { badRequest } from "@/lib/validators";
import { extractAssets, summarizeAssets } from "@/lib/import/extract-assets";
import { seedAssets } from "@/lib/import/seed-assets";
import type { ParsedChapter } from "@/lib/import/types";

export const maxDuration = 300;

/** 从库里把已导入节点还原成 ParsedChapter 供提炼 */
async function loadImportedChapters(projectId: string, sourceKey?: string | null) {
  const nodes = await prisma.storyNode.findMany({
    where: {
      projectId,
      deletedAt: null,
      source: "imported",
      importKind: "chapter",
      ...(sourceKey ? { importSourceKey: sourceKey } : {}),
    },
    select: { id: true, order: true, title: true, content: true },
    orderBy: { order: "asc" },
  });
  return nodes.map(
    (n, i): ParsedChapter => ({
      index: i + 1,
      title: n.title || `第${i + 1}章`,
      content: n.content ?? "",
      wordCount: (n.content ?? "").replace(/\s+/g, "").length,
    }),
  );
}

/** POST：对已导入正文重新提炼并落成待审草稿 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: string;
      sourceKey?: string | null;
      /** dryRun=1 只提炼不落库，给作者预览 */
      dryRun?: boolean;
    };
    if (!body.projectId) return badRequest("缺少 projectId", "projectId");

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true, name: true },
    });
    if (!project) return badRequest("项目不存在", "projectId");

    const chapters = await loadImportedChapters(body.projectId, body.sourceKey ?? null);
    if (chapters.length === 0) {
      return badRequest("该项目还没有导入的正文，先导入一本再来提炼", "projectId");
    }

    const assets = extractAssets(chapters);
    const preview = summarizeAssets(assets);

    if (body.dryRun) {
      return NextResponse.json({ ok: true, mode: "dryRun", preview });
    }

    const seeded = await seedAssets({
      projectId: body.projectId,
      assets,
      importSourceKey: body.sourceKey ?? null,
    });

    return NextResponse.json({ ok: true, mode: "seed", preview, seeded });
  } catch (err) {
    return jsonError(err);
  }
}

/** GET：列出该项目里所有「导入提炼」的待审草稿 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return badRequest("缺少 projectId", "projectId");

    const status = url.searchParams.get("status") ?? "pending";

    const [allChars, lore, commitments] = await Promise.all([
      prisma.characterCard.findMany({
        where: { projectId, reviewStatus: status },
        select: { id: true, name: true, role: true, background: true, tags: true },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }),
      prisma.lorebookEntry.findMany({
        where: { projectId, reviewStatus: status },
        select: { id: true, title: true, category: true, content: true },
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
      prisma.pendingCommitment.findMany({
        where: { projectId, source: "import_inference", status: "pending" },
        select: { id: true, description: true, priority: true, developmentHint: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    // tags 是 Json 列，SQLite 下不支持 array_contains 过滤；
    // 先按状态取回再在内存里挑出「导入提炼」的，500 条上限足够且避免方言差异。
    const characters = allChars.filter((c) =>
      Array.isArray(c.tags) && (c.tags as unknown[]).includes("导入提炼"),
    );

    return NextResponse.json({ ok: true, status, characters, lore, commitments });
  } catch (err) {
    return jsonError(err);
  }
}

/** DELETE：批量采纳 / 丢弃草稿 */
export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: string;
      characters?: string[];
      lore?: string[];
      action?: "approve" | "reject";
    };
    if (!body.projectId) return badRequest("缺少 projectId", "projectId");
    const reviewStatus = body.action === "reject" ? "rejected" : "approved";

    const characterIds = Array.isArray(body.characters) ? body.characters : [];
    const loreIds = Array.isArray(body.lore) ? body.lore : [];
    if (characterIds.length === 0 && loreIds.length === 0) {
      return badRequest("没有指定要处理的草稿", "characters");
    }

    // 归属校验：只允许改本项目的卡，防止越权改到别的项目去
    const owned = await prisma.characterCard.findMany({
      where: { id: { in: characterIds }, projectId: body.projectId },
      select: { id: true },
    });
    const ownedLore = await prisma.lorebookEntry.findMany({
      where: { id: { in: loreIds }, projectId: body.projectId },
      select: { id: true },
    });

    const [c1, l1] = await Promise.all([
      prisma.characterCard.updateMany({
        where: { id: { in: owned.map((o) => o.id) } },
        data: { reviewStatus },
      }),
      prisma.lorebookEntry.updateMany({
        where: { id: { in: ownedLore.map((o) => o.id) } },
        data: { reviewStatus },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      action: body.action === "reject" ? "reject" : "approve",
      characters: c1.count,
      lore: l1.count,
    });
  } catch (err) {
    return jsonError(err);
  }
}
