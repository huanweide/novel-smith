import { NextResponse } from "next/server";
import { createSnapshot, pruneSnapshots } from "@/lib/db-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 自动快照定时任务（对标 src/app/api/cron/memory-decay/route.ts）。
 * 由外部计划任务 / 开机启动脚本周期性调用，或桌面端主进程定时触发。
 * 每次生成一份 auto 快照并保留最近 10 份，防止长期运行无声丢失。
 */
export async function GET() {
  try {
    const snap = await createSnapshot("auto");
    const removed = pruneSnapshots(10);
    return NextResponse.json({ ok: true, snapshot: snap, pruned: removed });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// 也支持 POST，方便手动触发
export async function POST() {
  return GET();
}
