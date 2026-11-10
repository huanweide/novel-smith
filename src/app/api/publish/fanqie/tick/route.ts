/**
 * 番茄小说发布 · 手动触发一轮调度
 *
 * POST  → 立刻跑一次 runPublishTick（界面上「立即执行」按钮 / agent 调它做自动化）。
 *         平时由 instrumentation.ts 每分钟自动跑，这个接口只是「不想等」时用。
 */
import { NextResponse } from "next/server";
import { runPublishTick } from "@/core/publish/fanqie/runner";

export async function POST() {
  try {
    const result = await runPublishTick();
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "调度执行失败" }, { status: 500 });
  }
}
