/**
 * 游戏本 · 角色卡（个人界面）
 *
 * GET    /api/game/saga/[sagaId]/characters
 *   → { ok, playAsName, sheets: { [name]: CharacterSheet }, candidates: [{name, role, brief}] }
 *   合并三方来源：saga.characterSheets（玩家/引擎已编辑的档案）> 前传快照角色 > 项目角色卡
 *
 * PATCH  /api/game/saga/[sagaId]/characters
 *   body: { name: string, patch: Partial<CharacterSheet> }
 *   → 合并写入 characterSheets[name]（表单逐项填，未填的字段保留）
 *
 * 设计说明：这是「人」的档案；GameState.entities 是「这一轮谁在场」的引擎识别结果。
 * 两者解耦——档案不随轮次清空，跨章持久。
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApprovedCharacters } from "@/lib/approved-cards";

type Params = { params: Promise<{ sagaId: string }> };

export interface CharacterSheet {
  name: string;
  role?: string;          // 身份 / 职业
  title?: string;         // 头衔 / 称号
  age?: string;
  appearance?: string;    // 外貌
  personality?: string;   // 性格
  background?: string;    // 背景故事
  abilities?: string[];   // 能力 / 技能 / 金手指（检定时作为加成依据）
  status?: {
    hp?: number;          // 体力 0-100
    spirit?: number;      // 精神 0-100
    injury?: string;      // 伤势描述
    mood?: string;        // 当前情绪
    location?: string;    // 所在位置
  };
  relations?: Array<{ name: string; relation: string; level?: number }>;
  notes?: string;         // 自由备注（玩家自己记）
  isPlayer?: boolean;     // 是否玩家当前扮演
  updatedAt?: string;
}

export async function GET(_req: Request, { params }: Params) {
  const { sagaId } = await params;
  const saga = await prisma.gameSaga.findUnique({ where: { id: sagaId } });
  if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });

  let snapshot: any = {};
  try { snapshot = saga.sourceSnapshot ? JSON.parse(saga.sourceSnapshot) : {}; } catch { /* ignore */ }

  const saved: Record<string, CharacterSheet> =
    saga.characterSheets && typeof saga.characterSheets === "object" && !Array.isArray(saga.characterSheets)
      ? (saga.characterSheets as unknown as Record<string, CharacterSheet>)
      : {};

  // 候选（用于「还没有档案时」的初始壳）：项目角色卡优先，其次前传快照
  const candidates: Array<{ name: string; role: string; brief: string }> = [];
  if (saga.projectId) {
    try {
      const chars = await getApprovedCharacters(prisma, saga.projectId, { take: 30 });
      for (const c of chars as any[]) {
        if (!c?.name) continue;
        candidates.push({ name: c.name, role: c.role || "", brief: (c.background || "").slice(0, 120) });
      }
    } catch { /* ignore */ }
  }
  if (Array.isArray(snapshot.characters)) {
    for (const c of snapshot.characters) {
      if (!c?.name) continue;
      if (!candidates.some((x) => x.name === c.name)) {
        candidates.push({ name: c.name, role: c.role || "", brief: (c.background || "").slice(0, 120) });
      }
    }
  }

  // 初始壳：未编辑过的角色也能展示（档案字段留空，等玩家填）
  const sheets: Record<string, CharacterSheet> = { ...saved };
  for (const c of candidates) {
    if (!sheets[c.name]) {
      sheets[c.name] = { name: c.name, role: c.role || undefined, background: c.brief || undefined };
    }
  }
  if (saga.playAsName) {
    if (!sheets[saga.playAsName]) sheets[saga.playAsName] = { name: saga.playAsName };
    sheets[saga.playAsName].isPlayer = true;
  }

  return NextResponse.json({
    ok: true,
    playAsName: saga.playAsName,
    sheets,
    candidates,
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const { sagaId } = await params;
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "缺少角色名" }, { status: 400 });
    const patch = body.patch && typeof body.patch === "object" ? body.patch : {};

    const saga = await prisma.gameSaga.findUnique({ where: { id: sagaId }, select: { characterSheets: true, playAsName: true } });
    if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });

    const all: Record<string, any> =
      saga.characterSheets && typeof saga.characterSheets === "object"
        ? { ...(saga.characterSheets as Record<string, any>) }
        : {};

    const prev = all[name] || { name };
    // 深合并 status / relations 之外的浅字段；abilities 整体替换（表单提交数组）
    const next: any = { ...prev, ...patch, name };
    if (patch.status && typeof patch.status === "object") {
      next.status = { ...(prev.status || {}), ...patch.status };
    }
    // 只允许白名单字段，避免前端误传覆盖内部字段
    const allowed = ["role", "title", "age", "appearance", "personality", "background",
      "abilities", "status", "relations", "notes", "isPlayer"];
    const cleaned: any = { name, updatedAt: new Date().toISOString() };
    for (const k of allowed) if (next[k] !== undefined) cleaned[k] = next[k];
    all[name] = cleaned;

    const updated = await prisma.gameSaga.update({
      where: { id: sagaId },
      data: { characterSheets: all },
      select: { characterSheets: true },
    });

    return NextResponse.json({ ok: true, sheet: cleaned, sheets: updated.characterSheets });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "保存角色卡失败" }, { status: 500 });
  }
}
