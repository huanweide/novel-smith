/**
 * POST /api/system/check-update — 触发更新检查（委托主进程 electron-updater）
 *
 * Next 服务与主进程同进程（main.js 内 nextApp.prepare()），故可直接读取
 * globalThis.__nsCheckUpdate（由 setupAutoUpdater 注入）。
 *
 * 返回：
 *  { status: "available", version }       发现新版本（后台会自动下载）
 *  { status: "not-available" }            已是最新
 *  { status: "error", message }           检查失败
 *  { status: "timeout" }                  检查超时
 *  { status: "unavailable" }              当前版本未启用自动更新模块（501）
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CheckResult =
  | { status: "available" | "not-available" | "error" | "timeout"; version?: string; message?: string }
  | { status: "unavailable" };

export async function POST() {
  const fn = (globalThis as Record<string, unknown>).__nsCheckUpdate as
    | (() => Promise<CheckResult>)
    | undefined;
  if (typeof fn !== "function") {
    return NextResponse.json({ status: "unavailable" } as CheckResult, { status: 501 });
  }
  try {
    const result = await fn();
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ status: "error", message } as CheckResult, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
