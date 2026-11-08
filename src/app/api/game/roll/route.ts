/**
 * POST /api/game/roll —— 掷骰（两段式判定第一段）
 *
 * 跑团模式下对抗行动先掷骰：检定官裁定动态成功率 → d100 → 档位。
 * 不生成叙事、不更新 rollStats（正式行动确认时才落）——支持前端重骰。
 *
 * 入参：{ sagaId, actionType, actionText, target?, isReroll? }
 *   - isReroll=true 时消耗 rerollsLeft（easy 无限 / real 拒绝）
 * 返回：{ ok, d100, tier, label, successRate, reasons, rerollsLeft, rerollMax }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isConfrontationalAction } from "@/core/game/game-prompts";
import { arbitrateRoll, computeAdjustments, judgeRoll, rateLabel, type RollStats } from "@/core/game/roll-arbiter";

/** 难度档 → 重骰上限（easy=Infinity 序列化用 -1 表示） */
function rerollMaxOf(difficulty: string, custom: number | null): number {
  if (difficulty === "easy") return -1; // 无限
  if (difficulty === "real") return 0;
  return custom ?? 3; // hard 默认 3
}

export async function POST(req: Request) {
  try {
    const { sagaId, actionType, actionText, target, isReroll } = await req.json();
    if (!sagaId) return NextResponse.json({ error: "缺少 sagaId" }, { status: 400 });

    const saga = await prisma.gameSaga.findUnique({
      where: { id: sagaId },
      select: { rollMode: true, rollDifficulty: true, rollStats: true },
    });
    if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });
    if (saga.rollMode !== "tabletop") {
      return NextResponse.json({ ok: true, skipped: true, reason: "自由叙事模式不掷骰" });
    }
    if (!isConfrontationalAction(actionType || "custom", actionText || "")) {
      return NextResponse.json({ ok: true, skipped: true, reason: "非对抗行动不掷骰" });
    }

    const stats: RollStats = (saga.rollStats as any) || { winStreak: 0, loseStreak: 0, lastKey: "", repeatCount: 0, rerollsLeft: null };
    const rerollMax = rerollMaxOf(saga.rollDifficulty, null);

    // 重骰：消耗次数（real 拒绝；easy 无限）
    let rerollsLeft = stats.rerollsLeft ?? (rerollMax === -1 ? -1 : rerollMax);
    if (isReroll) {
      if (rerollMax === 0) {
        return NextResponse.json({ error: "真实模式不能重骰——骰出什么就是什么，这才是真实" }, { status: 400 });
      }
      if (rerollMax !== -1) {
        if (rerollsLeft <= 0) {
          return NextResponse.json({ error: "重骰次数已用完" }, { status: 400 });
        }
        rerollsLeft -= 1;
        await prisma.gameSaga.update({
          where: { id: sagaId },
          data: { rollStats: { ...stats, rerollsLeft } as any },
        });
      }
    }

    // 检定官裁定（重复行动的 fingerprint 用原始行动文本）
    const actionKey = `${actionType || "custom"}|${(actionText || "").slice(0, 40)}|${target ?? ""}`;
    const adjustments = computeAdjustments(
      { ...stats, rerollsLeft: undefined } as any,
      actionKey,
    );
    const verdict = await arbitrateRoll({
      actionText: actionText || "",
      actionType: actionType || "custom",
      target,
      personaBrief: "",
      recentNarrative: "",
      itemsBrief: "",
      adjustments,
    });

    const d100 = 1 + Math.floor(Math.random() * 100);
    const judged = judgeRoll(d100, verdict.finalRate);

    return NextResponse.json({
      ok: true,
      d100,
      tier: judged.key,
      label: judged.label,
      successRate: verdict.finalRate,
      reasons: verdict.reasons,
      note: verdict.note,
      rerollsLeft,
      rerollMax,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "掷骰失败" }, { status: 500 });
  }
}
