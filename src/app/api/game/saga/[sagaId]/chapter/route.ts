/**
 * 游戏本章节 —— 新建
 *
 * POST /api/game/saga/[sagaId]/chapter
 *  - { title?, outline? }：在游戏本末尾追加一章（index 自动递增）
 *    章号自动：既有最大 index + 1；标题缺省「第N章」
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ sagaId: string }> };

export async function POST(req: Request, { params }: Params) {
  const { sagaId } = await params;
  try {
    const saga = await prisma.gameSaga.findUnique({ where: { id: sagaId }, select: { id: true } });
    if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const max = await prisma.gameSagaChapter.aggregate({
      where: { sagaId },
      _max: { index: true },
    });
    const index = (max._max.index ?? 0) + 1;
    const chapter = await prisma.gameSagaChapter.create({
      data: {
        sagaId,
        index,
        title: (body.title || "").trim() || `第${index}章`,
        outline: typeof body.outline === "string" && body.outline.trim() ? body.outline.trim() : null,
      },
    });
    return NextResponse.json({ ok: true, chapter });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "新建章节失败" }, { status: 500 });
  }
}
