import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { classifyError } from "@/lib/api-error";
import { suggestConflictFix } from "@/core/consistency/suggestFix";

// v1.6.51.5 Next-1：一致性冲突修正建议（按需生成，不落库）。
// POST { id: conflictId } → { ok, suggestion }；含 project 归属校验（冲突必须属于路径 projectId）。

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params; // projectId
  try {
    const body = await req.json().catch(() => ({}));
    const conflictId = String(body?.id ?? "");
    if (!conflictId) return jsonError("缺少冲突 id", 400);

    const result = await suggestConflictFix(id, conflictId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("无权") || msg.includes("不存在")) return jsonError(msg, 404);
    // 本端点会调 LLM 生成修正建议。配置错误（Key 未配/非法）必须收敛为 400 CONFIG，
    // 不能像旧代码那样 jsonError(msg, 500) 伪装成服务器故障（实跑复现：真冲突 + 无 Key → 500）。
    const info = classifyError(e);
    return jsonError(info.error, info.status, info.code);
  }
}
