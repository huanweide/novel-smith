/**
 * /api/game/extensions —— 玩家自由意志三件套（R9）
 *
 * GET  ?sessionId=            → { extensions: { causality, declaredFacts, goals } }
 * POST { sessionId, op, ... } → 增删改后返回最新 extensions
 *
 * op 取值：
 *   addFact     { text }        声明一条世界事实（走 declare-fact 校验）
 *   removeFact  { id }          撤销一条声明
 *   addGoal     { text }        新增自由目标
 *   removeGoal  { id }          删除目标
 *   toggleGoal  { id, done? }   切换/设定完成
 *
 * 为什么事实与目标走独立接口而不是塞进回合：
 *   它们不是「行动」，不该消耗一次模型调用，也不该推进回合。
 *   玩家写一条设定就该立刻生效——这条边界在这里划死。
 *   真正让 AI 采纳是在**下一回合**组装提示词时注入（见 game-engine.loadGameContext）。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addDeclaredFact, removeDeclaredFact } from "@/core/game/declare-fact";
import { addGoal, removeGoal, toggleGoalDone } from "@/core/game/goals";
import { parseExtensions, serializeExtensions } from "@/core/game/session-extensions";
import { classifyError } from "@/lib/api-error";

async function loadSession(sessionId: string) {
  return prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, currentRound: true, extensions: true },
  });
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "缺少 sessionId" }, { status: 400 });
    }
    const session = await loadSession(sessionId);
    if (!session) {
      return NextResponse.json({ ok: false, error: "游戏会话不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, extensions: parseExtensions(session.extensions) });
  } catch (err) {
    const { error, status } = classifyError(err);
    return NextResponse.json({ ok: false, error }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId as string | undefined;
    const op = body?.op as string | undefined;
    if (!sessionId || !op) {
      return NextResponse.json({ ok: false, error: "缺少 sessionId / op" }, { status: 400 });
    }
    const session = await loadSession(sessionId);
    if (!session) {
      return NextResponse.json({ ok: false, error: "游戏会话不存在" }, { status: 404 });
    }
    if (session.status !== "active") {
      return NextResponse.json({ ok: false, error: "游戏已结束，无法修改" }, { status: 409 });
    }

    const ext = parseExtensions(session.extensions);
    const round = session.currentRound;
    let next = ext;
    let error: string | undefined;

    switch (op) {
      case "addFact": {
        const res = addDeclaredFact(ext.declaredFacts, String(body?.text ?? ""), round);
        next = { ...ext, declaredFacts: res.facts };
        error = res.error;
        break;
      }
      case "removeFact": {
        const id = String(body?.id ?? "");
        if (!id) error = "缺少 id";
        else next = { ...ext, declaredFacts: removeDeclaredFact(ext.declaredFacts, id) };
        break;
      }
      case "addGoal": {
        const res = addGoal(ext.goals, String(body?.text ?? ""), round);
        next = { ...ext, goals: res.goals };
        error = res.error;
        break;
      }
      case "removeGoal": {
        const id = String(body?.id ?? "");
        if (!id) error = "缺少 id";
        else next = { ...ext, goals: removeGoal(ext.goals, id) };
        break;
      }
      case "toggleGoal": {
        const id = String(body?.id ?? "");
        if (!id) error = "缺少 id";
        else {
          const done = typeof body?.done === "boolean" ? body.done : undefined;
          next = { ...ext, goals: toggleGoalDone(ext.goals, id, done) };
        }
        break;
      }
      default:
        return NextResponse.json({ ok: false, error: `未知操作：${op}` }, { status: 400 });
    }

    if (error) {
      // 校验失败不改库（宁可拒绝，也不写脏数据进存档）
      return NextResponse.json({ ok: false, error, extensions: ext }, { status: 400 });
    }

    const payload = serializeExtensions(next);
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { extensions: payload as any },
    });
    return NextResponse.json({ ok: true, extensions: payload });
  } catch (err) {
    const { error, status } = classifyError(err);
    return NextResponse.json({ ok: false, error }, { status });
  }
}
