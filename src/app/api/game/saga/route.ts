/**
 * 游戏本（Saga）—— 列表与创建
 *
 * POST /api/game/saga
 *  - { mode: "derive", projectId, title? }：以小说项目为前传派生游戏本（快照冻结）
 *  - { mode: "fresh", title }：从零新建游戏本（独立存在，无小说项目）
 *
 * GET /api/game/saga?projectId=xxx（可选过滤）
 *  - 返回游戏本列表（含章节计数）
 *
 * 游戏本定位：自足的创作空间（F6 终版）。派生不污染小说项目任何数据；
 * 游玩全程不回写小说；回流是显式的「导出到小说」动作（另行路由）。
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApprovedCharacters, getApprovedLore } from "@/lib/approved-cards";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = body.mode === "fresh" ? "fresh" : "derive";

    // ── 从零新建 ──
    if (mode === "fresh") {
      const title = (body.title || "").trim();
      if (!title) return NextResponse.json({ error: "缺少游戏本名称" }, { status: 400 });
      const saga = await prisma.gameSaga.create({
        data: {
          title,
          projectId: null,
          sourceSnapshot: JSON.stringify({ bookName: title, derivedAt: new Date().toISOString() }),
        },
      });
      // 首章自动建
      await prisma.gameSagaChapter.create({
        data: { sagaId: saga.id, index: 1, title: "第一章" },
      });
      return NextResponse.json({ ok: true, saga });
    }

    // ── 以小说项目为前传派生 ──
    const { projectId } = body;
    if (!projectId) return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        storyNodes: {
          where: { deletedAt: null, type: { not: "volume" } },
          orderBy: { order: "asc" },
          select: { id: true, title: true, content: true, outline: true },
        },
      },
    });
    if (!project) return NextResponse.json({ error: "小说项目不存在" }, { status: 404 });

    // 前传快照：书名/总纲/全部章节正文/角色卡/世界书（冻结为那一刻的世界线）
    const [characters, lore] = await Promise.all([
      getApprovedCharacters(prisma, projectId, { take: 50 }),
      getApprovedLore(prisma, projectId, { take: 50 }),
    ]);
    const snapshot = {
      bookName: project.name,
      synopsis: project.synopsis || "",
      chapters: project.storyNodes.map((n) => ({ id: n.id, title: n.title, content: n.content || "" })),
      characters: characters.map((c: any) => ({
        name: c.name, role: c.role, currentStatus: c.currentStatus, background: c.background || "",
      })),
      lore: lore.map((l: any) => ({ title: l.title, content: l.content })),
      derivedAt: new Date().toISOString(),
    };

    const saga = await prisma.gameSaga.create({
      data: {
        projectId,
        title: (body.title || "").trim() || `游戏本 · ${project.name}`,
        sourceSnapshot: JSON.stringify(snapshot),
      },
    });
    // 首章自动建（前传字数作为本章已有正文的续接起点为空——游戏从新章开始）
    await prisma.gameSagaChapter.create({
      data: { sagaId: saga.id, index: 1, title: "第一章" },
    });

    return NextResponse.json({ ok: true, saga });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "创建游戏本失败" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const sagas = await prisma.gameSaga.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { updatedAt: "desc" },
      include: { chapters: { orderBy: { index: "asc" } } },
    });
    return NextResponse.json({
      ok: true,
      sagas: sagas.map((s) => ({
        id: s.id,
        title: s.title,
        projectId: s.projectId,
        status: s.status,
        playAsName: s.playAsName,
        rollMode: s.rollMode,
        chapterCount: s.chapters.length,
        activeChapterId: s.chapters.find((c) => c.status === "active")?.id ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "加载游戏本失败" }, { status: 500 });
  }
}
