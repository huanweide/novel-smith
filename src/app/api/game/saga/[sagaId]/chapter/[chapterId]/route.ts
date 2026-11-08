/**
 * 游戏本章节 —— 更新 / 删除
 *
 * PATCH  /api/game/saga/[sagaId]/chapter/[chapterId]
 *  - { title?, outline? }：改名 / 改章纲（仅未归档章可改）
 * DELETE /api/game/saga/[sagaId]/chapter/[chapterId]
 *  - 删除章节（级联删会话与轮次；已归档章慎删——正文会一起消失）
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ sagaId: string; chapterId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { chapterId } = await params;
  try {
    const chapter = await prisma.gameSagaChapter.findUnique({ where: { id: chapterId } });
    if (!chapter) return NextResponse.json({ error: "章节不存在" }, { status: 404 });
    if (chapter.status === "archived") {
      return NextResponse.json({ error: "本章已收束归档，不可修改" }, { status: 400 });
    }
    const body = await req.json();
    const data: any = {};
    if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (typeof body.outline === "string" || body.outline === null) {
      data.outline = typeof body.outline === "string" && body.outline.trim() ? body.outline.trim() : null;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
    }
    const updated = await prisma.gameSagaChapter.update({ where: { id: chapterId }, data });
    return NextResponse.json({ ok: true, chapter: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "更新章节失败" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { chapterId } = await params;
  try {
    const chapter = await prisma.gameSagaChapter.findUnique({ where: { id: chapterId } });
    if (!chapter) return NextResponse.json({ error: "章节不存在" }, { status: 404 });
    await prisma.gameSagaChapter.delete({ where: { id: chapterId } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "删除章节失败" }, { status: 500 });
  }
}
