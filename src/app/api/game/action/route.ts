/**
 * POST /api/game/action
 * 处理一个游戏回合——SSE 流式响应
 *
 * SSE 事件类型：
 * - token: 流式文本块
 * - game_done: 回合完成（含 narrative/options/entities/items/progress）
 * - error: 错误
 */

import { NextResponse } from "next/server";
import { processGameTurn } from "@/core/game/game-engine";
import type { GameActionType } from "@/core/game/types";
import { verifyIntent, weighIntent } from "@/core/game/jev";
import { toSnapshot } from "@/core/game/scene";
import { loadScene } from "@/lib/game-scene";
import { askFeasibility } from "@/core/game/decision-model";
import { sseError } from "@/lib/sse-error";

export async function POST(req: Request) {
  const body = await req.json();
  const { sessionId, actionType, actionText, selectedOption, targetItem, target, preRolled, declareText, scene } = body;

  if (!sessionId) {
    return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
  }

  // ── JEV · Verify（规则层）：世界不允许的事，在这里就回绝，不写进正文 ──
  // 处境以服务端为准（loadScene），前端传来的 scene 只当兜底提示——
  // 否则前端一句假数据就能绕过所有限制，而且两边口径必然漂。
  // 判据：人不在 / 物没有 / 路不通 → 界面直说；角色可能失败 → 放过，交给叙事演成败。
  // 拿不准一律放过（拦错比放过多更伤自由感）。
  const loaded = await loadScene(sessionId);
  const authoritative = loaded.scene.basis !== "none" || loaded.scene.items.length > 0;
  const sceneSnap = authoritative
    ? toSnapshot(loaded.scene)
    : {
        presentNames: Array.isArray(scene?.presentNames) ? scene.presentNames : undefined,
        items: Array.isArray(scene?.items) ? scene.items : undefined,
        reachable: Array.isArray(scene?.reachable) ? scene.reachable : undefined,
      };
  const intentText = declareText || actionText || "";
  if (actionType !== "declare") {
    const verdict = verifyIntent(
      { actionType: (actionType || "custom") as string, actionText: intentText, target, targetItem },
      sceneSnap,
      { mode: loaded.mode }
    );
    if (!verdict.ok) {
      return NextResponse.json({ ...verdict, ok: false }, { status: 409 });
    }

    // ── JEV · 轻判定（仿 JEV 的 Choice）：只在一句话说不清的自由输入上启用 ──
    // 规则管不到的（抵押换消息、拿身份压人）交给一次单字母判定；
    // 超时/低把握直接放过——判定层不能成为新的卡点。
    if ((actionType || "custom") === "custom" && intentText.trim().length >= 10) {
      const quick = await askFeasibility(
        {
          place: loaded.scene.place || (typeof scene?.place === "string" ? scene.place : undefined),
          time: loaded.scene.time || (typeof scene?.time === "string" ? scene.time : undefined),
          present: sceneSnap.presentNames,
          items: sceneSnap.items,
        },
        intentText
      );
      if (quick?.block) {
        return NextResponse.json(
          {
            ok: false,
            code: "implausible",
            reason: quick.reason || "眼下的条件做不到",
            alternatives: ["换个做法", "先探清处境"],
          },
          { status: 409 }
        );
      }
    }
  }

  // ── JEV · 分流：轻回合（看一眼/挪一步）只写一两句，别把节奏拖成写小说 ──
  const light =
    actionType === "declare"
      ? false
      : weighIntent({ actionType: (actionType || "custom") as string, actionText: actionText || "" }) === "light";

  // 创建 SSE 流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (data: any) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const gen = processGameTurn(
          {
            sessionId,
            actionType: (actionType || "custom") as GameActionType,
            // 声明事实时正文以 declareText 为准，actionText 只作兜底（保持老前端兼容）
            actionText: declareText || actionText || "自定义行动",
            declareText,
            selectedOption,
            targetItem,
            target,
            preRolled,
            light,
          },
          req.signal
        );

        for await (const event of gen) {
          write(event);
          if (event.type === "error") break;
        }
      } catch (err: unknown) {
        // 收敛为可读错误，避免泄露原始 err.message（与 write/continue/refine 三路由一致）；
        // 直接发送 sseError 返回的 { type:"error", content, code, hint } 事件，
        // 不再用裸 error 字段（FIX-10：统一 SSE 契约）。
        write(sseError(err));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
