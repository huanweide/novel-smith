/**
 * GET /api/game/scene?sessionId=xxx
 *
 * 一次请求换回"此刻的处境 + 能点的牌"：
 *   { ok, scene, deck, mode, playerName }
 *
 * 为什么由服务端算而不是前端拼：
 *   1. 前端没有权威数据（谁在场、身上有什么都可能过期）；
 *   2. 判定层（jev.ts）也用同一个 scene——两边口径必须一致，
 *      否则会出现"界面说能送、后端说没东西"的自相矛盾。
 *
 * 全部确定性推导，零模型调用。
 */

import { NextRequest, NextResponse } from "next/server";
import { classifyError } from "@/lib/api-error";
import { loadScene } from "@/lib/game-scene";
import { buildDeckFromScene } from "@/core/game/intent-deck";

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "缺少 sessionId" }, { status: 400 });
    }

    const { scene, map, mode, playerName } = await loadScene(sessionId);
    return NextResponse.json({
      ok: true,
      scene,
      map,
      deck: buildDeckFromScene(scene, 6),
      mode,
      playerName,
    });
  } catch (err) {
    const { error, status } = classifyError(err);
    return NextResponse.json({ ok: false, error }, { status });
  }
}
