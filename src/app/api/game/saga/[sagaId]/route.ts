/**
 * 游戏本（Saga）—— 详情 / 更新 / 删除
 *
 * GET    /api/game/saga/[sagaId]：详情（含章节列表，含每章会话状态）
 * PATCH  /api/game/saga/[sagaId]：{ title?, playAsCharacterId?, playAsName?, rollMode? }
 * DELETE /api/game/saga/[sagaId]：删除游戏本（级联删章节与会话；不可逆）
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  return NextResponse.json({
    ok: true,
    saga: {
      id: saga.id,
      title: saga.title,
      projectId: saga.projectId,
      sourceBookName: snapshot.bookName || null,
      playAsCharacterId: saga.playAsCharacterId,
      playAsName: saga.playAsName,
      rollMode: saga.rollMode,
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
