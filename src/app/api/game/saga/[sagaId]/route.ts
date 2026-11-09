/**
 * 游戏本（Saga）—— 详情 / 更新 / 删除
 *
 * GET    /api/game/saga/[sagaId]：详情（含章节列表，含每章会话状态）
 * PATCH  /api/game/saga/[sagaId]：{ title?, playAsCharacterId?, playAsName?, rollMode? }
 * DELETE /api/game/saga/[sagaId]：删除游戏本（级联删章节与会话；不可逆）
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApprovedCharacters } from "@/lib/approved-cards";

type Params = { params: Promise<{ sagaId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { sagaId } = await params;
  const saga = await prisma.gameSaga.findUnique({
    where: { id: sagaId },
    include: {
      chapters: {
        orderBy: { index: "asc" },
        include: { sessions: { orderBy: { currentRound: "asc" }, select: { id: true, status: true, currentRound: true, totalWords: true } } },
      },
    },
  });
  if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });

  let snapshot: any = {};
  try { snapshot = saga.sourceSnapshot ? JSON.parse(saga.sourceSnapshot) : {}; } catch { /* 忽略 */ }

  // 扮演候选（P0-3）：派生本取项目角色卡现值；从零新建用前传快照角色
  let playAsCandidates: Array<{ id: string | null; name: string; role: string; brief: string }> = [];
  // 热点名候选（P1 万物可交互）：项目全部角色卡名（含待审——正文人名必须可点，不随审批状态掉链子）
  let hotspotNames: string[] = [];
  if (saga.projectId) {
    const chars = await getApprovedCharacters(prisma, saga.projectId, { take: 30 });
    playAsCandidates = chars.map((c: any) => ({
      id: c.id ?? null,
      name: c.name,
      role: c.role || "",
      brief: (c.background || "").slice(0, 80),
    }));
    const allChars = await prisma.characterCard.findMany({
      where: { projectId: saga.projectId },
      select: { name: true },
      take: 60,
    });
    hotspotNames = allChars.map((c: any) => c.name).filter(Boolean);
  } else if (Array.isArray(snapshot.characters)) {
    playAsCandidates = snapshot.characters.map((c: any) => ({
      id: null,
      name: c.name,
      role: c.role || "",
      brief: (c.background || "").slice(0, 80),
    }));
    hotspotNames = snapshot.characters.map((c: any) => c.name).filter(Boolean);
  }

  return NextResponse.json({
    ok: true,
    saga: {
      id: saga.id,
      title: saga.title,
      projectId: saga.projectId,
      sourceBookName: snapshot.bookName || null,
      synopsis: snapshot.synopsis || "",
      loreEntries: Array.isArray(snapshot.lore)
        ? snapshot.lore.map((l: any) => ({ title: l.title || "", content: l.content || "" }))
        : [],
      hotspotNames,
      playAsCharacterId: saga.playAsCharacterId,
      playAsName: saga.playAsName,
      // 叙事视点：first 第二人称亲历 | third 第三人称小说镜头 | god 群像上帝/GM
      narrativeMode: (saga as any).narrativeMode || "first",
      // 暗线账本：仅上帝/GM 视角对玩家公开真相；其他视角永远只见表层（空数组）
      secretLedger: ((saga as any).narrativeMode || "first") === "god"
        ? (() => { try { return JSON.parse(saga.secretLedger || "[]"); } catch { return []; } })()
        : [],
      // 是否已有可编辑角色卡档案（前端据此在首次进入时弹一次「确认你的角色」）
      hasCharacterSheets: !!saga.characterSheets && Object.keys(saga.characterSheets as object).length > 0,
      rollMode: saga.rollMode,
      playAsCandidates,
      chapters: saga.chapters.map((c) => ({
        id: c.id,
        index: c.index,
        title: c.title,
        outline: c.outline,
        status: c.status,
        wordCount: (c.content || "").length,
        sessionId: c.sessions[0]?.id ?? null,
        sessionStatus: c.sessions[0]?.status ?? null,
        sessionRound: c.sessions[0]?.currentRound ?? 0,
        sessionWords: c.sessions[0]?.totalWords ?? 0,
      })),
    },
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const { sagaId } = await params;
  try {
    const body = await req.json();
    const data: any = {};
    if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (typeof body.playAsCharacterId === "string" || body.playAsCharacterId === null) data.playAsCharacterId = body.playAsCharacterId;
    if (typeof body.playAsName === "string" || body.playAsName === null) data.playAsName = body.playAsName;
    if (body.rollMode === "free" || body.rollMode === "tabletop") data.rollMode = body.rollMode;
    if (body.narrativeMode === "first" || body.narrativeMode === "third" || body.narrativeMode === "god") {
      data.narrativeMode = body.narrativeMode;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
    }
    const saga = await prisma.gameSaga.update({ where: { id: sagaId }, data });
    return NextResponse.json({ ok: true, saga });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "更新游戏本失败" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { sagaId } = await params;
  try {
    await prisma.gameSaga.delete({ where: { id: sagaId } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "删除游戏本失败" }, { status: 500 });
  }
}
