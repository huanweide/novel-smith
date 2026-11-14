/**
 * GET  /api/game/saga/[sagaId]/narrative  → 叙事账本（故事线 / 伏笔 / 世界卡 / 世界线 / 阶段）
 * PATCH /api/game/saga/[sagaId]/narrative → 玩家手动编辑
 *
 * 存储：复用 `saga.causality` 的信封（零迁移）。写入必须「读旧 → 合并 → 写回」，
 * 否则会冲掉因果种子或账本。见 docs/internal/游戏本叙事系统移植-决策表.md。
 *
 * PATCH 接受的 action（全部走白名单，不开放整账本覆盖）：
 *   { action:"approveCard",       id }                       确认世界卡（之后才进提示词）
 *   { action:"patchCard",         id, patch }               改分类/深度/正文/启停
 *   { action:"setCommitment",     id, status, reason? }     手动收/作废伏笔
 *   { action:"addClue",           lineId, tag?, content }   往某条线记一条线索
 *   { action:"completeLine",      lineId }                  标记完结（自动回填要素）
 *   { action:"createLine",        title, type, description?, parentId? }  新建故事线
 *   { action:"switchLineType",    lineId, type }            主线/支线互换（清要素残留）
 *   { action:"addCard",           title, category?, content?, depth? }  手动建世界卡（默认已确认）
 *   { action:"addCommitment",     description, priority?, closureConditions? }  手动埋伏笔
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  normalizeLedger,
  readNarrative,
  writeEnvelope,
  envelopeSeeds,
} from "@/core/game/narrative/ledger";
import { ALL_WORLD_CATEGORIES, patchCard, registerCard, suggestCategory } from "@/core/game/narrative/worldcard";
import { createCommitment, setCommitmentStatus } from "@/core/game/narrative/foreshadow";
import { addClue, completeLine, createLine, switchLineType } from "@/core/game/narrative/storyline";
import { stageOf } from "@/core/game/narrative/worldline";
import { narrativeSummary } from "@/core/game/narrative/context";
import type { NarrativeLedger, SagaCommitmentStatus, SagaLineType, SagaWorldCard } from "@/core/game/narrative/types";

type Params = { params: Promise<{ sagaId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { sagaId } = await params;
  const saga = await prisma.gameSaga.findUnique({
    where: { id: sagaId },
    select: { causality: true, chapters: { select: { index: true } } },
  });
  if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });
  const ledger = readNarrative(saga.causality);
  const totalChapters = Math.max(1, saga.chapters.length || 1);
  const chapterIndex = Math.max(0, ...saga.chapters.map((c) => c.index || 0));
  return NextResponse.json({
    ok: true,
    ledger,
    stage: stageOf(chapterIndex, totalChapters),
    summary: narrativeSummary(ledger),
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const { sagaId } = await params;
  try {
    const body = await req.json();
    const action = typeof body?.action === "string" ? body.action : "";
    if (!action) return NextResponse.json({ error: "缺少 action" }, { status: 400 });

    const saga = await prisma.gameSaga.findUnique({
      where: { id: sagaId },
      select: { causality: true },
    });
    if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });

    const ledger = readNarrative(saga.causality);
    const round = Math.max(1, ledger.updatedRound + 1);
    let next: NarrativeLedger = { ...ledger, updatedRound: round };

    switch (action) {
      case "approveCard": {
        const id = String(body.id || "");
        next = { ...next, worldCards: patchCard(next.worldCards, id, { reviewStatus: "approved" }) };
        break;
      }
      case "patchCard": {
        const id = String(body.id || "");
        const raw = body.patch && typeof body.patch === "object" ? body.patch : {};
        const allowed: Partial<SagaWorldCard> = {};
        if (typeof raw.title === "string") allowed.title = raw.title;
        if (typeof raw.category === "string") allowed.category = raw.category as SagaWorldCard["category"];
        if (typeof raw.content === "string") allowed.content = raw.content;
        if (typeof raw.depth === "number") allowed.depth = raw.depth;
        if (typeof raw.enabled === "boolean") allowed.enabled = raw.enabled;
        if (raw.reviewStatus === "pending" || raw.reviewStatus === "approved") allowed.reviewStatus = raw.reviewStatus;
        next = { ...next, worldCards: patchCard(next.worldCards, id, allowed) };
        break;
      }
      case "setCommitment": {
        const id = String(body.id || "");
        const allowed: SagaCommitmentStatus[] = ["pending", "detected", "partially_fulfilled", "fulfilled", "voided"];
        const status = allowed.includes(body.status) ? body.status : null;
        if (!status) return NextResponse.json({ error: "非法伏笔状态" }, { status: 400 });
        next = {
          ...next,
          commitments: setCommitmentStatus(next.commitments, id, status, round, body.reason),
        };
        break;
      }
      case "addClue": {
        const r = addClue(next.storylines, String(body.lineId || ""), round, {
          tag: body.tag,
          content: String(body.content || ""),
        });
        next = { ...next, storylines: r.storylines };
        break;
      }
      case "completeLine": {
        next = { ...next, storylines: completeLine(next.storylines, String(body.lineId || ""), round) };
        break;
      }
      case "createLine": {
        const title = String(body.title || "").trim();
        if (!title) return NextResponse.json({ error: "故事线标题不能为空" }, { status: 400 });
        const type: SagaLineType = body.type === "main" ? "main" : "side";
        const r = createLine(next.storylines, { title, type, description: body.description, parentId: body.parentId }, round);
        next = { ...next, storylines: r.storylines };
        break;
      }
      case "switchLineType": {
        const type: SagaLineType = body.type === "main" ? "main" : "side";
        next = {
          ...next,
          storylines: switchLineType(next.storylines, String(body.lineId || ""), type),
        };
        break;
      }
      case "addCard": {
        const title = String(body.title || "").trim();
        if (title.length < 2) return NextResponse.json({ error: "世界卡名字太短" }, { status: 400 });
        // 玩家手选的分类优先；只有没选（或非法值）时才交给确定性分类器建议。
        // 曾在这里一律用 suggestCategory，导致玩家指定 faction/item 也被塞进 custom。
        const chosen = typeof body.category === "string" ? body.category : "";
        const category = (ALL_WORLD_CATEGORIES as readonly string[]).includes(chosen)
          ? (chosen as SagaWorldCard["category"])
          : suggestCategory(title, body.entityType);
        const r = registerCard(next.worldCards, {
          title,
          // 玩家手填的卡默认已确认（不是 AI 随口名词，无需再审）
          category,
          content: typeof body.content === "string" ? body.content : "",
          depth: typeof body.depth === "number" ? body.depth : 3,
          source: "player",
          round,
          approved: true,
        });
        next = { ...next, worldCards: r.cards };
        break;
      }
      case "addCommitment": {
        const r = createCommitment(next.commitments, {
          description: String(body.description || ""),
          priority: body.priority,
          closureConditions: Array.isArray(body.closureConditions) ? body.closureConditions : [],
          round,
        });
        next = { ...next, commitments: r.commitments };
        break;
      }
      default:
        return NextResponse.json({ error: `未知操作：${action}` }, { status: 400 });
    }

    const clean = normalizeLedger(next);
    // 关键：读旧信封 → 保留因果种子 → 写回，绝不能整列覆盖
    const envelope = writeEnvelope(saga.causality, envelopeSeeds(saga.causality), clean);
    await prisma.gameSaga.update({
      where: { id: sagaId },
      data: { causality: envelope as any },
    });

    return NextResponse.json({ ok: true, ledger: clean, summary: narrativeSummary(clean) });
  } catch (e: any) {
    console.error("[game narrative] 更新失败:", e);
    return NextResponse.json({ error: e?.message || "更新叙事账本失败" }, { status: 500 });
  }
}
