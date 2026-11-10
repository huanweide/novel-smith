/**
 * 番茄小说发布 · 日志
 *
 * GET /api/publish/fanqie/logs?limit=100
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(300, Math.max(1, Number(url.searchParams.get("limit") || 80)));
    const logs = await prisma.publishLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ ok: true, logs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "读取日志失败" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await prisma.publishLog.deleteMany({});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "清空日志失败" }, { status: 500 });
  }
}
